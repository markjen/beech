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
//   POST   /api/dig-finds        { pathM, durationMs }     -> { found, item?, rarity?, findsToday, findsLeft, nextFindsAt }
//
// Auth: `Authorization: Bearer <token>`; only the token's SHA-256 is stored.

import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { PRODUCTS, productById } from './products.js';
import {
  discountCents,
  formatCents,
  hashesEqual,
  hashGiftCode,
  isAdminEmail,
  isGiftCodeShape,
  isPromoCodeShape,
  newGiftCardCode,
  normalizePromoCode,
  promoBlocked,
  type Promo,
} from './giftCards.js';
import { appleRefund, googleVoided, verifyAppleTransaction, verifyGooglePurchase, type VerifiedPurchase } from './store.js';
import { POOLS, GRAB_CHANCE, cooldownAfter, cryptoRandom, draw, grab, pullDay, starterPrize, STARTER, type Rarity } from './pulls.js';
import { currentSet, drawVending, nextUtcMidnight } from './vending.js';
import { DIG_FIND_DAILY_CAP, DIG_FIND_ROLL_COOLDOWN_MS, digDraw, qualifiesForFind } from './digFinds.js';
import { hashToken, newSessionToken, SESSION_DAYS, verifyAppleIdToken, verifyGoogleIdToken, type VerifiedIdentity } from './auth.js';
import { toBytes, type Db } from './db.js';
import { createRateLimiter, logEvent, parseClientEvent, routeLabel } from './observability.js';

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
  /** the dice (tests force a miss) */
  rand?: () => number;
  /** the iOS bundle id and Android package the store purchases are for */
  appleBundleId?: string;
  androidPackage?: string;
  /** Google Play notifications (Pub/Sub push): the push's OIDC audience and service account */
  googleRtdn?: { audience: string; email: string };
  /**
   * Admin access (docs/GIFT_CARDS_PROMOS.md): the Google accounts allowed
   * into the admin console, by verified email (exact match, case-insensitive).
   * Empty means nobody — the console stays closed. Set ADMIN_EMAILS to
   * markjen@gmail.com in production.
   */
  adminEmails?: string[];
  /**
   * The CLI's credential: the SHA-256 hex of the ADMIN_API_TOKEN env var
   * (hashed once at startup in server.ts, so the raw token is never held
   * past boot). Unset means the CLI can't authenticate.
   */
  adminTokenHash?: string;
  /** pepper for gift card code hashes (GIFT_CODE_PEPPER, required in production) */
  codePepper?: string;
  /** injectable for tests: how purchases and refunds are checked */
  stores?: {
    apple?: (jws: string, bundleId: string) => Promise<VerifiedPurchase>;
    google?: (pkg: string, productId: string, token: string) => Promise<VerifiedPurchase>;
    appleRefund?: (signedPayload: string, bundleId: string) => Promise<string | null>;
    googleVoided?: typeof googleVoided;
  };
}

export interface User {
  id: string;
  name: string;
}

type Env = { Variables: { user: User; tokenHash: string; adminActor: string; adminEmail: string | null } };

const MAX_BEACH_BYTES = 768 * 1024;
const MAX_CELLS = 400 * 300;
/** most beaches one person can have */
export const BEACH_CAP = 8;
const BEACH_HEADERS = ['X-Beach-Location', 'X-Beach-Nx', 'X-Beach-Ny', 'X-Beach-Version', 'X-Beach-Updated'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];

const fail = (status: 400 | 401 | 403 | 404 | 409 | 413 | 426 | 429 | 500, message: string): never => {
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

  // Request logging (httpLogger) is mounted once, on the root app in
  // server.ts, so it covers /api/* and the CORS preflight. Mounting it here
  // too would log every API request twice and double the metrics.

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
    // A real 500: log it structured (the request line already has the status).
    // The stack stays in Cloud Logging; the client only ever sees the generic text.
    logEvent(
      'api_error',
      { route: routeLabel(c), message: err.message, stack: String(err.stack ?? '').slice(0, 1000) },
      'ERROR',
    );
    return c.json({ error: 'something went wrong' }, 500);
  });
  app.notFound((c) => c.json({ error: 'not found' }, 404));

  // ---------------------------------------------------------------- sessions
  async function startSession(c: Context<Env>, who: VerifiedIdentity | { provider: 'dev'; sub: string; name: string }) {
    const now = Date.now();
    const email = 'email' in who ? who.email ?? null : null;
    let rows = await db.query<User>('SELECT id, name FROM users WHERE provider = $1 AND provider_sub = $2', [who.provider, who.sub]);
    let user = rows[0];
    if (!user) {
      // a fresh neighbor code; retry on the (very unlikely) collision
      for (let attempt = 0; attempt < 5 && !user; attempt++) {
        try {
          rows = await db.query<User>(
            'INSERT INTO users (id, provider, provider_sub, name, neighbor_code, email, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name',
            [crypto.randomUUID(), who.provider, who.sub, who.name, newNeighborCode(), email, now],
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
    // a Google sign-in refreshes the verified email (the admin allowlist
    // reads it); an unverified or absent address never overwrites a stored one
    if (email) await db.query('UPDATE users SET email = $1 WHERE id = $2 AND (email IS NULL OR email <> $1)', [email, user!.id]);
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

  // ---------------------------------------------------------------- admin
  // Two ways in, both checked server-side on every request; nothing here
  // trusts the client, and DEV_AUTH never counts (a dev user has no verified
  // Google email, so the allowlist rejects it):
  //   - the web console: a normal session, whose user signed in with Google
  //     and whose verified email is on ADMIN_EMAILS (markjen@gmail.com);
  //   - the CLI: `Authorization: Bearer <ADMIN_API_TOKEN>`, compared by
  //     hash in constant time against the hashed env value.
  // Either way the actor is recorded for the audit log ('cli-token' for the
  // CLI). A wrong credential gets the same flat denial as a non-admin, so
  // nothing about the allowlist leaks.
  const adminEmails = cfg.adminEmails ?? [];
  const adminLimiter = createRateLimiter(60);
  const requireAdmin = async (c: Context<Env>, next: () => Promise<void>) => {
    const ip = (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown';
    if (!adminLimiter(ip)) return c.json({ error: 'slow down' }, 429);
    const m = /^Bearer\s+(\S+)$/.exec(c.req.header('Authorization') ?? '');
    if (m && cfg.adminTokenHash) {
      if (hashesEqual(await hashToken(m[1]), cfg.adminTokenHash)) {
        c.set('adminActor', 'cli-token');
        c.set('adminEmail', null);
        await next();
        return;
      }
      // a wrong CLI token: fall through to the session check, so a valid
      // admin session still works; a wrong token alone never gets in
    }
    if (!m) fail(401, 'sign in first');
    const tokenHash = await hashToken(m![1]);
    const rows = await db.query<{ id: string; provider: string; email: string | null; expires_at: string }>(
      'SELECT u.id, u.provider, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1',
      [tokenHash],
    );
    const row = rows[0];
    if (!row || Number(row.expires_at) < Date.now()) fail(401, 'session expired, sign in again');
    if (row.provider !== 'google' || !isAdminEmail(row.email, adminEmails)) fail(403, 'not allowed');
    c.set('adminActor', row.id);
    c.set('adminEmail', row.email);
    await next();
  };

  /** an admin audit line. `detail` must never hold a code value. */
  const audit = async (actor: string, action: string, targetType: string, targetId: string, detail: Record<string, unknown>) => {
    await db.query('INSERT INTO admin_audit (actor, action, target_type, target_id, detail, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
      actor,
      action,
      targetType,
      targetId,
      JSON.stringify(detail),
      Date.now(),
    ]);
  };

  const pepper = cfg.codePepper ?? '';
  const giftCardJson = (r: {
    id: string;
    amount_cents: number;
    status: string;
    issued_at: string;
    expires_at: string | null;
    redeemed_at: string | null;
    note: string;
    redeemed_name?: string | null;
  }) => ({
    id: r.id,
    amountCents: Number(r.amount_cents),
    amount: formatCents(Number(r.amount_cents)),
    status: r.status,
    issuedAt: Number(r.issued_at),
    expiresAt: r.expires_at === null ? null : Number(r.expires_at),
    redeemedAt: r.redeemed_at === null ? null : Number(r.redeemed_at),
    redeemedBy: r.redeemed_name ?? undefined,
    note: r.note,
  });

  const body = async <T>(c: Context<Env>): Promise<T> => {
    try {
      return (await c.req.json()) as T;
    } catch {
      return fail(400, 'expected a JSON body');
    }
  };

  // ---------------------------------------------------------------- auth
  app.get('/health', (c) => c.json({ ok: true }));

  // Public: the web OAuth client id, for the admin console's sign-in button
  // (the id is public — it is also in the built web app). Null until
  // Google sign-in is configured.
  app.get('/config', (c) => c.json({ googleClientId: cfg.googleClientIds[0] ?? null }));

  // ---------------------------------------------------------------- client events
  // The web app reports unhandled errors and one page-load timing sample per
  // visit, so phones (where nobody watches the console) are visible too.
  // Unauthenticated by design: it only writes a log line, never the database.
  // Validated, size-capped (2 KB) and rate-limited per IP (30/min); anything
  // else is dropped with a 4xx and never reaches the logs.
  const clientEvents = createRateLimiter(30);
  app.post('/client-events', async (c) => {
    const ip = (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown';
    if (!clientEvents(ip)) return c.json({ error: 'slow down' }, 429);
    const text = await c.req.text();
    if (text.length > 2048) return c.json({ error: 'event too large' }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return c.json({ error: 'expected a JSON body' }, 400);
    }
    const parsed = parseClientEvent(body);
    if (!parsed.ok) return c.json({ error: parsed.reason }, 400);
    const e = parsed.event;
    if (e.kind === 'error') {
      logEvent('client_error', { message: e.message, source: e.source ?? null, path: e.path ?? null }, 'WARNING');
    } else {
      logEvent('client_perf', { load_ms: e.load_ms, dcl_ms: e.dcl_ms });
    }
    return c.body(null, 204);
  });

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
    // the world is square (32 m x 32 m). A non-square grid is an out-of-date app
    // (the old 32 x 24 world): its save would squeeze the sand and shift the
    // things on it, so refuse it until the app reloads.
    if (nx !== ny) fail(426, 'this app is out of date: reload to save');
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
  const clock = () => cfg.now?.() ?? Date.now();
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
    const at = clock();
    // star_first remembers the first time, so un-starring and starring again
    // doesn't count as a new star on the rising board
    await db.query(
      `WITH f AS (INSERT INTO favorites (user_id, beach_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING)
       INSERT INTO star_first (user_id, beach_id, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [c.get('user').id, who.id, at],
    );
    return c.json({ favorite: shoreJson(who) });
  });

  app.delete('/favorites/:code', requireUser, async (c) => {
    const who = await byCode(c.req.param('code') ?? '');
    if (who) await db.query('DELETE FROM favorites WHERE user_id = $1 AND beach_id = $2', [c.get('user').id, who.id]);
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- leaderboard
  // GET /leaderboard?board=all|rising&limit=50: the most-starred beaches.
  // all: stars right now. rising: star velocity, each star made in the last
  // RISING_WINDOW weighing 1/2 per RISING_HALF_LIFE of age (a star today
  // counts 1, two days ago 0.5, six days ago 0.125), counted from when that
  // person first starred the beach (star_first), so re-starring isn't new.
  // Only stars that still stand count, one per person per beach, never the
  // owner's own. Beaches off the shore, or never saved, aren't listed.
  const RISING_WINDOW = 7 * 86400000;
  const RISING_HALF_LIFE = 2 * 86400000;
  interface BoardRow extends NodeRow {
    stars: string;
    recent: string;
    velocity: string | number | null;
    starred: boolean;
  }
  app.get('/leaderboard', requireUser, async (c) => {
    const board = c.req.query('board') ?? 'all';
    if (board !== 'all' && board !== 'rising') fail(400, 'board must be all or rising');
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) | 0 || 50));
    const me = c.get('user').id;
    const now = clock();
    const since = now - RISING_WINDOW;
    const rows = await db.query<BoardRow>(
      `SELECT ${NODE},
              COUNT(*) AS stars,
              COUNT(*) FILTER (WHERE s.at > $2) AS recent,
              COALESCE(SUM(POWER(0.5, GREATEST(0, $3::bigint - s.at)::float8 / $4)) FILTER (WHERE s.at > $2), 0) AS velocity,
              BOOL_OR(f.user_id = $1) AS starred
         FROM favorites f
         JOIN ${BEACH} ON b.id = f.beach_id
         JOIN star_first s ON s.user_id = f.user_id AND s.beach_id = f.beach_id
        WHERE b.on_shore AND b.sand IS NOT NULL AND f.user_id <> b.owner_id
        GROUP BY b.id, u.name
       ${board === 'rising' ? 'HAVING COUNT(*) FILTER (WHERE s.at > $2) > 0' : ''}
        ORDER BY ${board === 'rising' ? 'velocity DESC, stars DESC' : 'stars DESC, velocity DESC'}, b.created_at, b.id
        LIMIT $5`,
      [me, since, now, RISING_HALF_LIFE, limit],
    );
    return c.json({
      board,
      window: RISING_WINDOW,
      halfLife: RISING_HALF_LIFE,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        ...beachJson(r),
        stars: Number(r.stars),
        recent: Number(r.recent),
        velocity: Math.round(Number(r.velocity) * 100) / 100,
        starred: !!r.starred,
        yours: r.owner_id === me,
      })),
    });
  });

  // ---------------------------------------------------------------- pulls
  // the pools, their published odds, and whether your free go is ready
  const rand = () => cfg.rand?.() ?? cryptoRandom();
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
    type PoolStatus = {
      id: string;
      name: string;
      odds: Record<Rarity, number>;
      items: Record<Rarity, string[]>;
      free: boolean;
      nextCooldown: number;
      nextFree: number;
      starter?: { rare: string; paid: string; beach: string; beachAfterMs: number };
      /** how often the claw holds on to a ball of each rarity (a miss spends the go); claw only */
      grab?: Partial<Record<Rarity, number>>;
      set?: { week: number; name: string };
    };
    const pools: PoolStatus[] = Object.values(POOLS).map((p) => {
      const st = state.get(p.id);
      return {
        id: p.id,
        name: p.name,
        odds: p.odds,
        items: p.items,
        // how often the claw holds on to a ball of each rarity (a miss spends the go)
        grab: GRAB_CHANCE,
        free: !st || st.at <= now,
        // how long you'll wait after this go before the next
        nextCooldown: cooldownAfter((st?.count ?? 0) + 1),
        nextFree: st && st.at > now ? st.at : now,
        // the fixed first prizes, shown before the odds
        starter: { rare: STARTER.rare.item, paid: STARTER.paid.item, beach: STARTER.beach.item, beachAfterMs: STARTER.beachAfterMs },
      };
    });
    // the vending machine: same shape, but its pool is this week's set and a
    // free ball comes once a day (next UTC midnight), not on the claw's
    // doubling rest. No starter gifts here.
    const set = currentSet(now);
    if (set) {
      const st = state.get('vending');
      pools.push({
        id: 'vending',
        name: 'Vending machine',
        // the vending machine has no legendary tier (its tiers are common,
        // uncommon, rare, unique); the shape stays the claw's so the app
        // renders it the same way
        odds: { ...set.odds, legendary: 0 },
        items: { ...set.items, legendary: [] },
        free: !st || st.at <= now,
        nextCooldown: nextUtcMidnight(now) - now,
        nextFree: st && st.at > now ? st.at : now,
        set: { week: set.week, name: set.name },
      });
    }
    return c.json({
      pools,
      nextFree: daily && daily.at > now ? daily.at : now,
    });
  });

  // your free go: the server draws, records it and adds the prize to your bag —
  // unless the claw drops it, in which case the go is spent and nothing is won.
  // The wait before the next go starts at 5 minutes and doubles each time, up
  // to once a day. A ball from the vending machine is one a day instead
  // (next UTC midnight) and is always a draw from this week's set.
  app.post('/pulls/:pool', requireUser, async (c) => {
    const id = c.req.param('pool') ?? '';
    const pool = Object.hasOwn(POOLS, id) ? POOLS[id] : undefined;
    // the vending machine isn't in POOLS: its items are this week's set
    const set = id === 'vending' ? currentSet(clock()) : null;
    if (!pool && !set) fail(404, 'no such machine');
    const poolId = pool?.id ?? 'vending';
    const me = c.get('user').id;
    const now = clock();
    await db.query('INSERT INTO pull_state (user_id, pool, count, next_at) VALUES ($1, $2, 0, 0) ON CONFLICT DO NOTHING', [me, poolId]);
    const count = Number((await db.query<{ count: number }>('SELECT count FROM pull_state WHERE user_id = $1 AND pool = $2', [me, poolId]))[0].count);
    // the first goes on the claw are fixed gifts (the machine says so); the
    // vending machine is always a draw from this week's set
    let got: { item: string; rarity: string };
    let missed = false;
    if (set) {
      // a vending machine dispenses: its ball never slips
      got = drawVending(set, rand);
    } else {
      const hist = (
        await db.query<{ first: string | null; beach: boolean | null }>(
          'SELECT MIN(created_at) AS first, BOOL_OR(item_id = $3) AS beach FROM pulls WHERE user_id = $1 AND pool = $2',
          [me, poolId, STARTER.beach.item],
        )
      )[0];
      // A normal draw can slip out of the claw — never a starter gift — and a
      // miss still spends the go: the rest starts either way.
      const starter = starterPrize(count + 1, hist?.first == null ? null : Number(hist.first), now, !!hist?.beach);
      const drawn = starter ?? draw(pool!, rand);
      missed = !starter && !grab(drawn.rarity, rand);
      got = drawn;
    }
    const wait = set ? nextUtcMidnight(now) - now : cooldownAfter(count + 1);
    // one statement: claim the go (only if it's free and nobody claimed it
    // meanwhile); on a win, log it and give the prize. On a miss nothing is
    // won, so there is nothing to log or give — only the claim runs. (The
    // miss claim has its own numbering: every parameter must be used, or
    // Postgres can't tell its type.)
    const rows = missed
      ? await db.query(
          `UPDATE pull_state SET count = count + 1, next_at = $3 + $4
            WHERE user_id = $1 AND pool = $2 AND next_at <= $3 AND count = $5
            RETURNING user_id`,
          [me, poolId, now, wait, count],
        )
      : await db.query<{ item_id: string }>(
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
          [me, poolId, pullDay(now), got.item, got.rarity, now, wait, count],
        );
    const st = (await freeAt(me)).get(poolId);
    if (!rows[0])
      return c.json({ error: set ? 'not yet: your next ball is tomorrow' : 'not yet: the claw is resting', nextFree: st?.at ?? now }, 409);
    if (missed) return c.json({ missed: true, item: null, rarity: null, dropped: { item: got.item, rarity: got.rarity }, nextFree: st?.at ?? now + wait });
    return c.json({ missed: false, item: got.item, rarity: got.rarity, nextFree: st?.at ?? now + wait });
  });

  // ---------------------------------------------------------------- digging finds
  // A good dig can turn up something buried: the server rolls (never the
  // app), from this week's vending set at the vending odds (server/src/digFinds.ts).
  // The app reports the stroke (brush travel in metres, duration in ms);
  // the roll needs a real dig, at most one roll every 30 s, and at most 3
  // finds a day (UTC). A miss still records the roll, so the next one waits.
  app.post('/dig-finds', requireUser, async (c) => {
    const me = c.get('user').id;
    const now = clock();
    const { pathM, durationMs } = await body<{ pathM?: number; durationMs?: number }>(c);
    if (!Number.isFinite(pathM) || !Number.isFinite(durationMs) || pathM! < 0 || durationMs! < 0)
      fail(400, 'expected { pathM, durationMs }');
    if (!qualifiesForFind(pathM!, durationMs!)) fail(409, 'dig a little more first');
    const set = currentSet(now) ?? fail(409, 'nothing buried here yet');
    const today = pullDay(now);
    // the cap and the cooldown, before the roll (the claim below re-checks,
    // so two rolls at once still can't both win)
    const st = (
      await db.query<{ day: string; finds: number; last_roll_at: string }>(
        'SELECT day, finds, last_roll_at FROM dig_state WHERE user_id = $1',
        [me],
      )
    )[0];
    const findsToday = st && st.day === today ? Number(st.finds) : 0;
    if (findsToday >= DIG_FIND_DAILY_CAP)
      return c.json({ error: 'that is all the buried treasure for today', nextFindsAt: nextUtcMidnight(now) }, 409);
    if (st && now - Number(st.last_roll_at) < DIG_FIND_ROLL_COOLDOWN_MS)
      return c.json({ error: 'slow down', nextRollAt: Number(st.last_roll_at) + DIG_FIND_ROLL_COOLDOWN_MS }, 409);
    const drawn = digDraw(set, rand);
    if (!drawn.found) {
      // the roll happened: record when, so the next one waits
      const rows = await db.query(
        `INSERT INTO dig_state (user_id, day, finds, last_roll_at) VALUES ($1, $2, 0, $3)
         ON CONFLICT (user_id) DO UPDATE SET
           day = EXCLUDED.day,
           finds = CASE WHEN dig_state.day = EXCLUDED.day THEN dig_state.finds ELSE 0 END,
           last_roll_at = EXCLUDED.last_roll_at
         WHERE $3 - dig_state.last_roll_at >= $4
         RETURNING user_id`,
        [me, today, now, DIG_FIND_ROLL_COOLDOWN_MS],
      );
      if (!rows[0]) return c.json({ error: 'slow down', nextRollAt: now + DIG_FIND_ROLL_COOLDOWN_MS }, 409);
      return c.json({ found: false });
    }
    // one statement: claim the find (only if still under the cap and the
    // cooldown has passed) and grant it — a racing second roll claims nothing
    const rows = await db.query<{ item_id: string }>(
      `WITH s AS (
         INSERT INTO dig_state (user_id, day, finds, last_roll_at) VALUES ($1, $2, 1, $5)
         ON CONFLICT (user_id) DO UPDATE SET
           day = EXCLUDED.day,
           finds = CASE WHEN dig_state.day = EXCLUDED.day THEN dig_state.finds + 1 ELSE 1 END,
           last_roll_at = EXCLUDED.last_roll_at
         WHERE (dig_state.day <> EXCLUDED.day OR dig_state.finds < $3)
           AND $5 - dig_state.last_roll_at >= $4
         RETURNING user_id, finds
       ), logged AS (
         INSERT INTO pulls (user_id, pool, day, item_id, rarity, created_at)
         SELECT user_id, 'dig', $2, $6, $7, $5 FROM s RETURNING user_id
       )
       INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at)
       SELECT user_id, $6, 1, 'pull', $5, NULL FROM logged RETURNING item_id`,
      [me, today, DIG_FIND_DAILY_CAP, DIG_FIND_ROLL_COOLDOWN_MS, now, drawn.item, drawn.rarity],
    );
    if (!rows[0]) return c.json({ error: 'slow down', nextRollAt: now + DIG_FIND_ROLL_COOLDOWN_MS }, 409);
    const after = Number(
      (await db.query<{ finds: number }>('SELECT finds FROM dig_state WHERE user_id = $1', [me]))[0]?.finds ?? 1,
    );
    return c.json({
      found: true,
      item: drawn.item,
      rarity: drawn.rarity,
      findsToday: after,
      findsLeft: DIG_FIND_DAILY_CAP - after,
      nextFindsAt: after >= DIG_FIND_DAILY_CAP ? nextUtcMidnight(now) : null,
    });
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

  // ---------------------------------------------------------------- the shop
  // The app buys through Apple / Google; we only check and grant (store.ts).
  const bundleId = cfg.appleBundleId ?? 'app.beech.beach';
  const androidPackage = cfg.androidPackage ?? 'app.beech.beach';
  const stores = {
    apple: cfg.stores?.apple ?? ((jws: string, b: string) => verifyAppleTransaction(jws, b)),
    google: cfg.stores?.google ?? verifyGooglePurchase,
    appleRefund: cfg.stores?.appleRefund ?? ((p: string, b: string) => appleRefund(p, b)),
    googleVoided: cfg.stores?.googleVoided ?? googleVoided,
  };

  app.get('/store/products', (c) =>
    c.json({ products: PRODUCTS.map((p) => ({ id: p.id, name: p.name, grants: p.grants, usd: p.usd, blurb: p.blurb, featured: !!p.featured })) }),
  );

  /**
   * The app finished a purchase: { platform: ios | android, productId, jws (iOS) | token (Android) }.
   * We check it with the store, record it once, and add what it grants to
   * your bag. Sending the same purchase again is harmless (it says so).
   */
  app.post('/store/purchase', requireUser, async (c) => {
    const me = c.get('user').id;
    const { platform, productId, jws, token } = await body<{ platform?: string; productId?: string; jws?: string; token?: string }>(c);
    const product = productById(productId ?? '');
    if (!product) fail(404, 'no such product');
    const ok = (platform === 'ios' && jws) || (platform === 'android' && token) || (platform === 'dev' && cfg.devAuth && token);
    if (!ok) fail(400, 'expected { platform: ios, jws } or { platform: android, token }');
    let v: VerifiedPurchase;
    try {
      if (platform === 'ios') v = await stores.apple(jws!, bundleId);
      else if (platform === 'android') v = await stores.google(androidPackage, product!.id, token!);
      // local development and e2e only: a pretend store
      else v = { store: 'dev', transactionId: token!, productId: product!.id, environment: 'Dev', purchasedAt: clock() };
    } catch (e) {
      return c.json({ error: `the store did not confirm this purchase: ${(e as Error).message}` }, 402);
    }
    if (v!.productId !== product!.id) fail(400, 'that purchase is for a different product');
    // the app ties each purchase to the account that made it
    if (v!.account && v!.account !== me) fail(403, 'that purchase belongs to another account');
    const now = clock();
    const items = product!.grants.map((g) => g.item);
    const qty = product!.grants.map((g) => g.quantity);
    // one statement: record the transaction (once) and grant its items
    const rows = await db.query<{ item_id: string }>(
      `WITH p AS (
         INSERT INTO purchases (user_id, store, transaction_id, product_id, environment, purchased_at, granted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (store, transaction_id) DO NOTHING
         RETURNING id, user_id
       )
       INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, purchase_id)
       SELECT p.user_id, g.item, g.qty, 'shop', $7, p.id FROM p, unnest($8::text[], $9::int[]) AS g(item, qty)
       RETURNING item_id`,
      [me, v!.store, v!.transactionId, product!.id, v!.environment, v!.purchasedAt, now, items, qty],
    );
    if (!rows.length) {
      const prev = (await db.query<{ user_id: string }>('SELECT user_id FROM purchases WHERE store = $1 AND transaction_id = $2', [v!.store, v!.transactionId]))[0];
      if (prev && prev.user_id !== me) fail(409, 'that purchase was already used by another account');
      return c.json({ already: true, product: product!.id, grants: product!.grants });
    }
    return c.json({ already: false, product: product!.id, grants: product!.grants });
  });

  /** A refund: the purchase is marked, and what it granted expires now. */
  const refund = async (store: 'apple' | 'google', transactionId: string) => {
    const now = clock();
    await db.query(
      `WITH p AS (UPDATE purchases SET refunded_at = $3 WHERE store = $1 AND transaction_id = $2 AND refunded_at IS NULL RETURNING id)
       UPDATE inventory SET expires_at = $3 WHERE purchase_id IN (SELECT id FROM p)`,
      [store, transactionId, now],
    );
  };

  // App Store Server Notifications V2 (set this URL in App Store Connect → App Information)
  app.post('/store/apple/notifications', async (c) => {
    const { signedPayload } = await body<{ signedPayload?: string }>(c);
    if (!signedPayload) fail(400, 'expected signedPayload');
    let tx: string | null;
    try {
      tx = await stores.appleRefund(signedPayload!, bundleId);
    } catch {
      return fail(401, 'not from Apple');
    }
    if (tx) await refund('apple', tx);
    return c.body(null, 200);
  });

  // Google Play real-time developer notifications (a Pub/Sub push subscription to this URL)
  app.post('/store/google/rtdn', async (c) => {
    if (!cfg.googleRtdn) fail(404, 'not set up');
    let order: string | null;
    try {
      order = await stores.googleVoided(c.req.header('Authorization'), await body(c), cfg.googleRtdn!);
    } catch {
      return fail(401, 'not from Google');
    }
    if (order) await refund('google', order);
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- gift cards, promos, credit
  // Gift cards are prepaid credit; credit buys products server-side, where
  // a promo code can discount the price. The server prices from its own
  // product list — a client-supplied price is never trusted. See
  // docs/GIFT_CARDS_PROMOS.md.
  const redeemLimiter = createRateLimiter(10); // gift card guesses, per user per minute
  const creditLimiter = createRateLimiter(30); // quotes and credit purchases, per user per minute

  const loadPromo = async (code: string): Promise<Promo | null> => {
    const rows = await db.query<{
      code: string;
      kind: string;
      value: number;
      applies_to: string | null;
      max_uses: number | null;
      uses: number;
      active: boolean;
      expires_at: string | null;
    }>('SELECT code, kind, value, applies_to, max_uses, uses, active, expires_at FROM promo_codes WHERE code = $1', [code]);
    const r = rows[0];
    if (!r) return null;
    return {
      code: r.code,
      kind: r.kind as 'percent' | 'fixed',
      value: Number(r.value),
      appliesTo: r.applies_to,
      maxUses: r.max_uses === null ? null : Number(r.max_uses),
      uses: Number(r.uses),
      active: r.active,
      expiresAt: r.expires_at === null ? null : Number(r.expires_at),
    };
  };

  // --- admin console + CLI (requireAdmin: Google allowlist or CLI token) ---
  app.get('/admin/me', requireAdmin, (c) =>
    c.json({ admin: true, via: c.get('adminActor') === 'cli-token' ? 'token' : 'session', email: c.get('adminEmail') }),
  );

  app.post('/admin/gift-cards', requireAdmin, async (c) => {
    const { amountCents, expiresAt, note } = await body<{ amountCents?: number; expiresAt?: number | null; note?: string }>(c);
    const amount = Math.floor(Number(amountCents ?? NaN));
    if (!Number.isInteger(amount) || amount < 50 || amount > 100000) fail(400, 'amountCents must be 50 to 100000 ($0.50 to $1,000)');
    const exp = expiresAt == null ? null : Math.floor(Number(expiresAt));
    if (exp !== null && (!Number.isInteger(exp) || exp <= Date.now())) fail(400, 'expiresAt must be in the future');
    const cleanNote = (note ?? '').trim().slice(0, 200);
    const now = clock();
    const actor = c.get('adminActor');
    // the code is returned once, in this response, and never again: only
    // its hash is stored, so a leaked database can't redeem the card
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newGiftCardCode();
      try {
        const id = crypto.randomUUID();
        await db.query(
          'INSERT INTO gift_cards (id, code_hash, amount_cents, status, issued_by, issued_at, expires_at, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [id, hashGiftCode(code, pepper), amount, 'active', actor === 'cli-token' ? null : actor, now, exp, cleanNote],
        );
        await audit(actor, 'gift_card.issue', 'gift_card', id, { amountCents: amount, expiresAt: exp });
        return c.json({
          id,
          code,
          amountCents: amount,
          amount: formatCents(amount),
          status: 'active',
          issuedAt: now,
          expiresAt: exp,
          note: cleanNote,
        });
      } catch (e) {
        if ((e as { code?: string }).code === '23505' && attempt < 4) continue; // hash collision: try another code
        throw e;
      }
    }
    return fail(500, 'could not make a gift card');
  });

  app.get('/admin/gift-cards', requireAdmin, async (c) => {
    const rows = await db.query<{
      id: string;
      amount_cents: number;
      status: string;
      issued_at: string;
      expires_at: string | null;
      redeemed_at: string | null;
      note: string;
      redeemed_name: string | null;
    }>(
      `SELECT g.id, g.amount_cents, g.status, g.issued_at, g.expires_at, g.redeemed_at, g.note, u.name AS redeemed_name
         FROM gift_cards g LEFT JOIN users u ON u.id = g.redeemed_by ORDER BY g.issued_at DESC LIMIT 100`,
    );
    return c.json({ giftCards: rows.map(giftCardJson) });
  });

  app.post('/admin/gift-cards/:id/disable', requireAdmin, async (c) => {
    const id = c.req.param('id') ?? '';
    const rows = await db.query<{ id: string }>(
      "UPDATE gift_cards SET status = 'disabled' WHERE id = $1 AND status = 'active' RETURNING id",
      [id],
    );
    if (!rows[0]) fail(404, 'no active gift card with that id');
    await audit(c.get('adminActor'), 'gift_card.disable', 'gift_card', id, {});
    return c.json({ id, status: 'disabled' });
  });

  app.post('/admin/promo-codes', requireAdmin, async (c) => {
    const { code, kind, value, appliesTo, maxUses, expiresAt } = await body<{
      code?: string;
      kind?: string;
      value?: number;
      appliesTo?: string | null;
      maxUses?: number | null;
      expiresAt?: number | null;
    }>(c);
    const clean = normalizePromoCode(code ?? '');
    if (!isPromoCodeShape(code ?? '')) fail(400, 'codes are 3-32 letters and numbers');
    if (kind !== 'percent' && kind !== 'fixed') fail(400, 'kind must be percent or fixed');
    const v = Math.floor(Number(value ?? NaN));
    if (!Number.isInteger(v) || v <= 0 || (kind === 'percent' && v > 100)) fail(400, 'percent is 1-100; fixed is USD cents');
    const applies = appliesTo ? String(appliesTo) : null;
    if (applies && !productById(applies)) fail(400, 'no such product');
    const max = maxUses == null ? null : Math.floor(Number(maxUses));
    if (max !== null && (!Number.isInteger(max) || max <= 0)) fail(400, 'maxUses must be a positive number');
    const exp = expiresAt == null ? null : Math.floor(Number(expiresAt));
    if (exp !== null && (!Number.isInteger(exp) || exp <= Date.now())) fail(400, 'expiresAt must be in the future');
    const now = clock();
    const actor = c.get('adminActor');
    try {
      await db.query(
        'INSERT INTO promo_codes (code, kind, value, applies_to, max_uses, active, created_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8)',
        [clean, kind, v, applies, max, actor === 'cli-token' ? null : actor, now, exp],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') fail(409, 'that code already exists');
      throw e;
    }
    await audit(actor, 'promo.create', 'promo_code', clean, { kind, value: v, appliesTo: applies, maxUses: max, expiresAt: exp });
    return c.json({
      promo: { code: clean, kind, value: v, appliesTo: applies, maxUses: max, uses: 0, active: true, createdAt: now, expiresAt: exp },
    });
  });

  app.get('/admin/promo-codes', requireAdmin, async (c) => {
    const rows = await db.query<{
      code: string;
      kind: string;
      value: number;
      applies_to: string | null;
      max_uses: number | null;
      uses: number;
      active: boolean;
      created_at: string;
      expires_at: string | null;
    }>('SELECT code, kind, value, applies_to, max_uses, uses, active, created_at, expires_at FROM promo_codes ORDER BY created_at DESC LIMIT 100');
    return c.json({
      promos: rows.map((r) => ({
        code: r.code,
        kind: r.kind,
        value: Number(r.value),
        appliesTo: r.applies_to,
        maxUses: r.max_uses === null ? null : Number(r.max_uses),
        uses: Number(r.uses),
        active: r.active,
        createdAt: Number(r.created_at),
        expiresAt: r.expires_at === null ? null : Number(r.expires_at),
      })),
    });
  });

  app.post('/admin/promo-codes/:code/disable', requireAdmin, async (c) => {
    const code = normalizePromoCode(c.req.param('code') ?? '');
    const rows = await db.query<{ code: string }>("UPDATE promo_codes SET active = false WHERE code = $1 AND active RETURNING code", [code]);
    if (!rows[0]) fail(404, 'no active promo code with that code');
    await audit(c.get('adminActor'), 'promo.disable', 'promo_code', code, {});
    return c.json({ code, active: false });
  });

  app.get('/admin/redemptions', requireAdmin, async (c) => {
    const cards = await db.query<{
      id: string;
      amount_cents: number;
      redeemed_at: string;
      note: string;
      redeemed_name: string | null;
    }>(
      `SELECT g.id, g.amount_cents, g.redeemed_at, g.note, u.name AS redeemed_name
         FROM gift_cards g JOIN users u ON u.id = g.redeemed_by WHERE g.status = 'redeemed' ORDER BY g.redeemed_at DESC LIMIT 50`,
    );
    const promos = await db.query<{
      code: string;
      product_id: string;
      discount_cents: number;
      created_at: string;
      user_name: string | null;
    }>(
      `SELECT p.code, p.product_id, p.discount_cents, p.created_at, u.name AS user_name
         FROM promo_uses p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 50`,
    );
    const ledger = await db.query<{ kind: string; amount_cents: number; ref: string; created_at: string; user_name: string | null }>(
      `SELECT l.kind, l.amount_cents, l.ref, l.created_at, u.name AS user_name
         FROM credit_ledger l JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 50`,
    );
    return c.json({
      giftCards: cards.map((r) => ({
        id: r.id,
        amountCents: Number(r.amount_cents),
        redeemedAt: Number(r.redeemed_at),
        redeemedBy: r.redeemed_name,
        note: r.note,
      })),
      promoUses: promos.map((r) => ({
        code: r.code,
        productId: r.product_id,
        discountCents: Number(r.discount_cents),
        usedAt: Number(r.created_at),
        user: r.user_name,
      })),
      credit: ledger.map((r) => ({
        kind: r.kind,
        amountCents: Number(r.amount_cents),
        ref: r.ref,
        createdAt: Number(r.created_at),
        user: r.user_name,
      })),
    });
  });

  // --- players: redeem a gift card, see credit, buy with credit ---
  app.post('/gift-cards/redeem', requireUser, async (c) => {
    const me = c.get('user').id;
    if (!redeemLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const { code } = await body<{ code?: string }>(c);
    if (!isGiftCodeShape(code ?? '')) fail(404, "that code isn't valid");
    const hash = hashGiftCode(code!, pepper);
    const now = clock();
    const known = (
      await db.query<{ status: string; expires_at: string | null }>('SELECT status, expires_at FROM gift_cards WHERE code_hash = $1', [hash])
    )[0];
    if (!known) fail(404, "that code isn't valid");
    if (known.status !== 'active') fail(409, known.status === 'redeemed' ? 'that card was already used' : 'that card is disabled');
    if (known.expires_at !== null && Number(known.expires_at) <= now) fail(409, 'that card has expired');
    // one statement: claim the card (only if still active and unexpired —
    // a second redeem racing this one claims nothing), credit the player,
    // and log the movement, all or nothing
    const rows = await db.query<{ amount_cents: number; credit_cents: number }>(
      `WITH claimed AS (
         UPDATE gift_cards SET status = 'redeemed', redeemed_by = $2, redeemed_at = $3
          WHERE code_hash = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > $3)
          RETURNING id, amount_cents
       ), credited AS (
         UPDATE users SET credit_cents = credit_cents + (SELECT amount_cents FROM claimed)
          WHERE id = $2 AND EXISTS (SELECT 1 FROM claimed)
          RETURNING credit_cents
       ), logged AS (
         INSERT INTO credit_ledger (user_id, kind, amount_cents, ref, created_at)
         SELECT $2, 'gift_card', amount_cents, id::text, $3 FROM claimed
         RETURNING 1
       )
       SELECT claimed.amount_cents, credited.credit_cents FROM claimed, credited`,
      [hash, me, now],
    );
    if (!rows[0]) fail(409, 'that card was just used');
    return c.json({ creditedCents: Number(rows[0].amount_cents), creditCents: Number(rows[0].credit_cents) });
  });

  app.get('/credit', requireUser, async (c) => {
    const rows = await db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [c.get('user').id]);
    return c.json({ creditCents: Number(rows[0]?.credit_cents ?? 0) });
  });

  // What a product costs with a promo code, before buying (validates the
  // code but doesn't use it).
  app.post('/store/quote', requireUser, async (c) => {
    const me = c.get('user').id;
    if (!creditLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const { productId, promoCode } = await body<{ productId?: string; promoCode?: string }>(c);
    const product = productById(productId ?? '');
    if (!product) fail(404, 'no such product');
    const priceCents = Math.round(product!.usd * 100);
    let discount = 0;
    let promo: Promo | null = null;
    if (promoCode) {
      promo = await loadPromo(normalizePromoCode(promoCode));
      if (!promo) fail(404, 'no such code');
      const blocked = promoBlocked(promo!, product!.id, clock());
      if (blocked) fail(400, blocked);
      discount = discountCents(promo!, priceCents);
    }
    return c.json({
      product: product!.id,
      priceCents,
      discountCents: discount,
      finalCents: priceCents - discount,
      promo: promo ? promo.code : undefined,
    });
  });

  // Buy a product with account credit (from gift cards), with an optional
  // promo code. The price comes from the server's product list; a promo is
  // validated here and claimed in the same statement as the payment, so it
  // can't be spent twice or after expiring.
  app.post('/store/credit-purchase', requireUser, async (c) => {
    const me = c.get('user').id;
    if (!creditLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const { productId, promoCode } = await body<{ productId?: string; promoCode?: string }>(c);
    const product = productById(productId ?? '');
    if (!product) fail(404, 'no such product');
    const priceCents = Math.round(product!.usd * 100);
    const now = clock();
    let discount = 0;
    let promo: Promo | null = null;
    if (promoCode) {
      promo = await loadPromo(normalizePromoCode(promoCode));
      if (!promo) fail(404, 'no such code');
      const blocked = promoBlocked(promo!, product!.id, now);
      if (blocked) fail(400, blocked);
      discount = discountCents(promo!, priceCents);
    }
    const final = priceCents - discount;
    const credit = Number((await db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [me]))[0]?.credit_cents ?? 0);
    if (credit < final) return c.json({ error: `not enough credit: ${formatCents(final)} needed, ${formatCents(credit)} available` }, 402);
    const items = product!.grants.map((g) => g.item);
    const qty = product!.grants.map((g) => g.quantity);
    const rows = await db.query<{ item_id: string }>(
      `WITH promo AS (
         UPDATE promo_codes SET uses = uses + 1
          WHERE code = $3 AND active AND (expires_at IS NULL OR expires_at > $4)
            AND (max_uses IS NULL OR uses < max_uses)
            AND (applies_to IS NULL OR applies_to = $2)
          RETURNING code
       ), paid AS (
         UPDATE users SET credit_cents = credit_cents - $5
          WHERE id = $1 AND credit_cents >= $5
            AND ($3 IS NULL OR EXISTS (SELECT 1 FROM promo))
          RETURNING credit_cents
       ), used AS (
         INSERT INTO promo_uses (code, user_id, product_id, discount_cents, created_at)
         SELECT $3, $1, $2, $6, $4 FROM paid WHERE $3 IS NOT NULL
         RETURNING 1
       ), logged AS (
         INSERT INTO credit_ledger (user_id, kind, amount_cents, ref, created_at)
         SELECT $1, 'spend', -$5, $2, $4 FROM paid
         RETURNING 1
       )
       INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, purchase_id)
       SELECT $1, g.item, g.qty, 'gift', $4, NULL FROM paid, unnest($7::text[], $8::int[]) AS g(item, qty)
       RETURNING item_id`,
      [me, product!.id, promo ? promo.code : null, now, final, discount, items, qty],
    );
    if (!rows.length) fail(409, 'that did not go through: try again');
    const after = Number((await db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [me]))[0]?.credit_cents ?? 0);
    return c.json({ product: product!.id, grants: product!.grants, paidCents: final, discountCents: discount, creditCents: after });
  });

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
         RETURNING item_id, expires_at, purchase_id
       ), given AS (
         -- the gift keeps the purchase it came from, so a refund of that
         -- purchase takes it back from the recipient too (otherwise: buy,
         -- gift it to a second account, get a refund, keep the item)
         INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at, purchase_id)
         SELECT $4, item_id, 1, 'gift', $3, expires_at, purchase_id FROM giver
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
