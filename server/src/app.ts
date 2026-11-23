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
//   GET    /api/neighbors                                  -> { code, left, right, asked, requests }
//   PUT    /api/neighbors/:side  { code }                  -> { status: asked | linked, neighbor }
//   POST   /api/neighbors/requests/:code/accept            -> { side, neighbor }
//   DELETE /api/neighbors/requests/:code                   -> 204 (decline)
//   DELETE /api/neighbors/:side                            -> 204 (move away / take back the request)
//   GET    /api/shore?code=&depth=, /api/shore/more?from=&dir=&count=   the global beachfront
//   GET    /api/neighbors/:side/beach                      -> that neighbor's sand bytes | 404
//   POST   /api/neighbors/code                             -> { code } (new code; old one stops working)
//
// Auth: `Authorization: Bearer <token>`; only the token's SHA-256 is stored.

import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { POOLS, cooldownAfter, draw, pullDay, starterPrize, STARTER } from './pulls.js';
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
  /** the clock (tests move it forward) */
  now?: () => number;
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
  // Mutual: you ask someone to be on your left (or right); when they accept,
  // you're on their right (or left). One person per side, both ways.
  const parseSide = (c: Context<Env>): Side => {
    const s = c.req.param('side') as Side;
    if (!SIDES.includes(s)) fail(400, 'side must be left or right');
    return s;
  };
  const opposite = (s: Side): Side => (s === 'left' ? 'right' : 'left');

  interface NodeRow {
    id: string;
    name: string;
    code: string;
    created_at: string;
    location: string | null;
    updated_at: string | null;
  }
  const NODE = `u.id, u.name, u.neighbor_code AS code, u.created_at, b.location, b.updated_at`;
  const beachJson = (r: NodeRow) => ({
    code: r.code,
    name: r.name,
    location: r.location,
    updatedAt: r.updated_at === null ? null : Number(r.updated_at),
  });
  const nodeById = async (id: string): Promise<NodeRow | null> =>
    (await db.query<NodeRow>(`SELECT ${NODE} FROM users u LEFT JOIN beaches b ON b.user_id = u.id WHERE u.id = $1`, [id]))[0] ?? null;
  const nodeByCode = async (raw: string): Promise<NodeRow | null> => {
    const code = normalizeCode(raw ?? '');
    if (code.length !== 6) return null;
    return (await db.query<NodeRow>(`SELECT ${NODE} FROM users u LEFT JOIN beaches b ON b.user_id = u.id WHERE u.neighbor_code = $1`, [code]))[0] ?? null;
  };
  /** who's on `id`'s `side`, if anyone */
  const linked = async (id: string, side: Side): Promise<NodeRow | null> =>
    (
      await db.query<NodeRow>(
        `SELECT ${NODE} FROM neighbors n JOIN users u ON u.id = n.neighbor_id LEFT JOIN beaches b ON b.user_id = u.id
          WHERE n.user_id = $1 AND n.side = $2`,
        [id, side],
      )
    )[0] ?? null;

  /** Join a and b: b on a's `side`, a on b's other side. One statement, so it's all or nothing. */
  const link = async (a: string, side: Side, b: string) => {
    const now = Date.now();
    try {
      await db.query(
        `WITH l1 AS (INSERT INTO neighbors (user_id, side, neighbor_id, created_at) VALUES ($1, $2, $3, $5) RETURNING 1),
              l2 AS (INSERT INTO neighbors (user_id, side, neighbor_id, created_at) VALUES ($3, $4, $1, $5) RETURNING 1)
         SELECT (SELECT COUNT(*) FROM l1) + (SELECT COUNT(*) FROM l2) AS n`,
        [a, side, b, opposite(side), now],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') fail(409, 'that side was just taken');
      throw e;
    }
    // requests that can't happen any more: these two, and anyone else asking for the sides now taken
    await db.query(
      `DELETE FROM neighbor_requests
        WHERE (from_id = $1 AND (side = $2 OR to_id = $3)) OR (from_id = $3 AND (side = $4 OR to_id = $1))
           OR (to_id = $1 AND side = $4) OR (to_id = $3 AND side = $2)`,
      [a, side, b, opposite(side)],
    );
  };

  app.get('/neighbors', requireUser, async (c) => {
    const me = c.get('user').id;
    const [self, left, right, outgoing, incoming] = await Promise.all([
      nodeById(me),
      linked(me, 'left'),
      linked(me, 'right'),
      db.query<NodeRow & { side: Side }>(
        `SELECT r.side, ${NODE} FROM neighbor_requests r JOIN users u ON u.id = r.to_id LEFT JOIN beaches b ON b.user_id = u.id
          WHERE r.from_id = $1`,
        [me],
      ),
      db.query<NodeRow & { side: Side }>(
        `SELECT r.side, ${NODE} FROM neighbor_requests r JOIN users u ON u.id = r.from_id LEFT JOIN beaches b ON b.user_id = u.id
          WHERE r.to_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
        [me],
      ),
    ]);
    const out = (s: Side) => {
      const r = outgoing.find((x) => x.side === s);
      return r ? beachJson(r) : null;
    };
    return c.json({
      code: self?.code,
      left: left ? beachJson(left) : null,
      right: right ? beachJson(right) : null,
      // who you've asked, per side of your beach
      asked: { left: out('left'), right: out('right') },
      // who's asking you; `side` is where they'd be on YOUR beach
      requests: incoming.map((r) => ({ ...beachJson(r), side: opposite(r.side) })),
    });
  });

  // ask someone to be on your `side` (if they already asked for the same, you're linked now)
  app.put('/neighbors/:side', requireUser, async (c) => {
    const side = parseSide(c);
    const me = c.get('user').id;
    const { code } = await body<{ code?: string }>(c);
    if (normalizeCode(code ?? '').length !== 6) fail(400, 'neighbor codes are 6 letters and numbers');
    const them = await nodeByCode(code!);
    if (!them) fail(404, 'no beach has that code');
    if (them!.id === me) fail(400, "that's your own code");
    if (await linked(me, side)) fail(409, `you already have a ${side} neighbor: move them away first`);
    if ((await linked(me, opposite(side)))?.id === them!.id) fail(409, `they're already your ${opposite(side)} neighbor`);
    if (await linked(them!.id, opposite(side))) fail(409, `their ${opposite(side)} side is taken`);
    const theirs = await db.query('SELECT 1 FROM neighbor_requests WHERE from_id = $1 AND to_id = $2 AND side = $3', [
      them!.id,
      me,
      opposite(side),
    ]);
    if (theirs.length) {
      await link(me, side, them!.id);
      return c.json({ status: 'linked', neighbor: beachJson(them!) });
    }
    await db.query(
      `INSERT INTO neighbor_requests (from_id, to_id, side, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (from_id, side) DO UPDATE SET to_id = EXCLUDED.to_id, created_at = EXCLUDED.created_at`,
      [me, them!.id, side, Date.now()],
    );
    return c.json({ status: 'asked', neighbor: beachJson(them!) });
  });

  // accept someone's request: they go on the side they asked for
  app.post('/neighbors/requests/:code/accept', requireUser, async (c) => {
    const me = c.get('user').id;
    const them = await nodeByCode(c.req.param('code') ?? '');
    if (!them) fail(404, 'no beach has that code');
    const req = (
      await db.query<{ side: Side }>('SELECT side FROM neighbor_requests WHERE from_id = $1 AND to_id = $2', [them!.id, me])
    )[0];
    if (!req) fail(404, 'that request is gone');
    // they asked for me on their req.side, so they go on my other side
    if (await linked(me, opposite(req!.side))) fail(409, `your ${opposite(req!.side)} side is taken: move them away first`);
    await link(them!.id, req!.side, me);
    return c.json({ side: opposite(req!.side), neighbor: beachJson(them!) });
  });

  app.delete('/neighbors/requests/:code', requireUser, async (c) => {
    const them = await nodeByCode(c.req.param('code') ?? '');
    if (them) await db.query('DELETE FROM neighbor_requests WHERE from_id = $1 AND to_id = $2', [them.id, c.get('user').id]);
    return c.body(null, 204);
  });

  // move away from your `side` neighbor (both ends of the link go), or take back your request
  app.delete('/neighbors/:side', requireUser, async (c) => {
    const side = parseSide(c);
    const me = c.get('user').id;
    await db.query('DELETE FROM neighbors WHERE (user_id = $1 AND side = $2) OR (neighbor_id = $1 AND side = $3)', [me, side, opposite(side)]);
    await db.query('DELETE FROM neighbor_requests WHERE from_id = $1 AND side = $2', [me, side]);
    return c.body(null, 204);
  });

  app.get('/neighbors/:side/beach', requireUser, async (c) => {
    const side = parseSide(c);
    const n = await linked(c.get('user').id, side);
    if (!n) return c.json({ error: 'no neighbor on that side' }, 404);
    return sendBeach(c, n.id);
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
  // One global beachfront. Linked neighbors make stretches of shore; past the
  // end of a stretch the shore carries on into the next stretch, in a fixed
  // order (by when each stretch's right-hand end joined), round and round. So
  // you can keep walking either way and meet everyone.
  /** the far end of a's stretch, going `side` */
  const endOf = async (a: NodeRow, side: Side): Promise<NodeRow> => {
    let at = a;
    const seen = new Set([a.id]);
    for (let i = 0; i < 2000; i++) {
      const next = await linked(at.id, side);
      if (!next || seen.has(next.id)) break;
      seen.add(next.id);
      at = next;
    }
    return at;
  };
  // the right-hand ends of stretches worth visiting (someone with a beach, or linked to someone)
  const ENDS = `FROM users u LEFT JOIN beaches b ON b.user_id = u.id
     WHERE NOT EXISTS (SELECT 1 FROM neighbors n WHERE n.user_id = u.id AND n.side = 'right')
       AND (b.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM neighbors n WHERE n.user_id = u.id))`;
  /** From the end of a stretch, the first beach of the next stretch going `dir`. */
  const nextStretch = async (at: NodeRow, dir: Side): Promise<NodeRow | null> => {
    const r = await endOf(at, 'right');
    const key = [r.created_at, r.id];
    if (dir === 'left') {
      const rows =
        (await db.query<NodeRow>(`SELECT ${NODE} ${ENDS} AND (u.created_at, u.id) > ($1::bigint, $2::uuid) ORDER BY u.created_at, u.id LIMIT 1`, key)).concat(
          await db.query<NodeRow>(`SELECT ${NODE} ${ENDS} ORDER BY u.created_at, u.id LIMIT 1`),
        );
      return rows[0] ?? null; // enter it at its right-hand end, walking left
    }
    const rows =
      (await db.query<NodeRow>(`SELECT ${NODE} ${ENDS} AND (u.created_at, u.id) < ($1::bigint, $2::uuid) ORDER BY u.created_at DESC, u.id DESC LIMIT 1`, key)).concat(
        await db.query<NodeRow>(`SELECT ${NODE} ${ENDS} ORDER BY u.created_at DESC, u.id DESC LIMIT 1`),
      );
    return rows[0] ? endOf(rows[0], 'left') : null; // enter it at its left-hand end, walking right
  };
  type Step = ReturnType<typeof beachJson> & { linked: boolean };
  /**
   * Walk up to `count` beaches each way from `from` (one step left, one step
   * right, and so on, so the nearest come first and a small world isn't all
   * used up on one side). `linked` says if a beach is a real neighbor of the
   * one before it. Stops in a direction once it comes round to someone seen.
   */
  const walk = async (from: NodeRow, dirs: Side[], count: number, seen: Set<string>) => {
    const out: Record<Side, Step[]> = { left: [], right: [] };
    const at: Record<Side, NodeRow> = { left: from, right: from };
    const done = new Set<Side>(SIDES.filter((d) => !dirs.includes(d)));
    for (let i = 0; i < count && done.size < 2; i++) {
      for (const dir of dirs) {
        if (done.has(dir)) continue;
        let next = await linked(at[dir].id, dir);
        let isLink = true;
        if (!next) {
          next = await nextStretch(at[dir], dir);
          isLink = false;
        }
        if (!next || seen.has(next.id)) {
          done.add(dir); // been all the way round
          continue;
        }
        seen.add(next.id);
        out[dir].push({ ...beachJson(next), linked: isLink });
        at[dir] = next;
      }
    }
    return out;
  };

  // GET /shore?code=K7F2QX&depth=6: a beach (default: yours) and the shore each way, nearest first
  app.get('/shore', requireUser, async (c) => {
    const depth = Math.min(12, Math.max(0, Number(c.req.query('depth') ?? 6) | 0));
    const code = c.req.query('code');
    const center = code ? await nodeByCode(code) : await nodeById(c.get('user').id);
    if (!center) return c.json({ error: 'no beach with that code' }, 404);
    const { left, right } = await walk(center, ['left', 'right'], depth, new Set([center.id]));
    return c.json({ center: { ...beachJson(center), you: center.id === c.get('user').id }, left, right });
  });

  // GET /shore/more?from=K7F2QX&dir=left&count=6: keep walking (infinite scroll)
  app.get('/shore/more', requireUser, async (c) => {
    const dir = c.req.query('dir') as Side;
    if (!SIDES.includes(dir)) fail(400, 'dir must be left or right');
    const count = Math.min(12, Math.max(1, Number(c.req.query('count') ?? 6) | 0));
    const from = await nodeByCode(c.req.query('from') ?? '');
    if (!from) return c.json({ error: 'no beach with that code' }, 404);
    return c.json({ beaches: (await walk(from, [dir], count, new Set([from.id])))[dir] });
  });

  const byCode = nodeByCode;
  const shoreJson = beachJson;

  app.get('/beaches/:code', requireUser, async (c) => {
    const who = await byCode(c.req.param('code') ?? '');
    if (!who) return c.json({ error: 'no beach with that code' }, 404);
    return sendBeach(c, who.id);
  });

  // ---------------------------------------------------------------- favorites
  app.get('/favorites', requireUser, async (c) => {
    const rows = await db.query<NodeRow>(
      `SELECT ${NODE}
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
  const clock = () => cfg.now?.() ?? Date.now();
  // when each of your machines is free again (no row: right now)
  const freeAt = async (user: string) => {
    const rows = await db.query<{ pool: string; next_at: string; count: number }>(
      'SELECT pool, next_at, count FROM pull_state WHERE user_id = $1',
      [user],
    );
    return new Map(rows.map((r) => [r.pool, { at: Number(r.next_at), count: Number(r.count) }]));
  };

  app.get('/pulls', requireUser, async (c) => {
    const now = clock();
    const state = await freeAt(c.get('user').id);
    const daily = state.get('daily');
    return c.json({
      pools: Object.values(POOLS).map((p) => {
        const st = state.get(p.id);
        return {
          id: p.id,
          name: p.name,
          odds: p.odds,
          items: p.items,
          free: !st || st.at <= now,
          // how long you'll wait after this go before the next
          nextCooldown: cooldownAfter((st?.count ?? 0) + 1),
          // the fixed first prizes, shown before the odds
          starter: { rare: STARTER.rare.item, paid: STARTER.paid.item, beach: STARTER.beach.item, beachAfterMs: STARTER.beachAfterMs },
        };
      }),
      nextFree: daily && daily.at > now ? daily.at : now,
    });
  });

  // your free go: the server draws, records it and adds the prize to your bag.
  // The wait before the next go starts at 5 minutes and doubles each time, up
  // to once a day.
  app.post('/pulls/:pool', requireUser, async (c) => {
    const id = c.req.param('pool') ?? '';
    const pool = Object.hasOwn(POOLS, id) ? POOLS[id] : undefined;
    if (!pool) fail(404, 'no such machine');
    const me = c.get('user').id;
    const now = clock();
    await db.query('INSERT INTO pull_state (user_id, pool, count, next_at) VALUES ($1, $2, 0, 0) ON CONFLICT DO NOTHING', [me, pool!.id]);
    const count = Number((await db.query<{ count: number }>('SELECT count FROM pull_state WHERE user_id = $1 AND pool = $2', [me, pool!.id]))[0].count);
    // the first goes are fixed gifts (the machine says so); the rest are drawn
    const hist = (
      await db.query<{ first: string | null; beach: boolean | null }>(
        'SELECT MIN(created_at) AS first, BOOL_OR(item_id = $3) AS beach FROM pulls WHERE user_id = $1 AND pool = $2',
        [me, pool!.id, STARTER.beach.item],
      )
    )[0];
    const got =
      starterPrize(count + 1, hist?.first == null ? null : Number(hist.first), now, !!hist?.beach) ?? draw(pool!);
    const wait = cooldownAfter(count + 1);
    // one statement: claim the go (only if it's free and nobody claimed it
    // meanwhile), log it, and give the prize
    const rows = await db.query<{ item_id: string }>(
      `WITH claim AS (
         UPDATE pull_state SET count = count + 1, next_at = $6 + $7
          WHERE user_id = $1 AND pool = $2 AND next_at <= $6 AND count = $8
          RETURNING user_id
       ), logged AS (
         INSERT INTO pulls (user_id, pool, day, item_id, rarity, created_at)
         SELECT user_id, $2, $3, $4, $5, $6 FROM claim RETURNING user_id
       )
       INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at)
       SELECT user_id, $4, 1, 'pull', $6, NULL FROM logged RETURNING item_id`,
      [me, pool!.id, pullDay(now), got.item, got.rarity, now, wait, count],
    );
    const st = (await freeAt(me)).get(pool!.id);
    if (!rows[0]) return c.json({ error: 'not yet: the claw is resting', nextFree: st?.at ?? now }, 409);
    return c.json({ item: got.item, rarity: got.rarity, nextFree: st?.at ?? now + wait });
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
