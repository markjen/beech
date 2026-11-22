import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, normalizeCode } from '../src/app.js';
import { createPgDb, createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  // TEST_DATABASE_URL runs the same tests against a real Postgres (the
  // production driver path); otherwise in-memory PGlite
  if (process.env.TEST_DATABASE_URL) {
    db = createPgDb({ url: process.env.TEST_DATABASE_URL });
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } else {
    db = await createPgliteDb();
  }
  await migrate(db);
  await migrate(db); // idempotent
  app = createApp(db, {
    googleClientIds: ['web'],
    appleClientIds: [],
    allowedOrigins: ['capacitor://localhost'],
    devAuth: true,
    verifyGoogle: async (t) => {
      if (t !== 'good-google-token') throw new Error('bad token');
      return { provider: 'google', sub: 'g-1', name: 'Grace' };
    },
  });
});

afterAll(() => db.close());

const req = (path: string, init: RequestInit = {}, token?: string) =>
  app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
async function signIn(name: string) {
  const r = await req('/auth/dev', json('POST', { name }));
  expect(r.status).toBe(200);
  return (await r.json()) as { token: string; user: { id: string; name: string } };
}
const putBeach = (token: string, bytes: Uint8Array, location = 'bondi') =>
  req('/beach', { method: 'PUT', body: bytes, headers: { 'X-Beach-Location': location, 'X-Beach-Nx': '256', 'X-Beach-Ny': '192' } }, token);

describe('accounts', () => {
  it('health and auth required', async () => {
    expect((await req('/health')).status).toBe(200);
    expect((await req('/me')).status).toBe(401);
    expect((await req('/me', {}, 'nonsense')).status).toBe(401);
  });

  it('google sign-in goes through the verifier', async () => {
    expect((await req('/auth/google', json('POST', { credential: 'forged' }))).status).toBe(401);
    const r = await req('/auth/google', json('POST', { credential: 'good-google-token' }));
    expect(r.status).toBe(200);
    const { user } = (await r.json()) as { user: { name: string } };
    expect(user.name).toBe('Grace');
    const again = (await (await req('/auth/google', json('POST', { credential: 'good-google-token' }))).json()) as { user: { id: string } };
    expect(again.user.id).toBeTruthy();
  });

  it('saves and loads a beach, bumping the version', async () => {
    const { token } = await signIn('saver');
    expect((await req('/beach', {}, token)).status).toBe(404);
    const bytes = new Uint8Array(3000).map((_, i) => i % 251);
    const p1 = (await (await putBeach(token, bytes)).json()) as { version: number };
    const p2 = (await (await putBeach(token, bytes, 'piha')).json()) as { version: number };
    expect([p1.version, p2.version]).toEqual([1, 2]);
    const g = await req('/beach', {}, token);
    expect(g.headers.get('X-Beach-Location')).toBe('piha');
    expect(new Uint8Array(await g.arrayBuffer())).toEqual(bytes);
    expect((await putBeach(token, bytes, 'Bad!')).status).toBe(400);
    expect((await putBeach(token, new Uint8Array(900 * 1024))).status).toBe(413);
  });

  it('logout ends the session; delete removes everything', async () => {
    const a = await signIn('leaver');
    expect((await req('/auth/logout', { method: 'POST' }, a.token)).status).toBe(204);
    expect((await req('/me', {}, a.token)).status).toBe(401);
    const b = await signIn('leaver');
    expect(b.user.id).toBe(a.user.id);
    await putBeach(b.token, new Uint8Array(10));
    expect((await req('/account', { method: 'DELETE' }, b.token)).status).toBe(204);
    expect((await req('/me', {}, b.token)).status).toBe(401);
    const c = await signIn('leaver');
    expect(c.user.id).not.toBe(a.user.id);
    expect((await req('/beach', {}, c.token)).status).toBe(404);
  });

  it('API responses are never cached', async () => {
    const { token } = await signIn('cache');
    expect((await req('/neighbors', {}, token)).headers.get('Cache-Control')).toBe('no-store');
  });

  it('CORS allows the app shells only', async () => {
    const pre = await req('/beach', { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost' } });
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost');
    const evil = await req('/health', { headers: { Origin: 'https://evil.example' } });
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('inventory', () => {
  it('lists what you own that has not expired, and only yours', async () => {
    const ana = await signIn('Ana');
    const ben = await signIn('Ben');
    const empty = (await (await req('/inventory', {}, ana.token)).json()) as { items: unknown[] };
    expect(empty.items).toEqual([]);
    expect((await req('/inventory')).status).toBe(401);
    const now = Date.now();
    const add = (user: string, item: string, qty: number, expires: number | null) =>
      db.query('INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        user, item, qty, 'pull', now, expires,
      ]);
    await add(ana.user.id, 'sea-glass', 3, null);
    await add(ana.user.id, 'lantern', 1, now + 86400000);
    await add(ana.user.id, 'old-event-flag', 1, now - 1000);
    await add(ana.user.id, 'used-up', 0, null);
    await add(ben.user.id, 'bens-shell', 1, null);
    const { items } = (await (await req('/inventory', {}, ana.token)).json()) as { items: { item: string; quantity: number; expiresAt: number | null }[] };
    expect(items.map((i) => i.item).sort()).toEqual(['lantern', 'sea-glass']);
    expect(items.find((i) => i.item === 'sea-glass')).toMatchObject({ quantity: 3, expiresAt: null });
    // deleting the account removes the inventory
    expect((await req('/account', { method: 'DELETE' }, ana.token)).status).toBeLessThan(300);
    const left = await db.query<{ n: string }>('SELECT COUNT(*) AS n FROM inventory WHERE user_id = $1', [ana.user.id]);
    expect(Number(left[0].n)).toBe(0);
  });
});

describe('neighbors', () => {
  it('normalizes codes people type', () => {
    expect(normalizeCode(' k7f-2qx ')).toBe('K7F2QX');
  });

  it('picks neighbors by code on either side and sees their beaches', async () => {
    const me = await signIn('me');
    const ana = await signIn('ana');
    const ben = await signIn('ben');
    const codeOf = async (t: string) => ((await (await req('/neighbors', {}, t)).json()) as { code: string }).code;
    const anaCode = await codeOf(ana.token);
    const benCode = await codeOf(ben.token);
    expect(anaCode).toMatch(/^[A-Z2-9]{6}$/);

    const empty = (await (await req('/neighbors', {}, me.token)).json()) as { left: unknown; right: unknown };
    expect(empty.left).toBeNull();
    expect(empty.right).toBeNull();

    expect((await req('/neighbors/up', json('PUT', { code: anaCode }), me.token)).status).toBe(400);
    expect((await req('/neighbors/left', json('PUT', { code: 'ZZZZZZ' }), me.token)).status).toBe(404);
    expect((await req('/neighbors/left', json('PUT', { code: await codeOf(me.token) }), me.token)).status).toBe(400);

    const set = await req('/neighbors/left', json('PUT', { code: anaCode.toLowerCase() }), me.token);
    expect(set.status).toBe(200);
    expect(((await set.json()) as { neighbor: { name: string } }).neighbor.name).toBe('ana');
    expect((await req('/neighbors/right', json('PUT', { code: anaCode }), me.token)).status).toBe(409);
    expect((await req('/neighbors/right', json('PUT', { code: benCode }), me.token)).status).toBe(200);

    // no beach saved yet on ana's side
    expect((await req('/neighbors/left/beach', {}, me.token)).status).toBe(404);
    await putBeach(ana.token, new Uint8Array([9, 9, 9]), 'brighton');
    const nb = await req('/neighbors/left/beach', {}, me.token);
    expect(nb.status).toBe(200);
    expect(nb.headers.get('X-Beach-Location')).toBe('brighton');
    expect([...new Uint8Array(await nb.arrayBuffer())]).toEqual([9, 9, 9]);

    const list = (await (await req('/neighbors', {}, me.token)).json()) as { left: { name: string; location: string }; right: { name: string } };
    expect(list.left.name).toBe('ana');
    expect(list.left.location).toBe('brighton');
    expect(list.right.name).toBe('ben');
    expect(((await (await req('/neighbors', {}, ana.token)).json()) as { pickedBy: number }).pickedBy).toBe(1);

    // ben can't read ana's beach: she isn't his neighbor
    expect((await req('/neighbors/left/beach', {}, ben.token)).status).toBe(404);

    // removing a neighbor
    expect((await req('/neighbors/right', { method: 'DELETE' }, me.token)).status).toBe(204);
    expect(((await (await req('/neighbors', {}, me.token)).json()) as { right: unknown }).right).toBeNull();

    // rotating a code: the old one stops working, existing neighbors stay
    const rotated = (await (await req('/neighbors/code', { method: 'POST' }, ana.token)).json()) as { code: string };
    expect(rotated.code).not.toBe(anaCode);
    expect((await req('/neighbors/right', json('PUT', { code: anaCode }), ben.token)).status).toBe(404);
    expect(((await (await req('/neighbors', {}, me.token)).json()) as { left: { name: string } }).left.name).toBe('ana');

    // deleting an account removes it from everyone's beach
    await req('/account', { method: 'DELETE' }, ana.token);
    expect(((await (await req('/neighbors', {}, me.token)).json()) as { left: unknown }).left).toBeNull();
  });
});
