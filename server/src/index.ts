// beech API (Cloudflare Worker + D1). Static files (the web app) are served by
// Workers Static Assets; only /api/* reaches this code (see wrangler.toml).
//
//   POST   /api/auth/google   { credential }  -> { token, user }   Google ID token sign-in
//   POST   /api/auth/apple    { identityToken, name? } -> { token, user }   Sign in with Apple
//   POST   /api/auth/dev      { name }        -> { token, user }   local dev only (DEV_AUTH=1)
//   POST   /api/auth/logout                   -> 204
//   GET    /api/me                            -> { user }
//   GET    /api/beach                         -> sand bytes + X-Beach-* headers, or 404
//   PUT    /api/beach   (sand bytes, X-Beach-Location/Nx/Ny) -> { version, updatedAt }
//   DELETE /api/account                       -> 204, removes the user, sessions and beach
//
// Requests carry `Authorization: Bearer <token>`. Tokens are random and only
// their SHA-256 is stored.

import { hashToken, newSessionToken, SESSION_DAYS, verifyAppleIdToken, verifyGoogleIdToken } from './auth';

export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_IDS: string;
  APPLE_CLIENT_IDS: string;
  ALLOWED_ORIGINS: string;
  DEV_AUTH: string;
}

interface User {
  id: string;
  name: string;
}

const MAX_BEACH_BYTES = 768 * 1024;
const MAX_CELLS = 400 * 300;
const BEACH_HEADERS = ['X-Beach-Location', 'X-Beach-Nx', 'X-Beach-Ny', 'X-Beach-Version', 'X-Beach-Updated'];

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin');
  if (!origin) return {};
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  const self = new URL(req.url).origin;
  if (origin !== self && !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': ['Authorization', 'Content-Type', ...BEACH_HEADERS].join(', '),
    'Access-Control-Expose-Headers': BEACH_HEADERS.join(', '),
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });

async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'expected a JSON body');
  }
}

async function startSession(env: Env, provider: string, sub: string, name: string): Promise<Response> {
  const now = Date.now();
  let user = await env.DB.prepare('SELECT id, name FROM users WHERE provider = ? AND provider_sub = ?')
    .bind(provider, sub)
    .first<User>();
  if (!user) {
    user = { id: crypto.randomUUID(), name };
    await env.DB.prepare('INSERT INTO users (id, provider, provider_sub, name, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, provider, sub, name, now)
      .run();
  } else if (name && name !== user.name) {
    await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
    user.name = name;
  }
  const token = newSessionToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await hashToken(token), user.id, now, now + SESSION_DAYS * 86400000)
    .run();
  // tidy this person's expired sessions while we're here
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(user.id, now).run();
  return json({ token, user });
}

async function requireUser(req: Request, env: Env): Promise<{ user: User; tokenHash: string }> {
  const auth = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/.exec(auth);
  if (!m) throw new HttpError(401, 'sign in first');
  const tokenHash = await hashToken(m[1]);
  const row = await env.DB.prepare(
    'SELECT u.id AS id, u.name AS name, s.expires_at AS expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
  )
    .bind(tokenHash)
    .first<User & { expires_at: number }>();
  if (!row || row.expires_at < Date.now()) throw new HttpError(401, 'session expired, sign in again');
  return { user: { id: row.id, name: row.name }, tokenHash };
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = req.method;

  if (path === '/api/health' && method === 'GET') return json({ ok: true });

  if (path === '/api/auth/google' && method === 'POST') {
    const { credential } = await readJson<{ credential?: string }>(req);
    if (!credential) throw new HttpError(400, 'missing credential');
    const ids = env.GOOGLE_CLIENT_IDS.split(',').map((s) => s.trim()).filter(Boolean);
    let who;
    try {
      who = await verifyGoogleIdToken(credential, ids);
    } catch (e) {
      throw new HttpError(401, `google sign-in failed: ${(e as Error).message}`);
    }
    return startSession(env, who.provider, who.sub, who.name);
  }

  if (path === '/api/auth/apple' && method === 'POST') {
    const { identityToken, name } = await readJson<{ identityToken?: string; name?: string }>(req);
    if (!identityToken) throw new HttpError(400, 'missing identityToken');
    const ids = (env.APPLE_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    let who;
    try {
      who = await verifyAppleIdToken(identityToken, ids, name ?? '');
    } catch (e) {
      throw new HttpError(401, `apple sign-in failed: ${(e as Error).message}`);
    }
    return startSession(env, who.provider, who.sub, who.name);
  }

  if (path === '/api/auth/dev' && method === 'POST') {
    if (env.DEV_AUTH !== '1') throw new HttpError(404, 'not found');
    const { name } = await readJson<{ name?: string }>(req);
    const n = (name ?? 'dev').slice(0, 60);
    return startSession(env, 'dev', n, n);
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    const { tokenHash } = await requireUser(req, env);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return new Response(null, { status: 204 });
  }

  if (path === '/api/me' && method === 'GET') {
    const { user } = await requireUser(req, env);
    return json({ user });
  }

  if (path === '/api/beach' && method === 'GET') {
    const { user } = await requireUser(req, env);
    const row = await env.DB.prepare('SELECT location, nx, ny, version, updated_at, sand FROM beaches WHERE user_id = ?')
      .bind(user.id)
      .first<{ location: string; nx: number; ny: number; version: number; updated_at: number; sand: ArrayBuffer | number[] }>();
    if (!row) return json({ error: 'no saved beach yet' }, 404);
    // D1 hands BLOB columns back as an array of byte values
    const bytes = row.sand instanceof ArrayBuffer ? new Uint8Array(row.sand) : Uint8Array.from(row.sand);
    return new Response(bytes, {
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
  }

  if (path === '/api/beach' && method === 'PUT') {
    const { user } = await requireUser(req, env);
    const location = (req.headers.get('X-Beach-Location') ?? '').slice(0, 40);
    const nx = Number(req.headers.get('X-Beach-Nx'));
    const ny = Number(req.headers.get('X-Beach-Ny'));
    if (!/^[a-z0-9-]+$/.test(location)) throw new HttpError(400, 'bad X-Beach-Location');
    if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 8 || ny < 8 || nx * ny > MAX_CELLS)
      throw new HttpError(400, 'bad grid size');
    const len = Number(req.headers.get('Content-Length') ?? 0);
    if (len > MAX_BEACH_BYTES) throw new HttpError(413, 'beach too large');
    const body = await req.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_BEACH_BYTES) throw new HttpError(413, 'beach too large');
    const now = Date.now();
    const prev = await env.DB.prepare('SELECT version FROM beaches WHERE user_id = ?').bind(user.id).first<{ version: number }>();
    const version = (prev?.version ?? 0) + 1;
    await env.DB.prepare(
      `INSERT INTO beaches (user_id, location, nx, ny, version, updated_at, sand) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET location = excluded.location, nx = excluded.nx, ny = excluded.ny,
         version = excluded.version, updated_at = excluded.updated_at, sand = excluded.sand`,
    )
      .bind(user.id, location, nx, ny, version, now, body)
      .run();
    return json({ version, updatedAt: now });
  }

  if (path === '/api/account' && method === 'DELETE') {
    const { user } = await requireUser(req, env);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM beaches WHERE user_id = ?').bind(user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
      env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
    ]);
    return new Response(null, { status: 204 });
  }

  throw new HttpError(404, 'not found');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try {
      res = await route(req, env);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof HttpError ? e.message : 'something went wrong';
      if (!(e instanceof HttpError)) console.error(e);
      res = json({ error: message }, status);
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
} satisfies ExportedHandler<Env>;
