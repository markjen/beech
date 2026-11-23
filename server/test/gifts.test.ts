import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgDb, createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL) {
    db = createPgDb({ url: process.env.TEST_DATABASE_URL });
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } else {
    db = await createPgliteDb();
  }
  await migrate(db);
  app = createApp(db, {
    googleClientIds: ['web'],
    appleClientIds: [],
    allowedOrigins: ['capacitor://localhost'],
    devAuth: true,
    // a pretend Apple refund notification: the payload is just { refund: txId }
    stores: { appleRefund: async (p) => (JSON.parse(p) as { refund?: string }).refund ?? null },
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
async function codeOf(token: string): Promise<string> {
  const r = await req('/neighbors', {}, token);
  expect(r.status).toBe(200);
  return ((await r.json()) as { code: string }).code;
}
/** give `userId` `n` rows of `item` (one per row, like pulls do) */
async function seed(userId: string, item: string, n: number, expiresAt: number | null = null) {
  await db.query(
    `INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at)
     SELECT $1, $2, 1, 'pull', $3, $4 FROM generate_series(1, $5)`,
    [userId, item, Date.now(), expiresAt, n],
  );
}
async function owned(token: string, item: string): Promise<number> {
  const r = await req('/inventory', {}, token);
  expect(r.status).toBe(200);
  const items = ((await r.json()) as { items: { item: string; quantity: number }[] }).items;
  return items.filter((i) => i.item === item).reduce((s, i) => s + i.quantity, 0);
}
const gift = (token: string, code: string, item: string) => req('/gifts', json('POST', { code, item }), token);

describe('gifts', () => {
  it('a refund of the purchase takes a gifted item back from the recipient too', async () => {
    const a = await signIn('buyer-refund');
    const b = await signIn('alt-refund');
    // a bought parasol (like /store/purchase grants it: tied to its purchase)
    const [p] = await db.query<{ id: string }>(
      `INSERT INTO purchases (user_id, store, transaction_id, product_id, environment, purchased_at, granted_at)
       VALUES ($1, 'apple', 'GIFT-REFUND-1', 'item_parasol', 'Sandbox', 1, 1) RETURNING id`,
      [a.user.id],
    );
    await db.query(
      `INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, purchase_id)
       VALUES ($1, 'parasol', 1, 'shop', $2, $3)`,
      [a.user.id, Date.now(), p.id],
    );
    expect((await gift(a.token, await codeOf(b.token), 'parasol')).status).toBe(200);
    expect(await owned(b.token, 'parasol')).toBe(1);
    const r = await req('/store/apple/notifications', json('POST', { signedPayload: JSON.stringify({ refund: 'GIFT-REFUND-1' }) }));
    expect(r.status).toBe(200);
    expect(await owned(b.token, 'parasol')).toBe(0);
    expect(await owned(a.token, 'parasol')).toBe(0);
  });

  it('moves one item from the giver to the recipient, marked as a gift', async () => {
    const a = await signIn('giver-a');
    const b = await signIn('receiver-a');
    await seed(a.user.id, 'starfish', 1);
    expect(await owned(a.token, 'starfish')).toBe(1);
    expect(await owned(b.token, 'starfish')).toBe(0);
    const r = await gift(a.token, await codeOf(b.token), 'starfish');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ item: 'starfish', to: { name: 'receiver-a', code: await codeOf(b.token) } });
    expect(await owned(a.token, 'starfish')).toBe(0);
    const inv = (await (await req('/inventory', {}, b.token)).json()) as {
      items: { item: string; quantity: number; source: string }[];
    };
    expect(inv.items).toContainEqual(expect.objectContaining({ item: 'starfish', quantity: 1, source: 'gift' }));
  });

  it('carries the expiry over to the recipient', async () => {
    const a = await signIn('giver-exp');
    const b = await signIn('receiver-exp');
    const until = Date.now() + 3600000;
    await seed(a.user.id, 'bottle', 1, until);
    const r = await gift(a.token, await codeOf(b.token), 'bottle');
    expect(r.status).toBe(200);
    const inv = (await (await req('/inventory', {}, b.token)).json()) as {
      items: { item: string; expiresAt: number | null }[];
    };
    expect(inv.items.find((i) => i.item === 'bottle')?.expiresAt).toBe(until);
  });

  it('rejects an unknown code, a bad code, a missing item, and your own code', async () => {
    const a = await signIn('giver-bad');
    const b = await signIn('receiver-bad');
    const bCode = await codeOf(b.token);
    expect((await gift(a.token, 'ZZZZZZ', 'starfish')).status).toBe(404);
    expect((await gift(a.token, 'abc', 'starfish')).status).toBe(400);
    expect((await req('/gifts', json('POST', { code: bCode }), a.token)).status).toBe(400);
    expect((await gift(a.token, await codeOf(a.token), 'starfish')).status).toBe(400);
    expect((await gift(a.token, bCode, 'starfish')).status).toBe(409); // nothing to give
    expect((await req('/gifts', json('POST', { code: bCode, item: 'starfish' }))).status).toBe(401); // not signed in
  });

  it("can't gift a free item (no inventory row to move)", async () => {
    const a = await signIn('giver-free');
    const b = await signIn('receiver-free');
    expect((await gift(a.token, await codeOf(b.token), 'rock')).status).toBe(409);
  });

  it("can't gift an expired row", async () => {
    const a = await signIn('giver-old');
    const b = await signIn('receiver-old');
    await seed(a.user.id, 'conch', 1, Date.now() - 1000);
    expect((await gift(a.token, await codeOf(b.token), 'conch')).status).toBe(409);
    expect(await owned(b.token, 'conch')).toBe(0);
  });

  it('a second gift of the same last item fails', async () => {
    const a = await signIn('giver-twice');
    const b = await signIn('receiver-twice');
    const c = await signIn('receiver-twice-2');
    await seed(a.user.id, 'sanddollar', 1);
    expect((await gift(a.token, await codeOf(b.token), 'sanddollar')).status).toBe(200);
    expect((await gift(a.token, await codeOf(c.token), 'sanddollar')).status).toBe(409);
    expect(await owned(c.token, 'sanddollar')).toBe(0);
  });

  it('two concurrent gifts of one item: exactly one goes through', async () => {
    const a = await signIn('giver-race');
    const b = await signIn('receiver-race-1');
    const c = await signIn('receiver-race-2');
    await seed(a.user.id, 'starfish', 1);
    const [r1, r2] = await Promise.all([
      gift(a.token, await codeOf(b.token), 'starfish'),
      gift(a.token, await codeOf(c.token), 'starfish'),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect((await owned(b.token, 'starfish')) + (await owned(c.token, 'starfish'))).toBe(1);
  });

  it('the 21st gift in an hour is rate-limited', async () => {
    const a = await signIn('giver-many');
    const b = await signIn('receiver-many');
    await seed(a.user.id, 'conch', 25);
    const bCode = await codeOf(b.token);
    for (let i = 0; i < 20; i++) expect((await gift(a.token, bCode, 'conch')).status).toBe(200);
    expect((await gift(a.token, bCode, 'conch')).status).toBe(429);
    expect(await owned(b.token, 'conch')).toBe(20);
  });
});
