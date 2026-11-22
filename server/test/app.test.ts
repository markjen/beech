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

describe('the shore and favorites', () => {
  type Beach = { code: string; name: string; linked: boolean; location: string | null };
  type Shore = { center: { code: string; you: boolean }; left: Beach[]; right: Beach[] };

  it('one global beachfront: linked stretches first, then on into everyone else, never repeating', async () => {
    const u = await Promise.all(['Sam', 'Tia', 'Uma', 'Vic'].map((n) => signIn(n)));
    const code = async (t: string) => ((await (await req('/neighbors', {}, t)).json()) as { code: string }).code;
    const [sam, tia, uma, vic] = u;
    const [cs, ct, cu, cv] = await Promise.all(u.map((x) => code(x.token)));
    const ask = (t: string, side: string, c: string) => req(`/neighbors/${side}`, json('PUT', { code: c }), t);
    const accept = (t: string, c: string) => req(`/neighbors/requests/${c}/accept`, { method: 'POST' }, t);
    // Tia - Sam - Uma (Tia on Sam's left, Uma on Sam's right), Vic on her own
    expect((await ask(sam.token, 'left', ct)).status).toBe(200);
    expect((await accept(tia.token, cs)).status).toBe(200);
    expect((await ask(sam.token, 'right', cu)).status).toBe(200);
    expect((await accept(uma.token, cs)).status).toBe(200);
    await putBeach(vic.token, new Uint8Array([4]), 'bondi');
    await putBeach(uma.token, new Uint8Array([1, 2, 3]), 'piha');

    const mine = (await (await req('/shore?depth=12', {}, sam.token)).json()) as Shore;
    expect(mine.center).toMatchObject({ code: cs, you: true });
    expect(mine.left[0]).toMatchObject({ name: 'Tia', linked: true });
    expect(mine.right[0]).toMatchObject({ name: 'Uma', linked: true });
    // past the ends the shore carries on into other people's beaches
    expect(mine.left[1]?.linked).toBe(false);
    const all = [cs, ...mine.left.map((b) => b.code), ...mine.right.map((b) => b.code)];
    expect(new Set(all).size).toBe(all.length); // nobody twice
    expect(all).toContain(cv); // Vic is out there somewhere

    // keep walking from the far end (infinite scroll), still never repeating
    const far = mine.left[mine.left.length - 1].code;
    const more = (await (await req(`/shore/more?from=${far}&dir=left&count=12`, {}, sam.token)).json()) as { beaches: Beach[] };
    for (const b of more.beaches) expect(b.code).not.toBe(far);
    expect((await req('/shore/more?from=ZZZZZZ&dir=left', {}, sam.token)).status).toBe(404);
    expect((await req(`/shore/more?from=${far}&dir=up`, {}, sam.token)).status).toBe(400);

    // anyone's shore, by code: Uma's left is Sam, then Tia
    const theirs = (await (await req(`/shore?code=${cu.toLowerCase()}`, {}, vic.token)).json()) as Shore;
    expect(theirs.center).toMatchObject({ code: cu, you: false });
    expect(theirs.left.slice(0, 2).map((e) => [e.name, e.linked])).toEqual([['Sam', true], ['Tia', true]]);
    expect((await req('/shore?code=ZZZZZZ', {}, vic.token)).status).toBe(404);

    // a beach by code
    const b = await req(`/beaches/${cu}`, {}, vic.token);
    expect(b.status).toBe(200);
    expect([...new Uint8Array(await b.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await req(`/beaches/${cu}`)).status).toBe(401);

    // favorites
    expect((await req(`/favorites/${cu}`, { method: 'PUT' }, vic.token)).status).toBe(200);
    expect((await req(`/favorites/${cu}`, { method: 'PUT' }, vic.token)).status).toBe(200); // twice is fine
    expect((await req(`/favorites/${cv}`, { method: 'PUT' }, vic.token)).status).toBe(400); // your own
    const favs = (await (await req('/favorites', {}, vic.token)).json()) as { favorites: { code: string; name: string; location: string }[] };
    expect(favs.favorites).toEqual([expect.objectContaining({ code: cu, name: 'Uma', location: 'piha' })]);
    expect((await req(`/favorites/${cu}`, { method: 'DELETE' }, vic.token)).status).toBe(204);
    expect(((await (await req('/favorites', {}, vic.token)).json()) as { favorites: unknown[] }).favorites).toEqual([]);
  });
});

describe('pulls', () => {
  it('shows the odds, gives one free go a day, and puts the prize in your bag', async () => {
    const cleo = await signIn('Cleo');
    const list = (await (await req('/pulls', {}, cleo.token)).json()) as { pools: { id: string; odds: Record<string, number>; free: boolean }[] };
    const daily = list.pools.find((p) => p.id === 'daily')!;
    expect(Object.values(daily.odds).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(daily.free).toBe(true);
    // two at once: exactly one wins the day
    const [a, b] = await Promise.all([req('/pulls/daily', { method: 'POST' }, cleo.token), req('/pulls/daily', { method: 'POST' }, cleo.token)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const won = (await (a.status === 200 ? a : b).json()) as { item: string; rarity: string };
    const inv = (await (await req('/inventory', {}, cleo.token)).json()) as { items: { item: string; source: string }[] };
    expect(inv.items).toEqual([expect.objectContaining({ item: won.item, source: 'pull' })]);
    const after = (await (await req('/pulls', {}, cleo.token)).json()) as { pools: { id: string; free: boolean }[] };
    expect(after.pools.find((p) => p.id === 'daily')!.free).toBe(false);
    expect((await req('/pulls/nope', { method: 'POST' }, cleo.token)).status).toBe(404);
    expect((await req('/pulls/__proto__', { method: 'POST' }, cleo.token)).status).toBe(404);
    expect((await req('/pulls/daily', { method: 'POST' })).status).toBe(401);
  });

  it('draws with the published odds', async () => {
    const { POOLS, draw } = await import('../src/pulls.js');
    const n = 20000;
    const count: Record<string, number> = { common: 0, rare: 0, legendary: 0 };
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < n; i++) count[draw(POOLS.daily, rand).rarity]++;
    for (const k of Object.keys(count)) expect(count[k] / n).toBeCloseTo(POOLS.daily.odds[k as 'common'], 1);
  });
});

describe('neighbors', () => {
  it('normalizes codes people type', () => {
    expect(normalizeCode(' k7f-2qx ')).toBe('K7F2QX');
  });

  it('neighbors are mutual: ask, they accept, and you are on each other\'s facing sides', async () => {
    const me = await signIn('me');
    const ana = await signIn('ana');
    const ben = await signIn('ben');
    const cleo = await signIn('cleo');
    type N = {
      code: string;
      left: { name: string; location: string } | null;
      right: { name: string } | null;
      asked: { left: { name: string } | null; right: { name: string } | null };
      requests: { name: string; side: string; code: string }[];
    };
    const get = async (t: string) => (await (await req('/neighbors', {}, t)).json()) as N;
    const [meCode, anaCode, benCode, cleoCode] = await Promise.all([me, ana, ben, cleo].map(async (x) => (await get(x.token)).code));
    expect(anaCode).toMatch(/^[A-Z2-9]{6}$/);
    const ask = (t: string, side: string, c: string) => req(`/neighbors/${side}`, json('PUT', { code: c }), t);

    expect((await ask(me.token, 'up', anaCode)).status).toBe(400);
    expect((await ask(me.token, 'left', 'ZZZZZZ')).status).toBe(404);
    expect((await ask(me.token, 'left', meCode)).status).toBe(400);

    // I ask Ana to be on my left: pending until she accepts
    const r1 = await ask(me.token, 'left', anaCode.toLowerCase());
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { status: string }).status).toBe('asked');
    expect((await get(me.token)).left).toBeNull();
    expect((await get(me.token)).asked.left?.name).toBe('ana');
    const anaSees = await get(ana.token);
    expect(anaSees.requests).toEqual([expect.objectContaining({ name: 'me', side: 'right', code: meCode })]);
    // no peeking at a beach that isn't linked yet
    expect((await req('/neighbors/left/beach', {}, me.token)).status).toBe(404);

    // she accepts: I'm on her right, she's on my left
    const acc = await req(`/neighbors/requests/${meCode}/accept`, { method: 'POST' }, ana.token);
    expect(acc.status).toBe(200);
    expect(((await acc.json()) as { side: string }).side).toBe('right');
    expect((await get(me.token)).left?.name).toBe('ana');
    expect((await get(ana.token)).right?.name).toBe('me');
    expect((await get(ana.token)).requests).toEqual([]);
    expect((await get(me.token)).asked.left).toBeNull();
    await putBeach(ana.token, new Uint8Array([9, 9, 9]), 'brighton');
    const nb = await req('/neighbors/left/beach', {}, me.token);
    expect(nb.status).toBe(200);
    expect([...new Uint8Array(await nb.arrayBuffer())]).toEqual([9, 9, 9]);

    // one per side, both ways
    expect((await ask(me.token, 'left', benCode)).status).toBe(409); // my left is taken
    expect((await ask(cleo.token, 'left', meCode)).status).toBe(200); // asking me for my right…
    expect((await ask(ben.token, 'left', anaCode)).status).toBe(409); // …but Ana's right is taken (by me)
    expect((await ask(me.token, 'right', anaCode)).status).toBe(409); // already my left
    // both asking for matching sides links at once
    expect((await ask(me.token, 'right', cleoCode)).status).toBe(200);
    const both = (await get(me.token)) as N;
    expect(both.right?.name).toBe('cleo');
    expect((await get(cleo.token)).left?.name).toBe('me');

    // declining, and taking a request back
    expect((await ask(ben.token, 'left', cleoCode)).status).toBe(200);
    expect((await get(cleo.token)).requests.map((r) => r.name)).toEqual(['ben']);
    expect((await req(`/neighbors/requests/${benCode}`, { method: 'DELETE' }, cleo.token)).status).toBe(204);
    expect((await get(cleo.token)).requests).toEqual([]);
    expect((await ask(ben.token, 'right', anaCode)).status).toBe(200);
    expect((await req('/neighbors/right', { method: 'DELETE' }, ben.token)).status).toBe(204);
    expect((await get(ana.token)).requests).toEqual([]);

    // moving away undoes both ends
    expect((await req('/neighbors/right', { method: 'DELETE' }, me.token)).status).toBe(204);
    expect((await get(me.token)).right).toBeNull();
    expect((await get(cleo.token)).left).toBeNull();

    // rotating a code: the old one stops working, links stay
    const rotated = (await (await req('/neighbors/code', { method: 'POST' }, ana.token)).json()) as { code: string };
    expect(rotated.code).not.toBe(anaCode);
    expect((await ask(ben.token, 'right', anaCode)).status).toBe(404);
    expect((await get(me.token)).left?.name).toBe('ana');

    // deleting an account removes it from everyone's beach
    await req('/account', { method: 'DELETE' }, ana.token);
    expect((await get(me.token)).left).toBeNull();
  });
});
