import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgDb, createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { CLAIM_WINDOW_MS, GUIDE_BONUS, GUIDE_STEPS, REWARD_CAP, SETTLE_STEPS, WELCOME_GIFT, ladderReward } from '../src/referrals.js';

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
  app = createApp(db, { googleClientIds: ['web'], appleClientIds: [], allowedOrigins: [], devAuth: true });
});

afterAll(() => db.close());

const req = (path: string, init: RequestInit = {}, token?: string) =>
  app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
let seq = 0;
async function signIn(name = `p${++seq}`) {
  const r = await req('/auth/dev', json('POST', { name: `${name}-${++seq}` }));
  expect(r.status).toBe(200);
  const s = (await r.json()) as { token: string; user: { id: string; name: string } };
  const n = (await (await req('/neighbors', {}, s.token)).json()) as { code: string };
  return { ...s, code: n.code };
}
async function owned(token: string, item: string): Promise<number> {
  const items = ((await (await req('/inventory', {}, token)).json()) as { items: { item: string; quantity: number; source: string }[] }).items;
  return items.filter((i) => i.item === item).reduce((s, i) => s + i.quantity, 0);
}
async function rewards(userId: string): Promise<string[]> {
  const rows = await db.query<{ item_id: string }>(`SELECT item_id FROM inventory WHERE user_id = $1 AND source = 'reward' ORDER BY id`, [userId]);
  return rows.map((r) => r.item_id);
}
const step = (token: string, id: string) => req(`/guide/${id}`, { method: 'POST' }, token);
const claim = (token: string, code: string) => req('/referrals/claim', json('POST', { code }), token);
/** do the first n app-checked steps */
async function settleIn(token: string, n = SETTLE_STEPS) {
  for (const s of ['dig', 'pile', 'undo', 'place', 'chair'].slice(0, n)) expect((await step(token, s)).status).toBe(200);
}

describe('the beach guide', () => {
  it('gives each step its gift once, however often it is sent', async () => {
    const a = await signIn();
    const r1 = await step(a.token, 'dig');
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ step: 'dig', new: true, gift: 'conch', bonus: null });
    const r2 = await step(a.token, 'dig');
    expect(await r2.json()).toEqual({ step: 'dig', new: false, gift: null, bonus: null });
    // two at once: still one gift
    const both = await Promise.all([step(a.token, 'pile'), step(a.token, 'pile')]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(await owned(a.token, 'conch')).toBe(1);
    expect(await owned(a.token, 'sanddollar')).toBe(1);
    const done = ((await (await req('/guide', {}, a.token)).json()) as { done: { step: string }[] }).done.map((d) => d.step);
    expect(done.sort()).toEqual(['dig', 'pile']);
  });

  it('refuses an unknown step, and a signed-out one', async () => {
    const a = await signIn();
    expect((await step(a.token, 'fly')).status).toBe(400);
    expect((await req('/guide/dig', { method: 'POST' })).status).toBe(401);
  });

  it('checks the claw, star and invite steps on the server', async () => {
    const a = await signIn();
    const b = await signIn();
    for (const s of ['claw', 'star', 'invite']) expect((await step(a.token, s)).status).toBe(409);
    // a claw go
    expect((await req('/pulls/daily', { method: 'POST' }, a.token)).status).toBe(200);
    expect((await step(a.token, 'claw')).status).toBe(200);
    // a star
    expect((await req(`/favorites/${b.code}`, { method: 'PUT' }, a.token)).status).toBeLessThan(300);
    const star = await step(a.token, 'star');
    expect(star.status).toBe(200);
    expect(((await star.json()) as { gift: string }).gift).toBe('conch');
    // a friend joined: the inviter's step is done for them
    const friend = await signIn();
    expect((await claim(friend.token, a.code)).status).toBe(200);
    const done = ((await (await req('/guide', {}, a.token)).json()) as { done: { step: string }[] }).done.map((d) => d.step);
    expect(done).toContain('invite');
  });

  it('gives the bonus once every step but invite is done', async () => {
    const a = await signIn();
    const b = await signIn();
    await req('/pulls/daily', { method: 'POST' }, a.token);
    await req(`/favorites/${b.code}`, { method: 'PUT' }, a.token);
    const order = GUIDE_STEPS.filter((s) => s.id !== 'invite').map((s) => s.id);
    let bonus: string | null = null;
    for (const [i, id] of order.entries()) {
      const r = (await (await step(a.token, id)).json()) as { bonus: string | null };
      if (i < order.length - 1) expect(r.bonus).toBeNull();
      else bonus = r.bonus;
    }
    expect(bonus).toBe(GUIDE_BONUS);
    // again: no second bonus
    expect(((await (await step(a.token, 'dig')).json()) as { bonus: string | null }).bonus).toBeNull();
    const gifts = GUIDE_STEPS.map((s) => s.gift).filter((g): g is string => !!g);
    expect((await rewards(a.user.id)).sort()).toEqual([...gifts, GUIDE_BONUS].sort());
  });
});

describe('invites', () => {
  it('looks up who an invite is from without signing in', async () => {
    const a = await signIn('Ana');
    const r = await req(`/invites/${a.code.toLowerCase()}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ name: a.user.name, welcomeGift: WELCOME_GIFT });
    expect((await req('/invites/ZZZZZZ')).status).toBe(404);
  });

  it('gives the friend a welcome gift, once', async () => {
    const a = await signIn();
    const f = await signIn();
    const r = await claim(f.token, a.code);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ inviter: { name: a.user.name, code: a.code }, gift: WELCOME_GIFT });
    expect(await owned(f.token, WELCOME_GIFT)).toBe(1);
    // a second claim (the same or someone else's): refused, no second gift
    const other = await signIn();
    expect((await claim(f.token, a.code)).status).toBe(409);
    expect((await claim(f.token, other.code)).status).toBe(409);
    expect(await owned(f.token, WELCOME_GIFT)).toBe(1);
    // the inviter sees them, not settled in yet
    const mine = (await (await req('/referrals', {}, a.token)).json()) as { code: string; joined: number; settled: number; friends: { name: string; settled: boolean }[] };
    expect(mine.code).toBe(a.code);
    expect(mine.joined).toBe(1);
    expect(mine.settled).toBe(0);
    expect(mine.friends).toMatchObject([{ name: f.user.name, settled: false }]);
  });

  it('refuses bad, unknown and your own codes, and old accounts', async () => {
    const a = await signIn();
    const f = await signIn();
    expect((await claim(f.token, 'abc')).status).toBe(400);
    expect((await claim(f.token, 'ZZZZZZ')).status).toBe(404);
    expect((await claim(a.token, a.code)).status).toBe(400);
    // an extra beach of your own is still your own
    await db.query(`INSERT INTO beach (id, owner_id, code, home, created_at) VALUES ($1, $2, 'OWN2ND', false, 0)`, [crypto.randomUUID(), a.user.id]);
    expect((await claim(a.token, 'OWN2ND')).status).toBe(400);
    // a player from before the claim window
    await db.query('UPDATE users SET created_at = $2 WHERE id = $1', [f.user.id, Date.now() - CLAIM_WINDOW_MS - 1000]);
    expect((await claim(f.token, a.code)).status).toBe(409);
    expect(await owned(f.token, WELCOME_GIFT)).toBe(0);
  });

  it('rewards the inviter once the friend settles in, and only then', async () => {
    const a = await signIn();
    const f = await signIn();
    await claim(f.token, a.code);
    await settleIn(f.token, SETTLE_STEPS - 1);
    expect(await rewards(a.user.id)).toEqual([]);
    await settleIn(f.token, SETTLE_STEPS + 1); // the last one settles them; one more changes nothing
    expect(await rewards(a.user.id)).toEqual([ladderReward(1)]);
    const mine = (await (await req('/referrals', {}, a.token)).json()) as { settled: number; friends: { settled: boolean; reward: string }[] };
    expect(mine.settled).toBe(1);
    expect(mine.friends[0]).toMatchObject({ settled: true, reward: ladderReward(1) });
  });

  it('counts guide steps done before the claim', async () => {
    const a = await signIn();
    const f = await signIn();
    await settleIn(f.token);
    expect((await claim(f.token, a.code)).status).toBe(200);
    expect(await rewards(a.user.id)).toEqual([ladderReward(1)]);
  });

  it('climbs the ladder (an extra beach at three) and stops at the cap', async () => {
    const a = await signIn();
    for (let i = 0; i < REWARD_CAP + 2; i++) {
      const f = await signIn();
      await claim(f.token, a.code);
      await settleIn(f.token);
    }
    const got = await rewards(a.user.id);
    expect(got).toEqual(Array.from({ length: REWARD_CAP }, (_, i) => ladderReward(i + 1)));
    expect(got[2]).toBe('beach');
    expect(ladderReward(REWARD_CAP + 1)).toBeNull();
    // the extra beach is a real allowance: one more beach can be made
    const aEdit = ((await (await req('/edit-session', { method: 'POST' }, a.token)).json()) as { token: string }).token;
    expect((await req('/beaches/mine', { ...json('POST', { name: 'Second', location: 'bondi' }), headers: { 'Content-Type': 'application/json', 'X-Edit-Token': aEdit } }, a.token)).status).toBe(200);
    const mine = (await (await req('/referrals', {}, a.token)).json()) as { joined: number; settled: number };
    expect(mine).toMatchObject({ joined: REWARD_CAP + 2, settled: REWARD_CAP + 2 });
  });

  it('gives friends settling in at the same moment different rungs', async () => {
    const a = await signIn();
    const fs = [await signIn(), await signIn(), await signIn()];
    for (const f of fs) {
      await claim(f.token, a.code);
      await settleIn(f.token, SETTLE_STEPS - 1);
    }
    await Promise.all(fs.map((f) => step(f.token, 'place')));
    expect((await rewards(a.user.id)).sort()).toEqual([ladderReward(1), ladderReward(2), ladderReward(3)].sort());
    const ranks = await db.query<{ reward_rank: number }>('SELECT reward_rank FROM referrals WHERE inviter_id = $1 ORDER BY reward_rank', [a.user.id]);
    expect(ranks.map((r) => Number(r.reward_rank))).toEqual([1, 2, 3]);
  });

  it('goes when either account is deleted', async () => {
    const a = await signIn();
    const f = await signIn();
    await claim(f.token, a.code);
    expect((await req('/account', { method: 'DELETE' }, f.token)).status).toBe(204);
    expect(((await (await req('/referrals', {}, a.token)).json()) as { joined: number }).joined).toBe(0);
  });
});
