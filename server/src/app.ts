// beech API. Mounted under /api by src/server.ts, which also serves the web app.
//
//   POST   /api/auth/google      { credential }            -> { token, user }
//   POST   /api/auth/apple       { identityToken, name? }  -> { token, user }
//   POST   /api/auth/dev         { name }                  -> { token, user }   (DEV_AUTH only)
//   POST   /api/auth/logout                                -> 204
//   GET    /api/me                                         -> { user }
//   GET    /api/beach                                      -> sand bytes + X-Beach-* headers | 404
//   PUT    /api/beach            sand bytes, X-Beach-Location/Nx/Ny -> { version, updatedAt }
//   DELETE /api/account                                    -> 204 (user, sessions, beach, neighbor links)
//
//   GET    /api/neighbors                                  -> { code, left, right, pickedBy }
//   PUT    /api/neighbors/:side  { code }                  -> { neighbor }      side = left | right
//   DELETE /api/neighbors/:side                            -> 204
//   GET    /api/neighbors/:side/beach                      -> that neighbor's sand bytes | 404
//   POST   /api/neighbors/code                             -> { code } (new code; old one stops working)
//
// Auth: `Authorization: Bearer <token>`; only the token's SHA-256 is stored.

import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { POOLS, draw, nextDay, pullDay } from './pulls.js';
import { hashToken, newSessionToken, SESSION_DAYS, verifyAppleIdToken, verifyGoogleIdToken, type VerifiedIdentity } from './auth.js';
import { toBytes, type Db } from './db.js';

export interface AppConfig {
  googleClientIds: string[];
  appleClientIds: string[];
  /** extra origins allowed cross-origin (the native app shells) */
  allowedOrigins: string[];
  devAuth: boolean;
  /** injectable for tests */
  verifyGoogle?: typeof verifyGoogleIdToken;
  verifyApple?: typeof verifyAppleIdToken;
}

export interface User {
  id: string;
  name: string;
}

type Env = { Variables: { user: User; tokenHash: string } };

const MAX_BEACH_BYTES = 768 * 1024;
const MAX_CELLS = 400 * 300;
const BEACH_HEADERS = ['X-Beach-Location', 'X-Beach-Nx', 'X-Beach-Ny', 'X-Beach-Version', 'X-Beach-Updated'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];

const fail = (status: 400 | 401 | 403 | 404 | 409 | 413 | 500, message: string): never => {
  throw new HTTPException(status, { message });
};

export function newNeighborCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** "k7f 2qx", "K7F-2QX" -> "K7F2QX" */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function createApp(db: Db, cfg: AppConfig): Hono<Env> {
  const verifyGoogle = cfg.verifyGoogle ?? verifyGoogleIdToken;
  const verifyApple = cfg.verifyApple ?? verifyAppleIdToken;
  const app = new Hono<Env>();

  // ---------------------------------------------------------------- CORS
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    const self = new URL(c.req.url).origin;
    const ok = !!origin && (origin === self || cfg.allowedOrigins.includes(origin));
    if (c.req.method === 'OPTIONS') {
      const res = new Response(null, { status: 204 });
      if (ok) setCors(res.headers, origin!);
      return res;
    }
    await next();
    if (ok) setCors(c.res.headers, origin!);
    // per-user answers: never let a browser or proxy reuse one for someone else
    c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.append('Vary', 'Authorization');
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'something went wrong' }, 500);
  });
  app.notFound((c) => c.json({ error: 'not found' }, 404));

  // ---------------------------------------------------------------- sessions
  async function startSession(c: Context<Env>, who: VerifiedIdentity | { provider: 'dev'; sub: string; name: string }) {
    const now = Date.now();
    let rows = await db.query<User>('SELECT id, name FROM users WHERE provider = $1 AND provider_sub = $2', [who.provider, who.sub]);
    let user = rows[0];
    if (!user) {
      // a fresh neighbor code; retry on the (very unlikely) collision
      for (let attempt = 0; attempt < 5 && !user; attempt++) {
        try {
          rows = await db.query<User>(
            'INSERT INTO users (id, provider, provider_sub, name, neighbor_code, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name',
            [crypto.randomUUID(), who.provider, who.sub, who.name, newNeighborCode(), now],
          );
          user = rows[0];
        } catch (e) {
          if (attempt === 4) throw e;
        }
      }
    } else if (who.name && who.name !== user.name) {
      await db.query('UPDATE users SET name = $1 WHERE id = $2', [who.name, user.id]);
      user.name = who.name;
    }
    const token = newSessionToken();
    await db.query('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
      await hashToken(token),
      user!.id,
      now,
      now + SESSION_DAYS * 86400000,
    ]);
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND expires_at < $2', [user!.id, now]);
    return c.json({ token, user });
  }

  const requireUser = async (c: Context<Env>, next: () => Promise<void>) => {
    const m = /^Bearer\s+(\S+)$/.exec(c.req.header('Authorization') ?? '');
    if (!m) fail(401, 'sign in first');
    const tokenHash = await hashToken(m![1]);
    const rows = await db.query<User & { expires_at: string }>(
      'SELECT u.id, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1',
      [tokenHash],
    );
    const row = rows[0];
    if (!row || Number(row.expires_at) < Date.now()) fail(401, 'session expired, sign in again');
    c.set('user', { id: row!.id, name: row!.name });
    c.set('tokenHash', tokenHash);
    await next();
  };

  const body = async <T>(c: Context<Env>): Promise<T> => {
    try {
      return (await c.req.json()) as T;
    } catch {
      return fail(400, 'expected a JSON body');
    }
  };

  // ---------------------------------------------------------------- auth
  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/auth/google', async (c) => {
    const { credential } = await body<{ credential?: string }>(c);
    if (!credential) fail(400, 'missing credential');
    let who: VerifiedIdentity;
    try {
      who = await verifyGoogle(credential!, cfg.googleClientIds);
    } catch (e) {
      return fail(401, `google sign-in failed: ${(e as Error).message}`);
    }
    return startSession(c, who);
  });

  app.post('/auth/apple', async (c) => {
    const { identityToken, name } = await body<{ identityToken?: string; name?: string }>(c);
    if (!identityToken) fail(400, 'missing identityToken');
    let who: VerifiedIdentity;
    try {
      who = await verifyApple(identityToken!, cfg.appleClientIds, name ?? '');
    } catch (e) {
      return fail(401, `apple sign-in failed: ${(e as Error).message}`);
    }
    return startSession(c, who);
  });

  app.post('/auth/dev', async (c) => {
    if (!cfg.devAuth) fail(404, 'not found');
    const { name } = await body<{ name?: string }>(c);
    const n = (name ?? 'dev').slice(0, 60);
    return startSession(c, { provider: 'dev', sub: n, name: n });
  });

  app.post('/auth/logout', requireUser, async (c) => {
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [c.get('tokenHash')]);
    return c.body(null, 204);
  });

  app.get('/me', requireUser, (c) => c.json({ user: c.get('user') }));

  app.delete('/account', requireUser, async (c) => {
    // sessions, beach and neighbor links go with it (ON DELETE CASCADE)
    await db.query('DELETE FROM users WHERE id = $1', [c.get('user').id]);
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- beach
  const sendBeach = async (c: Context<Env>, userId: string) => {
    const rows = await db.query<{ location: string; nx: number; ny: number; version: number; updated_at: string; sand: unknown }>(
      'SELECT location, nx, ny, version, updated_at, sand FROM beaches WHERE user_id = $1',
      [userId],
    );
    const row = rows[0];
    if (!row) return c.json({ error: 'no saved beach yet' }, 404);
    const bytes = toBytes(row.sand);
    return new Response(bytes as BodyInit, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Beach-Location': row.location,
        'X-Beach-Nx': String(row.nx),
        'X-Beach-Ny': String(row.ny),
        'X-Beach-Version': String(row.version),
        'X-Beach-Updated': String(row.updated_at),
      },
    });
  };

  app.get('/beach', requireUser, (c) => sendBeach(c, c.get('user').id));

  app.put('/beach', requireUser, async (c) => {
    const location = (c.req.header('X-Beach-Location') ?? '').slice(0, 40);
    const nx = Number(c.req.header('X-Beach-Nx'));
    const ny = Number(c.req.header('X-Beach-Ny'));
    if (!/^[a-z0-9-]+$/.test(location)) fail(400, 'bad X-Beach-Location');
    if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 8 || ny < 8 || nx * ny > MAX_CELLS) fail(400, 'bad grid size');
    if (Number(c.req.header('Content-Length') ?? 0) > MAX_BEACH_BYTES) fail(413, 'beach too large');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BEACH_BYTES) fail(413, 'beach too large');
    const now = Date.now();
    const rows = await db.query<{ version: number }>(
      `INSERT INTO beaches (user_id, location, nx, ny, version, updated_at, sand) VALUES ($1, $2, $3, $4, 1, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET location = EXCLUDED.location, nx = EXCLUDED.nx, ny = EXCLUDED.ny,
         version = beaches.version + 1, updated_at = EXCLUDED.updated_at, sand = EXCLUDED.sand
       RETURNING version`,
      [c.get('user').id, location, nx, ny, now, bytes],
    );
    return c.json({ version: rows[0].version, updatedAt: now });
  });

  // ---------------------------------------------------------------- neighbors
  const parseSide = (c: Context<Env>): Side => {
    const s = c.req.param('side') as Side;
    if (!SIDES.includes(s)) fail(400, 'side must be left or right');
    return s;
  };

  interface NeighborRow {
    side: Side;
    id: string;
    name: string;
    location: string | null;
    updated_at: string | null;
  }
  const neighborJson = (r: NeighborRow) => ({
    id: r.id,
    name: r.name,
    location: r.location,
    updatedAt: r.updated_at === null ? null : Number(r.updated_at),
  });

  app.get('/neighbors', requireUser, async (c) => {
    const me = c.get('user').id;
    const [codeRows, rows, picked] = await Promise.all([
      db.query<{ neighbor_code: string }>('SELECT neighbor_code FROM users WHERE id = $1', [me]),
      db.query<NeighborRow>(
        `SELECT n.side, u.id, u.name, b.location, b.updated_at
           FROM neighbors n JOIN users u ON u.id = n.neighbor_id LEFT JOIN beaches b ON b.user_id = u.id
          WHERE n.user_id = $1`,
        [me],
      ),
      db.query<{ n: string }>('SELECT COUNT(*) AS n FROM neighbors WHERE neighbor_id = $1', [me]),
    ]);
    const bySide = (s: Side) => {
      const r = rows.find((x) => x.side === s);
      return r ? neighborJson(r) : null;
    };
    return c.json({ code: codeRows[0]?.neighbor_code, left: bySide('left'), right: bySide('right'), pickedBy: Number(picked[0]?.n ?? 0) });
  });

  app.put('/neighbors/:side', requireUser, async (c) => {
    const side = parseSide(c);
    const me = c.get('user').id;
    const { code } = await body<{ code?: string }>(c);
    const norm = normalizeCode(code ?? '');
    if (norm.length !== 6) fail(400, 'neighbor codes are 6 letters and numbers');
    const found = await db.query<{ id: string }>('SELECT id FROM users WHERE neighbor_code = $1', [norm]);
    const them = found[0];
    if (!them) fail(404, 'no beach has that code');
    if (them!.id === me) fail(400, "that's your own code");
    const other = side === 'left' ? 'right' : 'left';
    const clash = await db.query('SELECT 1 FROM neighbors WHERE user_id = $1 AND side = $2 AND neighbor_id = $3', [me, other, them!.id]);
    if (clash.length) fail(409, `they're already your ${other} neighbor`);
    await db.query(
      `INSERT INTO neighbors (user_id, side, neighbor_id, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, side) DO UPDATE SET neighbor_id = EXCLUDED.neighbor_id, created_at = EXCLUDED.created_at`,
      [me, side, them!.id, Date.now()],
    );
    const rows = await db.query<NeighborRow>(
      `SELECT $2::text AS side, u.id, u.name, b.location, b.updated_at
         FROM users u LEFT JOIN beaches b ON b.user_id = u.id WHERE u.id = $1`,
      [them!.id, side],
    );
    return c.json({ neighbor: neighborJson(rows[0]) });
  });

  app.delete('/neighbors/:side', requireUser, async (c) => {
    const side = parseSide(c);
    await db.query('DELETE FROM neighbors WHERE user_id = $1 AND side = $2', [c.get('user').id, side]);
    return c.body(null, 204);
  });

  app.get('/neighbors/:side/beach', requireUser, async (c) => {
    const side = parseSide(c);
    // you can only see the beaches you've chosen as neighbors
    const rows = await db.query<{ neighbor_id: string }>('SELECT neighbor_id FROM neighbors WHERE user_id = $1 AND side = $2', [
      c.get('user').id,
      side,
    ]);
    if (!rows[0]) return c.json({ error: 'no neighbor on that side' }, 404);
    return sendBeach(c, rows[0].neighbor_id);
  });

  // what you own beyond the free items (empty until the shop and pulls exist)
  app.get('/inventory', requireUser, async (c) => {
    const rows = await db.query<{ item_id: string; quantity: number; source: string; acquired_at: string; expires_at: string | null }>(
      `SELECT item_id, quantity, source, acquired_at, expires_at FROM inventory
        WHERE user_id = $1 AND quantity > 0 AND (expires_at IS NULL OR expires_at > $2)
        ORDER BY acquired_at`,
      [c.get('user').id, Date.now()],
    );
    return c.json({
      items: rows.map((r) => ({
        item: r.item_id,
        quantity: Number(r.quantity),
        source: r.source,
        acquiredAt: Number(r.acquired_at),
        expiresAt: r.expires_at === null ? null : Number(r.expires_at),
      })),
    });
  });

  // ---------------------------------------------------------------- the shore
  // Beaches are found by their neighbor code: whoever has a code can visit
  // (that's what the code is for). The shore is the chain of neighbor links:
  // the beach on my left, the one on its left, and so on, each way.
  interface ShoreRow {
    id: string;
    name: string;
    code: string;
    location: string | null;
    updated_at: string | null;
  }
  const shoreJson = (r: ShoreRow) => ({
    code: r.code,
    name: r.name,
    location: r.location,
    updatedAt: r.updated_at === null ? null : Number(r.updated_at),
  });
  const byCode = async (raw: string): Promise<ShoreRow | null> => {
    const code = normalizeCode(raw ?? '');
    if (code.length !== 6) return null;
    const rows = await db.query<ShoreRow>(
      `SELECT u.id, u.name, u.neighbor_code AS code, b.location, b.updated_at
         FROM users u LEFT JOIN beaches b ON b.user_id = u.id WHERE u.neighbor_code = $1`,
      [code],
    );
    return rows[0] ?? null;
  };
  const byId = async (id: string): Promise<ShoreRow> =>
    (
      await db.query<ShoreRow>(
        `SELECT u.id, u.name, u.neighbor_code AS code, b.location, b.updated_at
           FROM users u LEFT JOIN beaches b ON b.user_id = u.id WHERE u.id = $1`,
        [id],
      )
    )[0];

  // GET /shore?code=K7F2QX&depth=4: a beach (default: yours) and the beaches
  // down the shore each way, nearest first; stops at the end or a loop
  app.get('/shore', requireUser, async (c) => {
    const depth = Math.min(8, Math.max(0, Number(c.req.query('depth') ?? 4) | 0));
    const code = c.req.query('code');
    const center = code ? await byCode(code) : await byId(c.get('user').id);
    if (!center) return c.json({ error: 'no beach with that code' }, 404);
    const seen = new Set([center.id]);
    const walk = async (side: Side) => {
      const out: ShoreRow[] = [];
      let at = center.id;
      for (let i = 0; i < depth; i++) {
        const rows = await db.query<ShoreRow>(
          `SELECT u.id, u.name, u.neighbor_code AS code, b.location, b.updated_at
             FROM neighbors n JOIN users u ON u.id = n.neighbor_id LEFT JOIN beaches b ON b.user_id = u.id
            WHERE n.user_id = $1 AND n.side = $2`,
          [at, side],
        );
        const next = rows[0];
        if (!next || seen.has(next.id)) break;
        seen.add(next.id);
        out.push(next);
        at = next.id;
      }
      return out;
    };
    const left = await walk('left');
    const right = await walk('right');
    return c.json({
      center: { ...shoreJson(center), you: center.id === c.get('user').id },
      left: left.map(shoreJson),
      right: right.map(shoreJson),
    });
  });

  app.get('/beaches/:code', requireUser, async (c) => {
    const who = await byCode(c.req.param('code') ?? '');
    if (!who) return c.json({ error: 'no beach with that code' }, 404);
    return sendBeach(c, who.id);
  });

  // ---------------------------------------------------------------- favorites
  app.get('/favorites', requireUser, async (c) => {
    const rows = await db.query<ShoreRow>(
      `SELECT u.id, u.name, u.neighbor_code AS code, b.location, b.updated_at
         FROM favorites f JOIN users u ON u.id = f.fav_id LEFT JOIN beaches b ON b.user_id = u.id
        WHERE f.user_id = $1 ORDER BY f.created_at DESC LIMIT 200`,
      [c.get('user').id],
    );
    return c.json({ favorites: rows.map(shoreJson) });
  });

  app.put('/favorites/:code', requireUser, async (c) => {
    const who = await byCode(c.req.param('code') ?? '');
    if (!who) return c.json({ error: 'no beach with that code' }, 404);
    if (who.id === c.get('user').id) fail(400, "that's your own beach");
    await db.query('INSERT INTO favorites (user_id, fav_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
      c.get('user').id,
      who.id,
      Date.now(),
    ]);
    return c.json({ favorite: shoreJson(who) });
  });

  app.delete('/favorites/:code', requireUser, async (c) => {
    const who = await byCode(c.req.param('code') ?? '');
    if (who) await db.query('DELETE FROM favorites WHERE user_id = $1 AND fav_id = $2', [c.get('user').id, who.id]);
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- pulls
  // the pools, their published odds, and whether your free go is ready
  app.get('/pulls', requireUser, async (c) => {
    const now = Date.now();
    const rows = await db.query<{ pool: string }>('SELECT pool FROM pulls WHERE user_id = $1 AND day = $2', [c.get('user').id, pullDay(now)]);
    const used = new Set(rows.map((r) => r.pool));
    return c.json({
      pools: Object.values(POOLS).map((p) => ({ id: p.id, name: p.name, odds: p.odds, items: p.items, free: !used.has(p.id) })),
      nextFree: nextDay(now),
    });
  });

  // your free daily go: the server draws, records it and adds the item to your bag
  app.post('/pulls/:pool', requireUser, async (c) => {
    const id = c.req.param('pool') ?? '';
    const pool = Object.hasOwn(POOLS, id) ? POOLS[id] : undefined;
    if (!pool) fail(404, 'no such machine');
    const now = Date.now();
    const got = draw(pool!);
    // one statement, so the day is claimed and the item given together
    const rows = await db.query<{ item_id: string }>(
      `WITH claim AS (
         INSERT INTO pulls (user_id, pool, day, item_id, rarity, created_at) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING RETURNING user_id, item_id
       )
       INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at)
       SELECT user_id, item_id, 1, 'pull', $6, NULL FROM claim RETURNING item_id`,
      [c.get('user').id, pool!.id, pullDay(now), got.item, got.rarity, now],
    );
    if (!rows[0]) return c.json({ error: 'come back tomorrow', nextFree: nextDay(now) }, 409);
    return c.json({ item: got.item, rarity: got.rarity, nextFree: nextDay(now) });
  });

  app.post('/neighbors/code', requireUser, async (c) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newNeighborCode();
      try {
        await db.query('UPDATE users SET neighbor_code = $1 WHERE id = $2', [code, c.get('user').id]);
        return c.json({ code });
      } catch {
        /* collision: try another */
      }
    }
    return fail(500, 'could not make a new code');
  });

  return app;
}

function setCors(h: Headers, origin: string): void {
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', ['Authorization', 'Content-Type', ...BEACH_HEADERS].join(', '));
  h.set('Access-Control-Expose-Headers', BEACH_HEADERS.join(', '));
  h.set('Access-Control-Max-Age', '86400');
  h.append('Vary', 'Origin');
}
