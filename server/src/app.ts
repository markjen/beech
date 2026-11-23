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
//   POST   /api/gifts            { code, item }            -> { item, to: { name, code } }
//   GET    /api/inventory                                  -> { items: [{ item, quantity, source, ... }] }
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
/** most beaches one person can have */
export const BEACH_CAP = 8;
const BEACH_HEADERS = ['X-Beach-Location', 'X-Beach-Nx', 'X-Beach-Ny', 'X-Beach-Version', 'X-Beach-Updated'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];

const fail = (status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500, message: string): never => {
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
    // everyone has a home beach: its id is theirs, its code their neighbor code
    await db.query(
      `INSERT INTO beach (id, owner_id, code, home, created_at)
       SELECT id, id, neighbor_code, true, created_at FROM users WHERE id = $1
       ON CONFLICT DO NOTHING`,
      [user!.id],
    );
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

  // local development and e2e tests only (DEV_AUTH): give yourself an item
  app.post('/dev/grant', requireUser, async (c) => {
    if (!cfg.devAuth) fail(404, 'not found');
    const { item, quantity } = await body<{ item?: string; quantity?: number }>(c);
    if (!item || !/^[a-z0-9-]{1,32}$/.test(item)) fail(400, 'bad item');
    await db.query("INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at) VALUES ($1, $2, $3, 'gift', $4)", [
      c.get('user').id,
      item,
      Math.max(1, Math.min(10, Number(quantity) || 1)),
      Date.now(),
    ]);
    return c.body(null, 204);
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

  // ---------------------------------------------------------------- beaches
  // A person owns one or more beaches (docs/MULTI_BEACH.md). Their home beach
  // has their user id as its id. /api/beach is the home beach, for older apps.
  const sendBeach = async (c: Context<Env>, beachId: string) => {
    const rows = await db.query<{ location: string; nx: number; ny: number; version: number; updated_at: string; sand: unknown }>(
      'SELECT location, nx, ny, version, updated_at, sand FROM beach WHERE id = $1 AND sand IS NOT NULL',
      [beachId],
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

  /** `X-Beach-Items: starfish=1,deckchair=2` -> { starfish: 1, deckchair: 2 } (bad parts ignored) */
  const parseItems = (raw: string | undefined): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const part of (raw ?? '').split(',').slice(0, 64)) {
      const m = /^([a-z0-9-]{1,32})=(\d{1,4})$/.exec(part.trim());
      if (m) out[m[1]] = Number(m[2]);
    }
    return out;
  };

  const saveBeach = async (c: Context<Env>, beachId: string) => {
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
      `UPDATE beach SET location = $2, nx = $3, ny = $4, version = version + 1, updated_at = $5, sand = $6, items = $7
        WHERE id = $1 RETURNING version`,
      [beachId, location, nx, ny, now, bytes, JSON.stringify(parseItems(c.req.header('X-Beach-Items')))],
    );
    if (!rows[0]) fail(404, 'no such beach');
    return c.json({ version: rows[0].version, updatedAt: now });
  };

  app.get('/beach', requireUser, async (c) => sendBeach(c, await homeOf(c.get('user').id)));
  app.put('/beach', requireUser, async (c) => saveBeach(c, await homeOf(c.get('user').id)));

  /** how many beaches you may have: one, plus each extra beach you own */
  const allowance = async (user: string): Promise<number> => {
    const rows = await db.query<{ n: string | null }>(
      `SELECT SUM(quantity) AS n FROM inventory WHERE user_id = $1 AND item_id = 'beach' AND (expires_at IS NULL OR expires_at > $2)`,
      [user, Date.now()],
    );
    return Math.min(BEACH_CAP, 1 + Number(rows[0]?.n ?? 0));
  };
  /** my home beach (its id is mine unless I've made another beach home) */
  const homeOf = async (user: string): Promise<string> =>
    (await db.query<{ id: string }>('SELECT id FROM beach WHERE owner_id = $1 ORDER BY home DESC, created_at LIMIT 1', [user]))[0]?.id ?? user;
  /** one of my beaches (404 if it isn't mine); none named: my home beach */
  const mine = async (c: Context<Env>, id: string | undefined): Promise<string> => {
    const me = c.get('user').id;
    if (!id) return homeOf(me);
    if (id === me) return me;
    if (!/^[0-9a-f-]{36}$/.test(id)) fail(404, 'no such beach');
    const rows = await db.query('SELECT 1 FROM beach WHERE id = $1 AND owner_id = $2', [id, me]);
    if (!rows.length) fail(404, 'no such beach');
    return id;
  };

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
    beach_name: string;
    owner_id: string;
    code: string;
    created_at: string;
    location: string | null;
    updated_at: string | null;
  }
  // a beach and its owner's first name
  const NODE = `b.id, u.name, b.name AS beach_name, b.owner_id, b.code, b.created_at, b.location, b.updated_at`;
  const BEACH = `beach b JOIN users u ON u.id = b.owner_id`;
  const beachJson = (r: NodeRow) => ({
    code: r.code,
    name: r.name,
    /** the beach's own name, if its owner gave it one ("Bondi") */
    beachName: r.beach_name || undefined,
    location: r.location,
    updatedAt: r.updated_at === null ? null : Number(r.updated_at),
  });
  const nodeById = async (id: string): Promise<NodeRow | null> =>
    (await db.query<NodeRow>(`SELECT ${NODE} FROM ${BEACH} WHERE b.id = $1`, [id]))[0] ?? null;
  const nodeByCode = async (raw: string): Promise<NodeRow | null> => {
    const code = normalizeCode(raw ?? '');
    if (code.length !== 6) return null;
    return (await db.query<NodeRow>(`SELECT ${NODE} FROM ${BEACH} WHERE b.code = $1`, [code]))[0] ?? null;
  };
  /** which beach is on beach `id`'s `side`, if any */
  const linked = async (id: string, side: Side): Promise<NodeRow | null> =>
    (
      await db.query<NodeRow>(
        `SELECT ${NODE} FROM neighbors n JOIN ${BEACH} ON b.id = n.neighbor_beach_id WHERE n.beach_id = $1 AND n.side = $2`,
        [id, side],
      )
    )[0] ?? null;

  /** Join a and b: b on a's `side`, a on b's other side. One statement, so it's all or nothing. */
  const link = async (a: string, side: Side, b: string) => {
    const now = Date.now();
    try {
      await db.query(
        `WITH l1 AS (INSERT INTO neighbors (beach_id, side, neighbor_beach_id, created_at) VALUES ($1, $2, $3, $5) RETURNING 1),
              l2 AS (INSERT INTO neighbors (beach_id, side, neighbor_beach_id, created_at) VALUES ($3, $4, $1, $5) RETURNING 1)
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
        WHERE (from_beach = $1 AND (side = $2 OR to_beach = $3)) OR (from_beach = $3 AND (side = $4 OR to_beach = $1))
           OR (to_beach = $1 AND side = $4) OR (to_beach = $3 AND side = $2)`,
      [a, side, b, opposite(side)],
    );
  };

  app.get('/neighbors', requireUser, async (c) => {
    const me = await mine(c, c.req.query('beach'));
    const [self, left, right, outgoing, incoming] = await Promise.all([
      nodeById(me),
      linked(me, 'left'),
      linked(me, 'right'),
      db.query<NodeRow & { side: Side }>(
        `SELECT r.side, ${NODE} FROM neighbor_requests r JOIN ${BEACH} ON b.id = r.to_beach WHERE r.from_beach = $1`,
        [me],
      ),
      db.query<NodeRow & { side: Side }>(
        `SELECT r.side, ${NODE} FROM neighbor_requests r JOIN ${BEACH} ON b.id = r.from_beach
          WHERE r.to_beach = $1 ORDER BY r.created_at DESC LIMIT 50`,
        [me],
      ),
    ]);
    const out = (s: Side) => {
      const r = outgoing.find((x) => x.side === s);
      return r ? beachJson(r) : null;
    };
    return c.json({
      beach: me,
      code: self?.code,
      left: left ? beachJson(left) : null,
      right: right ? beachJson(right) : null,
      // who you've asked, per side of your beach
      asked: { left: out('left'), right: out('right') },
      // who's asking you; `side` is where they'd be on YOUR beach
      requests: incoming.map((r) => ({ ...beachJson(r), side: opposite(r.side) })),
    });
  });

  // ask someone to be on your `side` (if they already asked for the same, or
  // it's another of your own beaches, you're linked now)
  app.put('/neighbors/:side', requireUser, async (c) => {
    const side = parseSide(c);
    const me = await mine(c, c.req.query('beach'));
    const { code } = await body<{ code?: string }>(c);
    if (normalizeCode(code ?? '').length !== 6) fail(400, 'neighbor codes are 6 letters and numbers');
    const them = await nodeByCode(code!);
    if (!them) fail(404, 'no beach has that code');
    if (them!.id === me) fail(400, "that's this beach's own code");
    if (await linked(me, side)) fail(409, `you already have a ${side} neighbor: move them away first`);
    if ((await linked(me, opposite(side)))?.id === them!.id) fail(409, `they're already your ${opposite(side)} neighbor`);
    if (await linked(them!.id, opposite(side))) fail(409, `their ${opposite(side)} side is taken`);
    const theirs = await db.query('SELECT 1 FROM neighbor_requests WHERE from_beach = $1 AND to_beach = $2 AND side = $3', [
      them!.id,
      me,
      opposite(side),
    ]);
    if (theirs.length || them!.owner_id === c.get('user').id) {
      await link(me, side, them!.id);
      return c.json({ status: 'linked', neighbor: beachJson(them!) });
    }
    await db.query(
      `INSERT INTO neighbor_requests (from_beach, to_beach, side, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (from_beach, side) DO UPDATE SET to_beach = EXCLUDED.to_beach, created_at = EXCLUDED.created_at`,
      [me, them!.id, side, Date.now()],
    );
    return c.json({ status: 'asked', neighbor: beachJson(them!) });
  });

  // accept someone's request: they go on the side they asked for
  app.post('/neighbors/requests/:code/accept', requireUser, async (c) => {
    const me = await mine(c, c.req.query('beach'));
    const them = await nodeByCode(c.req.param('code') ?? '');
    if (!them) fail(404, 'no beach has that code');
    const req = (
      await db.query<{ side: Side }>('SELECT side FROM neighbor_requests WHERE from_beach = $1 AND to_beach = $2', [them!.id, me])
    )[0];
    if (!req) fail(404, 'that request is gone');
    // they asked for me on their req.side, so they go on my other side
    if (await linked(me, opposite(req!.side))) fail(409, `your ${opposite(req!.side)} side is taken: move them away first`);
    await link(them!.id, req!.side, me);
    return c.json({ side: opposite(req!.side), neighbor: beachJson(them!) });
  });

  app.delete('/neighbors/requests/:code', requireUser, async (c) => {
    const me = await mine(c, c.req.query('beach'));
    const them = await nodeByCode(c.req.param('code') ?? '');
    if (them) await db.query('DELETE FROM neighbor_requests WHERE from_beach = $1 AND to_beach = $2', [them.id, me]);
    return c.body(null, 204);
  });

  // move away from your `side` neighbor (both ends of the link go), or take back your request
  app.delete('/neighbors/:side', requireUser, async (c) => {
    const side = parseSide(c);
    const me = await mine(c, c.req.query('beach'));
    await db.query('DELETE FROM neighbors WHERE (beach_id = $1 AND side = $2) OR (neighbor_beach_id = $1 AND side = $3)', [
      me,
      side,
      opposite(side),
    ]);
    await db.query('DELETE FROM neighbor_requests WHERE from_beach = $1 AND side = $2', [me, side]);
    return c.body(null, 204);
  });

  app.get('/neighbors/:side/beach', requireUser, async (c) => {
    const side = parseSide(c);
    const n = await linked(await mine(c, c.req.query('beach')), side);
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
  const ENDS = `FROM ${BEACH}
     WHERE b.on_shore
       AND NOT EXISTS (SELECT 1 FROM neighbors n WHERE n.beach_id = b.id AND n.side = 'right')
       AND (b.sand IS NOT NULL OR EXISTS (SELECT 1 FROM neighbors n WHERE n.beach_id = b.id))`;
  /** From the end of a stretch, the first beach of the next stretch going `dir`. */
  const nextStretch = async (at: NodeRow, dir: Side): Promise<NodeRow | null> => {
    const r = await endOf(at, 'right');
    const key = [r.created_at, r.id];
    // came all the way round to the stretch we started in: that's everyone
    const same = (n: NodeRow | undefined) => !!n && n.id === r.id;
    if (dir === 'left') {
      const rows =
        (await db.query<NodeRow>(`SELECT ${NODE} ${ENDS} AND (b.created_at, b.id) > ($1::bigint, $2::uuid) ORDER BY b.created_at, b.id LIMIT 1`, key)).concat(
          await db.query<NodeRow>(`SELECT ${NODE} ${ENDS} ORDER BY b.created_at, b.id LIMIT 1`),
        );
      return rows[0] && !same(rows[0]) ? rows[0] : null; // enter it at its right-hand end, walking left
    }
    const rows =
      (await db.query<NodeRow>(`SELECT ${NODE} ${ENDS} AND (b.created_at, b.id) < ($1::bigint, $2::uuid) ORDER BY b.created_at DESC, b.id DESC LIMIT 1`, key)).concat(
        await db.query<NodeRow>(`SELECT ${NODE} ${ENDS} ORDER BY b.created_at DESC, b.id DESC LIMIT 1`),
      );
    return rows[0] && !same(rows[0]) ? endOf(rows[0], 'left') : null; // enter it at its left-hand end, walking right
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
    const center = code ? await nodeByCode(code) : await nodeById(await mine(c, c.req.query('beach')));
    if (!center) return c.json({ error: 'no beach with that code' }, 404);
    const { left, right } = await walk(center, ['left', 'right'], depth, new Set([center.id]));
    return c.json({ center: { ...beachJson(center), you: center.owner_id === c.get('user').id }, left, right });
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


  // ---------------------------------------------------------------- favorites
  app.get('/favorites', requireUser, async (c) => {
    const rows = await db.query<NodeRow>(
      `SELECT ${NODE}
         FROM favorites f JOIN ${BEACH} ON b.id = f.beach_id
        WHERE f.user_id = $1 ORDER BY f.created_at DESC LIMIT 200`,
      [c.get('user').id],
    );
    return c.json({ favorites: rows.map(shoreJson) });
  });

  app.put('/favorites/:code', requireUser, async (c) => {
    const who = await byCode(c.req.param('code') ?? '');
    if (!who) return c.json({ error: 'no beach with that code' }, 404);
    if (who.owner_id === c.get('user').id) fail(400, "that's your own beach");
    await db.query('INSERT INTO favorites (user_id, beach_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
      c.get('user').id,
      who.id,
      Date.now(),
    ]);
    return c.json({ favorite: shoreJson(who) });
  });

  app.delete('/favorites/:code', requireUser, async (c) => {
    const who = await byCode(c.req.param('code') ?? '');
    if (who) await db.query('DELETE FROM favorites WHERE user_id = $1 AND beach_id = $2', [c.get('user').id, who.id]);
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
    const me = await mine(c, c.req.query('beach'));
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newNeighborCode();
      try {
        await db.query('UPDATE beach SET code = $1 WHERE id = $2', [code, me]);
        if (me === c.get('user').id) await db.query('UPDATE users SET neighbor_code = $1 WHERE id = $2', [code, me]).catch(() => {});
        return c.json({ code });
      } catch {
        /* collision: try another */
      }
    }
    return fail(500, 'could not make a new code');
  });

  // ---------------------------------------------------------------- my beaches
  const myBeaches = async (user: string) => {
    const rows = await db.query<NodeRow & { home: boolean; on_shore: boolean; items: Record<string, number> | string }>(
      `SELECT ${NODE}, b.home, b.on_shore, b.items FROM ${BEACH} WHERE b.owner_id = $1 ORDER BY b.home DESC, b.created_at`,
      [user],
    );
    return Promise.all(
      rows.map(async (r) => {
        const [left, right] = await Promise.all([linked(r.id, 'left'), linked(r.id, 'right')]);
        return {
          id: r.id,
          code: r.code,
          name: r.beach_name,
          home: r.home,
          onShore: r.on_shore,
          location: r.location,
          updatedAt: r.updated_at === null ? null : Number(r.updated_at),
          items: typeof r.items === 'string' ? (JSON.parse(r.items) as Record<string, number>) : r.items,
          left: left ? { ...beachJson(left), yours: left.owner_id === user } : null,
          right: right ? { ...beachJson(right), yours: right.owner_id === user } : null,
        };
      }),
    );
  };

  app.get('/beaches/mine', requireUser, async (c) => {
    const me = c.get('user').id;
    const [beaches, allowed] = await Promise.all([myBeaches(me), allowance(me)]);
    return c.json({ allowance: allowed, cap: BEACH_CAP, beaches });
  });

  // make another beach (if your allowance has room)
  app.post('/beaches/mine', requireUser, async (c) => {
    const me = c.get('user').id;
    const { name, location } = await body<{ name?: string; location?: string }>(c);
    const loc = (location ?? '').slice(0, 40);
    if (loc && !/^[a-z0-9-]+$/.test(loc)) fail(400, 'bad location');
    const now = Date.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        // one statement: only if you're under your allowance
        const rows = await db.query<{ id: string }>(
          `INSERT INTO beach (id, owner_id, code, name, home, location, created_at)
           SELECT $1, $2, $3, $4, false, NULLIF($5, ''), $6
            WHERE (SELECT COUNT(*) FROM beach WHERE owner_id = $2) < $7
           RETURNING id`,
          [crypto.randomUUID(), me, newNeighborCode(), (name ?? '').trim().slice(0, 30), loc, now, await allowance(me)],
        );
        if (!rows[0]) fail(409, 'no room for another beach: get an extra beach first');
        return c.json({ beach: (await myBeaches(me)).find((b) => b.id === rows[0].id) });
      } catch (e) {
        if (e instanceof HTTPException) throw e;
        if (attempt === 4) throw e; // (a code collision: try another)
      }
    }
    return fail(500, 'could not make a beach');
  });

  app.patch('/beaches/mine/:id', requireUser, async (c) => {
    const me = c.get('user').id;
    const id = await mine(c, c.req.param('id'));
    const p = await body<{ name?: string; location?: string; onShore?: boolean; home?: boolean }>(c);
    if (p.location !== undefined && !/^[a-z0-9-]{1,40}$/.test(p.location)) fail(400, 'bad location');
    if (p.name !== undefined) await db.query('UPDATE beach SET name = $1 WHERE id = $2', [String(p.name).trim().slice(0, 30), id]);
    if (p.location !== undefined) await db.query('UPDATE beach SET location = $1 WHERE id = $2', [p.location, id]);
    if (p.onShore !== undefined) await db.query('UPDATE beach SET on_shore = $1 WHERE id = $2', [!!p.onShore, id]);
    if (p.home === true) {
      // one statement, so there's always exactly one home
      await db.query('UPDATE beach SET home = (id = $1) WHERE owner_id = $2', [id, me]);
    }
    return c.json({ beach: (await myBeaches(me)).find((b) => b.id === id) });
  });

  app.delete('/beaches/mine/:id', requireUser, async (c) => {
    const id = await mine(c, c.req.param('id'));
    // links, requests and favorites go with it (ON DELETE CASCADE)
    const rows = await db.query('DELETE FROM beach WHERE id = $1 AND NOT home RETURNING id', [id]);
    if (!rows.length) fail(400, "your home beach can't be removed (make another one home first)");
    return c.body(null, 204);
  });

  app.get('/beaches/mine/:id/sand', requireUser, async (c) => sendBeach(c, await mine(c, c.req.param('id'))));
  app.put('/beaches/mine/:id/sand', requireUser, async (c) => saveBeach(c, await mine(c, c.req.param('id'))));

  // (after /beaches/mine…, so 'mine' isn't taken for a code)
  app.get('/beaches/:code', requireUser, async (c) => {
    const who = await byCode(c.req.param('code') ?? '');
    if (!who) return c.json({ error: 'no beach with that code' }, 404);
    return sendBeach(c, who.id);
  });

  // ---------------------------------------------------------------- gifts
  // Give one of your items to the owner of the beach with that code. Instant:
  // there is no inbox to accept it in. One statement moves it, so two gifts
  // of the same last item can't both go through: the second UPDATE finds
  // quantity 0 and moves nothing. Free items have no inventory rows, so
  // there is nothing to give (everyone already has them). The row on the
  // sand is untouched: gifting moves what you own, not what's placed.
  const GIFT_PER_HOUR = 20;
  app.post('/gifts', requireUser, async (c) => {
    const { code, item } = await body<{ code?: string; item?: string }>(c);
    if (normalizeCode(code ?? '').length !== 6) fail(400, 'neighbor codes are 6 letters and numbers');
    if (!item || typeof item !== 'string' || item.length > 40) fail(400, 'say which item to give');
    const me = c.get('user').id;
    const them = await nodeByCode(code!);
    if (!them) fail(404, 'no beach has that code');
    if (them!.owner_id === me) fail(400, "that's your own code");
    const now = Date.now();
    const recent = await db.query<{ n: string }>(
      'SELECT COUNT(*) AS n FROM gifts WHERE from_id = $1 AND created_at > $2',
      [me, now - 3600000],
    );
    if (Number(recent[0].n) >= GIFT_PER_HOUR) fail(429, 'slow down: 20 gifts an hour is the limit');
    // take your oldest unexpired row of that item (one statement, so a race
    // on the last one leaves the second gift with nothing to move)
    const rows = await db.query<{ moved: string }>(
      `WITH giver AS (
         UPDATE inventory SET quantity = quantity - 1
          WHERE id = (
            SELECT id FROM inventory
             WHERE user_id = $1 AND item_id = $2 AND quantity > 0
               AND (expires_at IS NULL OR expires_at > $3)
             ORDER BY acquired_at ASC LIMIT 1
          ) AND quantity > 0
         RETURNING item_id, expires_at
       ), given AS (
         INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at)
         SELECT $4, item_id, 1, 'gift', $3, expires_at FROM giver
         RETURNING item_id
       ), logged AS (
         INSERT INTO gifts (from_id, to_id, item_id, created_at)
         SELECT $1, $4, item_id, $3 FROM giver
         RETURNING item_id
       )
       SELECT (SELECT COUNT(*) FROM giver) AS moved`,
      [me, item, now, them!.owner_id],
    );
    if (Number(rows[0].moved) === 0) fail(409, "you don't have one of those to give");
    return c.json({ item, to: { name: them!.name, code: them!.code } });
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
