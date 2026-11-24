import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, normalizeCode } from '../src/app.js';
import type { VerifiedPurchase } from '../src/store.js';
import { createPgDb, createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { COOLDOWN_MAX_MS, COOLDOWN_MIN_MS, cooldownAfter, cryptoRandom } from '../src/pulls.js';

let db: Db;
/** the server's clock in these tests: real time plus however far a test moved it on */
let skew = 0;
/** the server's dice in these tests: a test can force them (a miss), then put them back */
let forcedRand: (() => number) | null = null;
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
    now: () => Date.now() + skew,
    rand: () => (forcedRand?.() ?? cryptoRandom()),
    // pretend stores: a "jws"/"token" here is just the purchase as JSON (store.test.ts checks the real verification)
    stores: {
      apple: async (jws) => {
        const p = JSON.parse(jws) as VerifiedPurchase & { bad?: boolean };
        if (p.bad) throw new Error('signature does not check out');
        return { ...p, store: 'apple' };
      },
      google: async (_pkg, productId, token) => ({ ...(JSON.parse(token) as VerifiedPurchase), store: 'google', productId }),
      appleRefund: async (payload) => (JSON.parse(payload) as { refund?: string }).refund ?? null,
      googleVoided: async (auth, body) => {
        if (auth !== 'Bearer from-google') throw new Error('bad push');
        return (body as { order?: string }).order ?? null;
      },
    },
    googleRtdn: { audience: 'https://beech.test/api/store/google/rtdn', email: 'push@beech.test' },
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
  req('/beach', { method: 'PUT', body: bytes, headers: { 'X-Beach-Location': location, 'X-Beach-Nx': '256', 'X-Beach-Ny': '256' } }, token);

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
    // an out-of-date app (the old 32 x 24 world) can't save over the beach
    const old = await req('/beach', { method: 'PUT', body: bytes, headers: { 'X-Beach-Location': 'piha', 'X-Beach-Nx': '256', 'X-Beach-Ny': '192' } }, token);
    expect(old.status).toBe(426);
    expect((await req('/beach', {}, token)).headers.get('X-Beach-Version')).toBe('2');
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

describe('more than one beach', () => {
  type Mine = {
    allowance: number;
    cap: number;
    beaches: { id: string; code: string; name: string; home: boolean; onShore: boolean; items: Record<string, number>; left: { code: string; yours: boolean } | null; right: { code: string; yours: boolean } | null }[];
  };
  const giveBeach = (userId: string) =>
    db.query("INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at) VALUES ($1, 'beach', 1, 'shop', $2)", [userId, Date.now()]);

  it('one home beach to start; an extra beach lets you make another, with its own code, sand and neighbors', async () => {
    const eve = await signIn('Eve');
    const mine = async () => (await (await req('/beaches/mine', {}, eve.token)).json()) as Mine;
    let m = await mine();
    expect(m.allowance).toBe(1);
    expect(m.beaches).toHaveLength(1);
    expect(m.beaches[0]).toMatchObject({ home: true, id: eve.user.id });
    const homeCode = m.beaches[0].code;
    // no room yet
    expect((await req('/beaches/mine', json('POST', { name: 'Bondi', location: 'bondi' }), eve.token)).status).toBe(409);
    await giveBeach(eve.user.id);
    const made = await req('/beaches/mine', json('POST', { name: 'Bondi', location: 'bondi' }), eve.token);
    expect(made.status).toBe(200);
    const second = ((await made.json()) as { beach: Mine['beaches'][0] }).beach;
    expect(second).toMatchObject({ name: 'Bondi', home: false });
    expect(second.code).not.toBe(homeCode);
    expect((await req('/beaches/mine', json('POST', { name: 'Third' }), eve.token)).status).toBe(409); // allowance 2

    // its own sand (and item counts), separate from home
    const save = await req(
      `/beaches/mine/${second.id}/sand`,
      { method: 'PUT', body: new Uint8Array([7, 7]), headers: { 'X-Beach-Location': 'bondi', 'X-Beach-Nx': '256', 'X-Beach-Ny': '256', 'X-Beach-Items': 'starfish=1,deckchair=2,bad item=3' } },
      eve.token,
    );
    expect(save.status).toBe(200);
    await putBeach(eve.token, new Uint8Array([1]), 'brighton');
    expect([...new Uint8Array(await (await req(`/beaches/mine/${second.id}/sand`, {}, eve.token)).arrayBuffer())]).toEqual([7, 7]);
    expect([...new Uint8Array(await (await req('/beach', {}, eve.token)).arrayBuffer())]).toEqual([1]);
    m = await mine();
    expect(m.beaches.find((b) => b.id === second.id)!.items).toEqual({ starfish: 1, deckchair: 2 });
    // nobody else can touch it
    const mal = await signIn('Mal');
    expect((await req(`/beaches/mine/${second.id}/sand`, {}, mal.token)).status).toBe(404);
    expect((await req(`/neighbors?beach=${second.id}`, {}, mal.token)).status).toBe(404);
    // but anyone can visit it by code
    expect((await req(`/beaches/${second.code}`, {}, mal.token)).status).toBe(200);

    // each beach has its own neighbors: Mal asks to be next to the second beach only
    const malCode = ((await (await req('/neighbors', {}, mal.token)).json()) as { code: string }).code;
    expect((await req('/neighbors/left', json('PUT', { code: second.code }), mal.token)).status).toBe(200);
    const onSecond = (await (await req(`/neighbors?beach=${second.id}`, {}, eve.token)).json()) as { requests: { code: string }[] };
    expect(onSecond.requests.map((r) => r.code)).toEqual([malCode]);
    const onHome = (await (await req('/neighbors', {}, eve.token)).json()) as { requests: unknown[] };
    expect(onHome.requests).toEqual([]);
    expect((await req(`/neighbors/requests/${malCode}/accept?beach=${second.id}`, { method: 'POST' }, eve.token)).status).toBe(200);
    m = await mine();
    expect(m.beaches.find((b) => b.id === second.id)!.right).toMatchObject({ code: malCode, yours: false });

    // two of your own beaches link at once, no request
    // (Mal is on the second beach's right, so the home beach goes on its left)
    const link = await req(`/neighbors/right?beach=${eve.user.id}`, json('PUT', { code: second.code }), eve.token);
    expect(((await link.json()) as { status: string }).status).toBe('linked');
    m = await mine();
    expect(m.beaches.find((b) => b.home)!.right).toMatchObject({ code: second.code, yours: true });
    // the stretch runs home - second - Mal, going right
    const shore = (await (await req('/shore?depth=2', {}, eve.token)).json()) as { right: { code: string }[] };
    expect(shore.right.slice(0, 2).map((b) => b.code)).toEqual([second.code, malCode]);

    // rename, make it home (onShore can't be toggled off by the owner)
    expect((await req(`/beaches/mine/${second.id}`, json('PATCH', { name: 'Bondi Bay', onShore: false }), eve.token)).status).toBe(200);
    m = await mine();
    expect(m.beaches.find((b) => b.id === second.id)).toMatchObject({ name: 'Bondi Bay', onShore: true });
    expect((await req(`/beaches/mine/${second.id}`, json('PATCH', { location: 'NOT OK' }), eve.token)).status).toBe(400);
    expect((await req(`/beaches/mine/${second.id}`, json('PATCH', { home: true }), eve.token)).status).toBe(200);
    m = await mine();
    expect(m.beaches.filter((b) => b.home).map((b) => b.id)).toEqual([second.id]);
    expect((await req(`/beaches/mine/${second.id}`, { method: 'DELETE' }, eve.token)).status).toBe(400); // it's home now
    expect((await req(`/beaches/mine/${second.id}`, json('PATCH', { home: false }), eve.token)).status).toBe(200);
    expect((await req(`/beaches/mine/${eve.user.id}`, json('PATCH', { home: true }), eve.token)).status).toBe(200);
    // removing it takes its links with it
    expect((await req(`/beaches/mine/${second.id}`, { method: 'DELETE' }, eve.token)).status).toBe(204);
    m = await mine();
    expect(m.beaches).toHaveLength(1);
    expect(m.beaches[0].right).toBeNull();
    expect(((await (await req('/neighbors', {}, mal.token)).json()) as { left: unknown }).left).toBeNull();
  });

  it('two of your beaches can sit in different places on one beachfront', async () => {
    const fay = await signIn('Fay');
    const gus = await signIn('Gus');
    await giveBeach(fay.user.id);
    const second = ((await (await req('/beaches/mine', json('POST', { name: 'Two' }), fay.token)).json()) as { beach: { id: string; code: string } }).beach;
    const gusCode = ((await (await req('/neighbors', {}, gus.token)).json()) as { code: string }).code;
    const fayCode = ((await (await req('/neighbors', {}, fay.token)).json()) as { code: string }).code;
    // Fay's home - Gus - Fay's second: Gus between them
    await req('/neighbors/left', json('PUT', { code: gusCode }), fay.token);
    await req(`/neighbors/requests/${fayCode}/accept`, { method: 'POST' }, gus.token);
    await req('/neighbors/left', json('PUT', { code: second.code }), gus.token);
    expect((await req(`/neighbors/requests/${gusCode}/accept?beach=${second.id}`, { method: 'POST' }, fay.token)).status).toBe(200);
    const shore = (await (await req('/shore?depth=2', {}, fay.token)).json()) as { left: { code: string; name: string }[] };
    expect(shore.left.slice(0, 2).map((b) => b.code)).toEqual([gusCode, second.code]);
    // and the shore can be centred on either of them
    const fromSecond = (await (await req(`/shore?depth=1&beach=${second.id}`, {}, fay.token)).json()) as { center: { code: string; you: boolean } };
    expect(fromSecond.center).toMatchObject({ code: second.code, you: true });
  });
});

describe('the shop', () => {
  const buy = (t: string, b: Record<string, unknown>) => req('/store/purchase', json('POST', b), t);
  const owned = async (t: string) => {
    const inv = (await (await req('/inventory', {}, t)).json()) as { items: { item: string; quantity: number }[] };
    const m: Record<string, number> = {};
    for (const i of inv.items) m[i.item] = (m[i.item] ?? 0) + i.quantity;
    return m;
  };

  it('lists the products', async () => {
    const r = (await (await req('/store/products')).json()) as { products: { id: string; usd: number; grants: unknown[] }[] };
    expect(r.products.map((p) => p.id)).toContain('beach_1');
    for (const p of r.products) expect(p.usd).toBeGreaterThan(0);
  });

  it('lists and grants each new shop centrepiece at its catalog price', async () => {
    const shopper = await signIn('Shopper');
    const { products } = (await (await req('/store/products')).json()) as { products: { id: string; usd: number; grants: unknown[] }[] };
    const prices = { palmtree: 2.99, lifeguardtower: 2.99, bonfire: 1.49, hammock: 1.49, towel: 0.99 };
    for (const [item, usd] of Object.entries(prices)) {
      const productId = `item_${item}`;
      expect(products.find((p) => p.id === productId)).toMatchObject({ usd, grants: [{ item, quantity: 1 }] });
      const response = await buy(shopper.token, { platform: 'dev', productId, token: `centrepiece-${item}` });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ already: false, product: productId });
    }
    expect(await owned(shopper.token)).toEqual({ palmtree: 1, lifeguardtower: 1, bonfire: 1, hammock: 1, towel: 1 });
  });

  it('grants a checked purchase once, ties it to its account, and takes it back on a refund', async () => {
    const hal = await signIn('Hal');
    const ivy = await signIn('Ivy');
    const tx = (id: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ transactionId: id, productId: 'pack_founder', environment: 'Sandbox', purchasedAt: 1, account: hal.user.id, ...extra });
    // a founder's pack on iOS: two beaches and four things
    const r1 = await buy(hal.token, { platform: 'ios', productId: 'pack_founder', jws: tx('A-1') });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ already: false, product: 'pack_founder' });
    expect(await owned(hal.token)).toMatchObject({ beach: 2, lighthouse: 1, beachhut: 1, parasol: 1, tikitorch: 2 });
    expect(((await (await req('/beaches/mine', {}, hal.token)).json()) as { allowance: number }).allowance).toBe(3);
    // the same purchase again (an app retry): fine, nothing extra
    const r2 = await buy(hal.token, { platform: 'ios', productId: 'pack_founder', jws: tx('A-1') });
    expect(await r2.json()).toMatchObject({ already: true });
    expect((await owned(hal.token)).beach).toBe(2);
    // someone else can't use Hal's receipt
    expect((await buy(ivy.token, { platform: 'ios', productId: 'pack_founder', jws: tx('A-1', { account: undefined }) })).status).toBe(409);
    expect((await buy(ivy.token, { platform: 'ios', productId: 'pack_founder', jws: tx('A-2') })).status).toBe(403); // tied to Hal
    // the store didn't confirm it; wrong product; unknown product
    expect((await buy(hal.token, { platform: 'ios', productId: 'pack_founder', jws: tx('A-3', { bad: true }) })).status).toBe(402);
    expect((await buy(hal.token, { platform: 'ios', productId: 'beach_1', jws: tx('A-4') })).status).toBe(400);
    expect((await buy(hal.token, { platform: 'ios', productId: 'nope', jws: tx('A-5') })).status).toBe(404);
    expect((await buy(hal.token, { platform: 'ios', productId: 'beach_1' })).status).toBe(400);
    expect((await req('/store/purchase', json('POST', { platform: 'ios', productId: 'beach_1', jws: tx('A-6') }))).status).toBe(401);

    // Google: a single beach
    const g = await buy(hal.token, { platform: 'android', productId: 'beach_1', token: JSON.stringify({ transactionId: 'GPA.1', environment: 'Test', purchasedAt: 2 }) });
    expect(g.status).toBe(200);
    expect((await owned(hal.token)).beach).toBe(3);

    // refunds: Apple notification for the pack, Google push for the beach
    expect((await req('/store/apple/notifications', json('POST', { signedPayload: JSON.stringify({ refund: 'A-1' }) }))).status).toBe(200);
    expect(await owned(hal.token)).toEqual({ beach: 1 });
    expect((await req('/store/google/rtdn', json('POST', { order: 'GPA.1' }))).status).toBe(401); // not from Google
    expect((await req('/store/google/rtdn', { ...json('POST', { order: 'GPA.1' }), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer from-google' } })).status).toBe(204);
    expect(await owned(hal.token)).toEqual({});
    expect(((await (await req('/beaches/mine', {}, hal.token)).json()) as { allowance: number }).allowance).toBe(1);
  });

  it('a pretend store only in development', async () => {
    const jo = await signIn('Jo');
    const r = await buy(jo.token, { platform: 'dev', productId: 'item_parasol', token: 'dev-1' });
    expect(r.status).toBe(200);
    expect((await owned(jo.token)).parasol).toBe(1);
  });
});

describe('pulls', () => {
  it('shows the odds; the wait between goes is random, 5 minutes to 3 hours', async () => {
    const cleo = await signIn('Cleo');
    type Pools = { pools: { id: string; odds: Record<string, number>; free: boolean; nextCooldown: number; cooldown: { min: number; max: number } }[]; nextFree: number };
    const status = async () => ((await (await req('/pulls', {}, cleo.token)).json()) as Pools).pools.find((p) => p.id === 'daily')!;
    const first = await status();
    expect(Object.values(first.odds).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(first.free).toBe(true);
    expect(first.cooldown).toEqual({ min: 5 * 60000, max: 3 * 3600000 });
    expect(first.nextCooldown).toBe(3 * 3600000);

    // two at once: exactly one gets the go
    const [a, b] = await Promise.all([req('/pulls/daily', { method: 'POST' }, cleo.token), req('/pulls/daily', { method: 'POST' }, cleo.token)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const won = (await (a.status === 200 ? a : b).json()) as { item: string; rarity: string; nextFree: number };
    expect(won.nextFree - (Date.now() + skew)).toBeGreaterThan(4.9 * 60000);
    expect(won.nextFree - (Date.now() + skew)).toBeLessThanOrEqual(3 * 3600000);
    const inv = (await (await req('/inventory', {}, cleo.token)).json()) as { items: { item: string; source: string }[] };
    expect(inv.items).toEqual([expect.objectContaining({ item: won.item, source: 'pull' })]);
    expect((await status()).free).toBe(false);

    // every wait stays within 5 minutes to 3 hours, and it doesn't grow
    let next = won.nextFree;
    for (let go = 2; go <= 12; go++) {
      skew += next - (Date.now() + skew) - 1000; // just before it's free: still resting
      expect((await req('/pulls/daily', { method: 'POST' }, cleo.token)).status).toBe(409);
      skew += 2000; // and now it's free
      const r = await req('/pulls/daily', { method: 'POST' }, cleo.token);
      expect(r.status).toBe(200);
      const body = (await r.json()) as { nextFree: number };
      const wait = body.nextFree - (Date.now() + skew);
      expect(wait).toBeGreaterThan(4.9 * 60000);
      expect(wait).toBeLessThanOrEqual(3 * 3600000);
      next = body.nextFree;
    }

    expect((await req('/pulls/nope', { method: 'POST' }, cleo.token)).status).toBe(404);
    expect((await req('/pulls/__proto__', { method: 'POST' }, cleo.token)).status).toBe(404);
    expect((await req('/pulls/daily', { method: 'POST' })).status).toBe(401);
    skew = 0;
  });

  it('the rest is 5 minutes to 3 hours, skewed short after a miss and long after a win', () => {
    for (const missed of [true, false]) {
      expect(cooldownAfter(missed, () => 0)).toBe(COOLDOWN_MIN_MS);
      expect(cooldownAfter(missed, () => 0.999999)).toBeLessThanOrEqual(COOLDOWN_MAX_MS);
    }
    const mean = (missed: boolean) => {
      let sum = 0;
      for (let i = 0; i < 2000; i++) sum += cooldownAfter(missed, () => (i + 0.5) / 2000);
      return sum / 2000 / 60000;
    };
    // a miss averages about an hour (5 + 175/3), a win about two (5 + 350/3)
    expect(mean(true)).toBeCloseTo(5 + 175 / 3, 0);
    expect(mean(false)).toBeCloseTo(5 + 350 / 3, 0);
    expect(mean(true)).toBeLessThan(mean(false));
  });

  it('first goes are fixed gifts: a rare find, a shop item, and a beach once a day has passed', async () => {
    const dora = await signIn('Dora');
    const st = ((await (await req('/pulls', {}, dora.token)).json()) as { pools: { starter: { rare: string; paid: string; beach: string } }[] }).pools[0];
    expect(st.starter).toMatchObject({ rare: 'starfish', paid: 'deckchair', beach: 'beach' });
    const go = async () => {
      const r = await req('/pulls/daily', { method: 'POST' }, dora.token);
      expect(r.status).toBe(200);
      const body = (await r.json()) as { item: string; rarity: string; nextFree: number };
      skew += body.nextFree - (Date.now() + skew) + 1000; // wait out the rest
      return body;
    };
    const start = Date.now() + skew;
    expect(await go()).toMatchObject({ item: 'starfish', rarity: 'rare' });
    expect(await go()).toMatchObject({ item: 'deckchair' });
    const third = await go(); // a few hours in at most: an ordinary draw
    expect(third.item).not.toBe('beach');
    // a day after the first go, the next go is the beach…
    skew += Math.max(0, start + 24 * 3600 * 1000 + 60000 - (Date.now() + skew));
    expect(await go()).toMatchObject({ item: 'beach', rarity: 'legendary' });
    // …once
    for (let i = 0; i < 3; i++) expect((await go()).item).not.toBe('beach');
    const inv = (await (await req('/inventory', {}, dora.token)).json()) as { items: { item: string }[] };
    expect(inv.items.map((i) => i.item)).toEqual(expect.arrayContaining(['starfish', 'deckchair', 'beach']));
    skew = 0;
  });

  it('the claw can drop a ball: a miss spends the go and wins nothing', async () => {
    // a fresh name: dev sign-in keys users by name, and Eve/Fay already have
    // beach rows from the multi-beach tests above
    const eve = await signIn('Nia');
    type Status = { pools: { id: string; grab: Record<string, number> }[] };
    const status = async () => ((await (await req('/pulls', {}, eve.token)).json()) as Status).pools.find((p) => p.id === 'daily')!;
    expect((await status()).grab).toEqual({ common: 0.8, rare: 0.65, legendary: 0.4 });
    type Go = { item: string | null; rarity: string | null; missed: boolean; dropped?: { item: string; rarity: string }; nextFree: number };
    const go = async () => {
      const r = await req('/pulls/daily', { method: 'POST' }, eve.token);
      expect(r.status).toBe(200);
      return (await r.json()) as Go;
    };
    const waitOut = (nextFree: number) => {
      skew += nextFree - (Date.now() + skew) + 1000;
    };
    try {
      // the two starter gifts always land
      const first = await go();
      expect(first).toMatchObject({ missed: false, item: 'starfish' });
      waitOut(first.nextFree);
      const second = await go();
      expect(second).toMatchObject({ missed: false, item: 'deckchair' });
      waitOut(second.nextFree);
      // the third go is an ordinary draw: force the claw to drop a common ball
      // (draw: rarity 0.5 -> common, pick 0.5 -> sanddollar; grab 0.9 >= 0.8 -> miss;
      // rest 0.5 -> a miss skews short: 5 + 175 * 0.25 = 48.75 min)
      const drops = [0.5, 0.5, 0.9, 0.5];
      forcedRand = () => drops.shift() ?? 0.5;
      const missed = await go();
      expect(missed).toMatchObject({ missed: true, dropped: { item: 'sanddollar', rarity: 'common' } });
      expect(missed.item).toBeNull();
      // the go is spent: the claw rests (shorter than after a win), and it's resting now
      expect(Math.round((missed.nextFree - (Date.now() + skew)) / 60000)).toBe(49);
      expect((await req('/pulls/daily', { method: 'POST' }, eve.token)).status).toBe(409);
      // and nothing was won: only the two starter gifts are in the bag
      const inv = (await (await req('/inventory', {}, eve.token)).json()) as { items: { item: string }[] };
      expect(inv.items.map((i) => i.item).sort()).toEqual(['deckchair', 'starfish']);
      // the next goes can win the new common and rare prizes
      waitOut(missed.nextFree);
      const holds = [0.5, 0.9, 0.1, 0.5];
      forcedRand = () => holds.shift() ?? 0.5;
      const kept = await go();
      expect(kept).toMatchObject({ missed: false, item: 'coconut', rarity: 'common' });
      // the same rest roll after a win skews long: 5 + 175 * 0.75 = 136.25 min
      expect(Math.round((kept.nextFree - (Date.now() + skew)) / 60000)).toBe(136);

      waitOut(kept.nextFree);
      const rare = [0.2, 0.9, 0.1, 0.5];
      forcedRand = () => rare.shift() ?? 0.5;
      expect(await go()).toMatchObject({ missed: false, item: 'coral', rarity: 'rare' });
      const updated = (await (await req('/inventory', {}, eve.token)).json()) as { items: { item: string }[] };
      expect(updated.items.map((i) => i.item)).toEqual(expect.arrayContaining(['coconut', 'coral']));
    } finally {
      forcedRand = null;
      skew = 0;
    }
  });

  it('starter gifts never miss, even when the claw would drop anything', async () => {
    // a fresh name, as above: Fay already has a beach row from another test
    const fay = await signIn('Ola');
    // a roll of 0.999 fails every grab (and draws a common ball) — the gifts land anyway
    forcedRand = () => 0.999;
    try {
      const go = async () => {
        const r = await req('/pulls/daily', { method: 'POST' }, fay.token);
        expect(r.status).toBe(200);
        const body = (await r.json()) as { item: string; missed: boolean; nextFree: number };
        skew += body.nextFree - (Date.now() + skew) + 1000; // wait out the rest
        return body;
      };
      expect(await go()).toMatchObject({ missed: false, item: 'starfish' });
      expect(await go()).toMatchObject({ missed: false, item: 'deckchair' });
    } finally {
      forcedRand = null;
      skew = 0;
    }
  });

  it('the claw holds on at the published rates', async () => {
    const { GRAB_CHANCE, grab } = await import('../src/pulls.js');
    const n = 20000;
    for (const k of ['common', 'rare', 'legendary'] as const) {
      let seed = 987654321;
      const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      let held = 0;
      for (let i = 0; i < n; i++) if (grab(k, rand)) held++;
      expect(held / n).toBeCloseTo(GRAB_CHANCE[k], 1);
    }
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

describe('vending machine', () => {
  type Pools = { pools: { id: string; name: string; odds: Record<string, number>; items: Record<string, string[]>; free: boolean; nextFree: number; set?: { week: number; name: string } }[] };
  const status = async (token: string) =>
    ((await (await req('/pulls', {}, token)).json()) as Pools).pools.find((p) => p.id === 'vending')!;

  beforeEach(() => {
    skew = Date.parse('2026-11-29T12:00:00Z') - Date.now();
  });
  afterEach(() => {
    skew = 0;
  });

  it('shows this week’s set and its odds; one free ball a day', async () => {
    const vera = await signIn('Vera');
    const first = await status(vera.token);
    expect(first.name).toBe('Vending machine');
    expect(first.set).toMatchObject({ week: 1, name: 'First light' });
    expect(Object.values(first.odds).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(first.odds).toMatchObject({ common: 0.6, uncommon: 0.25, rare: 0.12, unique: 0.03 });
    expect(first.free).toBe(true);

    // a ball: always an item from this week's set, never a claw starter gift
    const r = await req('/pulls/vending', { method: 'POST' }, vera.token);
    expect(r.status).toBe(200);
    const won = (await r.json()) as { item: string; rarity: string; nextFree: number };
    const all = Object.values(first.items).flat();
    expect(all).toContain(won.item);
    expect(first.items[won.rarity]).toContain(won.item);
    const inv = (await (await req('/inventory', {}, vera.token)).json()) as { items: { item: string; source: string }[] };
    expect(inv.items).toEqual([expect.objectContaining({ item: won.item, source: 'pull' })]);
    // the next ball is the next UTC midnight, not five minutes
    const midnight = new Date(won.nextFree);
    expect(midnight.getUTCHours()).toBe(0);
    expect(midnight.getUTCMinutes()).toBe(0);
    expect((await status(vera.token)).free).toBe(false);

    // a second ball the same day is refused…
    expect((await req('/pulls/vending', { method: 'POST' }, vera.token)).status).toBe(409);
    // At midnight the next set starts and the daily ball is available again.
    skew += won.nextFree - (Date.now() + skew) + 1000;
    expect(await status(vera.token)).toMatchObject({ set: { week: 2, name: 'Beach day' }, free: true });
    expect((await req('/pulls/vending', { method: 'POST' }, vera.token)).status).toBe(200);
  });

  it('two at once: exactly one gets the ball', async () => {
    const walt = await signIn('Walt');
    const [a, b] = await Promise.all([req('/pulls/vending', { method: 'POST' }, walt.token), req('/pulls/vending', { method: 'POST' }, walt.token)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const third = (await (await req('/pulls/vending', { method: 'POST' }, walt.token)).json()) as { error?: string };
    expect(third.error).toMatch(/tomorrow/);
  });

  it('a one-of-a-kind item has one owner: the next draw of it gives a rare, a gift moves it', async () => {
    // earlier random vending pulls in this suite have a 3 % chance of claiming nautilus
    await db.query("DELETE FROM unique_items WHERE item_id = 'nautilus'");
    // the dice: the unique slot (3 %), first item
    forcedRand = () => 0.01;
    try {
      const una = await signIn('Una');
      const una1 = (await (await req('/pulls/vending', { method: 'POST' }, una.token)).json()) as { item: string; rarity: string };
      expect(una1).toMatchObject({ item: 'nautilus', rarity: 'unique' });
      const inv = ((await (await req('/inventory', {}, una.token)).json()) as { items: { item: string; foundBy?: string }[] }).items;
      expect(inv.find((i) => i.item === 'nautilus')?.foundBy).toBe('Una');
      // someone else draws it too: it's taken, so they get a rare instead
      const otto = await signIn('Otto');
      const otto1 = (await (await req('/pulls/vending', { method: 'POST' }, otto.token)).json()) as { item: string; rarity: string };
      expect(otto1.rarity).toBe('rare');
      expect(otto1.item).not.toBe('nautilus');
      // Una gives it to Otto: he owns it now (still "found by Una")
      const ottoCode = ((await (await req('/beaches/mine', {}, otto.token)).json()) as { beaches: { code: string }[] }).beaches[0].code;
      expect((await req('/gifts', json('POST', { code: ottoCode, item: 'nautilus' }), una.token)).status).toBe(200);
      const owner = await db.query<{ owner_id: string; found_by: string }>("SELECT owner_id, found_by FROM unique_items WHERE item_id = 'nautilus'");
      expect(owner[0]).toEqual({ owner_id: otto.user.id, found_by: 'Una' });
      // an owner who leaves frees it to be found again
      await req('/account', { method: 'DELETE' }, otto.token);
      skew += 86400000;
      const una2 = (await (await req('/pulls/vending', { method: 'POST' }, una.token)).json()) as { item: string; rarity: string };
      expect(una2).toMatchObject({ item: 'nautilus', rarity: 'unique' });
    } finally {
      forcedRand = null;
      skew = 0;
    }
  });

  it('a ball from the vending machine does not spend the claw’s free go', async () => {
    const uma = await signIn('Uma');
    expect((await req('/pulls/vending', { method: 'POST' }, uma.token)).status).toBe(200);
    const daily = ((await (await req('/pulls', {}, uma.token)).json()) as Pools).pools.find((p) => p.id === 'daily')!;
    expect(daily.free).toBe(true);
  });

  it('a vending ball never slips: only the claw can miss', async () => {
    const quin = await signIn('Quin');
    type Grabs = { pools: { id: string; grab?: Record<string, number> }[] };
    const pools = ((await (await req('/pulls', {}, quin.token)).json()) as Grabs).pools;
    expect(pools.find((p) => p.id === 'daily')!.grab).toEqual({ common: 0.8, rare: 0.65, legendary: 0.4 });
    expect(pools.find((p) => p.id === 'vending')!.grab).toBeUndefined();
    // dice that would make every claw grab fail (0.999 draws a common ball)
    forcedRand = () => 0.999;
    try {
      const r = await req('/pulls/vending', { method: 'POST' }, quin.token);
      expect(r.status).toBe(200);
      const won = (await r.json()) as { missed: boolean; item: string | null; rarity: string | null };
      expect(won).toMatchObject({ missed: false, rarity: 'common' });
      expect(won.item).toBeTruthy();
      const inv = (await (await req('/inventory', {}, quin.token)).json()) as { items: { item: string }[] };
      expect(inv.items.map((i) => i.item)).toEqual([won.item]);
    } finally {
      forcedRand = null;
    }
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

describe('leaderboard', () => {
  type Entry = { rank: number; code: string; name: string; location: string; stars: number; recent: number; velocity: number; starred: boolean; yours: boolean };
  const DAY = 86400000;
  const board = async (token: string, which = 'all', limit = 100) => {
    const r = await req(`/leaderboard?board=${which}&limit=${limit}`, {}, token);
    expect(r.status).toBe(200);
    return ((await r.json()) as { entries: Entry[] }).entries;
  };
  const codeOf = async (token: string) => ((await (await req('/neighbors', {}, token)).json()) as { code: string }).code;
  const star = (token: string, code: string) => req(`/favorites/${code}`, { method: 'PUT' }, token);

  it('ranks all-time stars and rising star velocity, leaving off-shore and unsaved beaches out', async () => {
    const owners = await Promise.all(['Old', 'New', 'Mid', 'Hid', 'Bare'].map((n) => signIn(`lb${n}`)));
    const [old, nu, mid, hid] = owners;
    for (const o of [old, nu, mid, hid]) await putBeach(o.token, new Uint8Array([1, 2, 3]), 'piha');
    await db.query('UPDATE beach SET on_shore = false WHERE owner_id = $1', [hid.user.id]);
    const codes = await Promise.all(owners.map((o) => codeOf(o.token)));
    const [cOld, cNew, cMid, cHid, cBare] = codes;
    const fans = await Promise.all(['f1', 'f2', 'f3', 'f4'].map((n) => signIn(`lbfan-${n}`)));
    const ours = (es: Entry[]) => es.filter((e) => codes.includes(e.code));
    try {
      // ten days ago three fans starred Old
      skew = -10 * DAY;
      for (const f of fans.slice(0, 3)) expect((await star(f.token, cOld)).status).toBe(200);
      // four days ago all four starred Mid
      skew = -4 * DAY;
      for (const f of fans) await star(f.token, cMid);
      // today two starred New, and everyone stars the off-shore and the never-saved beach
      skew = 0;
      for (const f of fans.slice(0, 2)) await star(f.token, cNew);
      for (const f of fans) {
        await star(f.token, cHid);
        await star(f.token, cBare);
      }
      // un-starring Old and starring it again doesn't make that star new
      expect((await req(`/favorites/${cOld}`, { method: 'DELETE' }, fans[0].token)).status).toBe(204);
      await star(fans[0].token, cOld);
      // a fan who un-stars for good stops counting
      await req(`/favorites/${cMid}`, { method: 'DELETE' }, fans[3].token);

      const all = ours(await board(fans[0].token));
      expect(all.map((e) => [e.name, e.stars, e.recent])).toEqual([
        ['lbMid', 3, 3], // a tie on stars goes to the one rising faster
        ['lbOld', 3, 0],
        ['lbNew', 2, 2],
      ]);
      expect(all[0].rank).toBeLessThan(all[1].rank);
      expect(all[1].rank).toBeLessThan(all[2].rank);
      expect(all[1]).toMatchObject({ code: cOld, location: 'piha', starred: true, yours: false });

      const rising = ours(await board(fans[0].token, 'rising'));
      expect(rising.map((e) => e.name)).toEqual(['lbNew', 'lbMid']); // Old's stars are all older than a week
      expect(rising[0].velocity).toBeCloseTo(2, 1); // two stars today
      expect(rising[1].velocity).toBeCloseTo(0.75, 1); // three stars four days old: 3 × ½²
      // fan 4 never starred New
      expect(ours(await board(fans[3].token, 'rising'))[0]).toMatchObject({ name: 'lbNew', starred: false });
      // the owner sees their own beach marked
      expect(ours(await board(nu.token, 'rising'))[0]).toMatchObject({ name: 'lbNew', yours: true, starred: false });

      // more than a week on, nothing is rising any more; the all-time board stands
      skew = 8 * DAY;
      expect(ours(await board(fans[0].token, 'rising'))).toEqual([]);
      expect(ours(await board(fans[0].token)).map((e) => e.stars)).toEqual([3, 3, 2]);
    } finally {
      skew = 0;
    }
    expect((await board(fans[0].token, 'all', 1)).length).toBe(1);
    expect((await req('/leaderboard?board=weekly', {}, fans[0].token)).status).toBe(400);
    expect((await req('/leaderboard')).status).toBe(401);
  });
});
