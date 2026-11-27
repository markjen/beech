import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { CLAIM_WINDOW_MS, GUIDE_BONUS, GUIDE_STEPS, INVITE_BONUS, REWARD_CAP, SETTLE_STEPS, ladderReward } from '../src/referrals.js';
import { openTestDb } from './testDb.js';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await openTestDb();
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
/** a checkpoint row as the save route writes it (the sand itself isn't looked at here) */
const checkpoint = (owner: string, kind: string, source = 'beach') =>
  db.query(
    `INSERT INTO checkpoints (id, owner_id, name, kind, source, nx, ny, sand, bytes, objects, created_at)
     VALUES (gen_random_uuid(), $1, 'cp', $2, $3, 1, 1, '\\x00', 1, 0, $4)`,
    [owner, kind, source, Date.now()],
  );
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

  it('checks the vending and checkpoint steps on the server', async () => {
    const a = await signIn();
    for (const s of ['vending', 'checkpoint']) expect((await step(a.token, s)).status).toBe(409);
    expect((await req('/pulls/vending', { method: 'POST' }, a.token)).status).toBe(200);
    expect((await step(a.token, 'vending')).status).toBe(200);
    // an automatic copy doesn't count: only one you saved yourself
    // (nor a copy of someone else's beach)
    await checkpoint(a.user.id, 'auto');
    await checkpoint(a.user.id, 'tide');
    await checkpoint(a.user.id, 'named', 'copy');
    expect((await step(a.token, 'checkpoint')).status).toBe(409);
    await checkpoint(a.user.id, 'named');
    const cp = await step(a.token, 'checkpoint');
    expect(cp.status).toBe(200);
    expect(((await cp.json()) as { gift: string }).gift).toBe('sanddollar');
  });

  it('gives the bonus once every step but invite is done', async () => {
    const a = await signIn();
    const b = await signIn();
    await req('/pulls/daily', { method: 'POST' }, a.token);
    await req(`/favorites/${b.code}`, { method: 'PUT' }, a.token);
    await req('/pulls/vending', { method: 'POST' }, a.token);
    await checkpoint(a.user.id, 'named');
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
  const bucks = async (userId: string) =>
    Number((await db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [userId]))[0].credit_cents) / 10;
  const bonusRows = async (userId: string) =>
    (await db.query<{ amount_cents: number }>(`SELECT amount_cents FROM credit_ledger WHERE user_id = $1 AND kind = 'invite_bonus'`, [userId])).length;

  it('looks up who an invite is from without signing in', async () => {
    const a = await signIn('Ana');
    const r = await req(`/invites/${a.code.toLowerCase()}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ name: a.user.name, welcomeBucks: INVITE_BONUS });
    expect((await req('/invites/ZZZZZZ')).status).toBe(404);
  });

  it('gives the friend and the inviter the bonus, once', async () => {
    const a = await signIn();
    const f = await signIn();
    const r = await claim(f.token, a.code);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ inviter: { name: a.user.name, code: a.code }, bucks: INVITE_BONUS, inviterRewarded: true });
    expect(await bucks(f.user.id)).toBe(INVITE_BONUS);
    expect(await bucks(a.user.id)).toBe(INVITE_BONUS);
    // a second claim (the same or someone else's): refused, no second bonus
    const other = await signIn();
    expect((await claim(f.token, a.code)).status).toBe(409);
    expect((await claim(f.token, other.code)).status).toBe(409);
    expect(await bucks(f.user.id)).toBe(INVITE_BONUS);
    expect(await bucks(a.user.id)).toBe(INVITE_BONUS);
    expect(await bucks(other.user.id)).toBe(0);
    // no item gifts any more
    expect(await rewards(f.user.id)).toEqual([]);
    expect(await rewards(a.user.id)).toEqual([]);
    const mine = (await (await req('/referrals', {}, a.token)).json()) as { code: string; joined: number; earned: number; friends: { name: string; bucks: number }[] };
    expect(mine.code).toBe(a.code);
    expect(mine.joined).toBe(1);
    expect(mine.earned).toBe(INVITE_BONUS);
    expect(mine.friends).toMatchObject([{ name: f.user.name, bucks: INVITE_BONUS }]);
  });

  it('gives one bonus when two devices claim at once (OneBonusEach)', async () => {
    const a = await signIn();
    const f = await signIn();
    const rs = await Promise.all([claim(f.token, a.code), claim(f.token, a.code)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await bucks(f.user.id)).toBe(INVITE_BONUS);
    expect(await bucks(a.user.id)).toBe(INVITE_BONUS);
    expect(await bonusRows(f.user.id)).toBe(1);
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
    expect(await bucks(f.user.id)).toBe(0);
    expect(await bucks(a.user.id)).toBe(0);
  });

  it('stops the inviter’s bonus at the cap; friends past it still get theirs (CapHolds, InviterPaid)', async () => {
    const a = await signIn();
    const fs = [];
    for (let i = 0; i < REWARD_CAP + 2; i++) {
      const f = await signIn();
      fs.push(f);
      const r = (await (await claim(f.token, a.code)).json()) as { inviterRewarded: boolean };
      expect(r.inviterRewarded).toBe(i < REWARD_CAP);
    }
    expect(await bucks(a.user.id)).toBe(REWARD_CAP * INVITE_BONUS);
    for (const f of fs) expect(await bucks(f.user.id)).toBe(INVITE_BONUS);
    const mine = (await (await req('/referrals', {}, a.token)).json()) as { joined: number; earned: number };
    expect(mine).toMatchObject({ joined: REWARD_CAP + 2, earned: REWARD_CAP * INVITE_BONUS });
  });

  it('gives friends claiming at the same moment different ranks, and holds the cap', async () => {
    const a = await signIn();
    // one rank short of the cap: three friends race for the last one
    for (let i = 0; i < REWARD_CAP - 1; i++) {
      const f = await signIn();
      await claim(f.token, a.code);
    }
    const fs = [await signIn(), await signIn(), await signIn()];
    const rs = await Promise.all(fs.map((f) => claim(f.token, a.code)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await bucks(a.user.id)).toBe(REWARD_CAP * INVITE_BONUS);
    for (const f of fs) expect(await bucks(f.user.id)).toBe(INVITE_BONUS);
    const ranks = await db.query<{ reward_rank: number }>('SELECT reward_rank FROM referrals WHERE inviter_id = $1 AND reward_rank IS NOT NULL ORDER BY reward_rank', [a.user.id]);
    expect(ranks.map((r) => Number(r.reward_rank))).toEqual(Array.from({ length: REWARD_CAP }, (_, i) => i + 1));
  });

  it('still settles a referral from before the bonus on the old ladder', async () => {
    const a = await signIn();
    const f = await signIn();
    await db.query('INSERT INTO referrals (invitee_id, inviter_id, code, created_at) VALUES ($1, $2, $3, 0)', [f.user.id, a.user.id, a.code]);
    await settleIn(f.token);
    expect(await rewards(a.user.id)).toEqual([ladderReward(1)]);
    // a new-style referral never settles onto the ladder
    const g = await signIn();
    await claim(g.token, a.code);
    await settleIn(g.token);
    expect(await rewards(a.user.id)).toEqual([ladderReward(1)]);
  });

  it('goes when either account is deleted', async () => {
    const a = await signIn();
    const f = await signIn();
    await claim(f.token, a.code);
    expect((await req('/account', { method: 'DELETE' }, f.token)).status).toBe(204);
    expect(((await (await req('/referrals', {}, a.token)).json()) as { joined: number }).joined).toBe(0);
  });
});
