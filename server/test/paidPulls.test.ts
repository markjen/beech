import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { BUCK } from '../src/bucks.js';
import { creditBalance } from '../src/bucksDb.js';
import {
  CLAW_EXTRA_GO_BUCKS,
  VENDING_EXTRA_BALL_BUCKS,
  clawExtraGoEV,
  expectedBucks,
  paidTryPrice,
  vendingExtraBallEV,
} from '../src/paidPulls.js';
import { GRAB_CHANCE, POOLS } from '../src/pulls.js';
import { VENDING_ODDS } from '../src/vending.js';
import { openTestDb } from './testDb.js';

describe('paid-try pricing', () => {
  it('values a won item at its trade-in value (unique: one step above legendary)', () => {
    // the vending ball, from the standard odds: 60% common (5), 25% uncommon
    // (10), 12% rare (15), 3% unique (40)
    expect(vendingExtraBallEV()).toBeCloseTo(0.6 * 5 + 0.25 * 10 + 0.12 * 15 + 0.03 * 40, 9);
    expect(vendingExtraBallEV()).toBeCloseTo(8.5, 9);
  });

  it('a claw go is worth less than its draw: the ball can slip out', () => {
    // the draw alone would be 0.7×5 + 0.25×15 + 0.05×30 = 8.75; holding on
    // keeps 80% of commons, 65% of rares, 40% of legendaries
    const drawEV = expectedBucks(POOLS.daily.odds);
    expect(drawEV).toBeCloseTo(8.75, 9);
    expect(clawExtraGoEV()).toBeCloseTo(0.7 * 0.8 * 5 + 0.25 * 0.65 * 15 + 0.05 * 0.4 * 30, 9);
    expect(clawExtraGoEV()).toBeCloseTo(5.8375, 9);
    expect(clawExtraGoEV()).toBeLessThan(drawEV);
  });

  it('both machines price at 10 sand bucks (Mark, Nov 26) — above EV on both', () => {
    expect(VENDING_EXTRA_BALL_BUCKS).toBe(10);
    expect(CLAW_EXTRA_GO_BUCKS).toBe(10);
    // the vending edge is thin (~18%), the claw's is ~71%
    expect((VENDING_EXTRA_BALL_BUCKS - vendingExtraBallEV()) / vendingExtraBallEV()).toBeCloseTo(0.18, 1);
    expect((CLAW_EXTRA_GO_BUCKS - clawExtraGoEV()) / clawExtraGoEV()).toBeCloseTo(0.71, 1);
    // and the price is above EV, so a try can't be farmed for trade-ins
    expect(VENDING_EXTRA_BALL_BUCKS).toBeGreaterThan(vendingExtraBallEV());
    expect(CLAW_EXTRA_GO_BUCKS).toBeGreaterThan(clawExtraGoEV());
  });

  it('the price follows the live tables, not a hardcoded number', () => {
    expect(paidTryPrice('daily')).toBe(CLAW_EXTRA_GO_BUCKS);
    expect(paidTryPrice('vending')).toBe(VENDING_EXTRA_BALL_BUCKS);
    expect(paidTryPrice('dig')).toBeNull();
    expect(paidTryPrice('nope')).toBeNull();
    // the grab chances are what make the claw cheaper than its draw
    expect(expectedBucks(POOLS.daily.odds, undefined, { ...GRAB_CHANCE, common: 1, rare: 1, legendary: 1 })).toBeCloseTo(8.75, 9);
    expect(VENDING_ODDS).toEqual({ common: 0.6, uncommon: 0.25, rare: 0.12, unique: 0.03 });
  });
});

let db: Db;
/** the server's clock in these tests: real time plus however far a test moved it on */
let skew = 0;
/** the server's dice in these tests: a test can force them, then put them back */
let forcedRand: (() => number) | null = null;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await openTestDb();
  app = createApp(db, {
    googleClientIds: ['web'],
    appleClientIds: [],
    allowedOrigins: ['capacitor://localhost'],
    devAuth: true,
    now: () => Date.now() + skew,
    rand: () => (forcedRand?.() ?? Math.random()),
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
async function owned(token: string, item: string): Promise<number> {
  const r = await req('/inventory', {}, token);
  expect(r.status).toBe(200);
  const items = ((await r.json()) as { items: { item: string; quantity: number }[] }).items;
  return items.filter((i) => i.item === item).reduce((s, i) => s + i.quantity, 0);
}
async function balance(userId: string): Promise<number> {
  const rows = await db.query<{ credit_cents: string }>('SELECT credit_cents FROM users WHERE id = $1', [userId]);
  return Math.floor(Number(rows[0]?.credit_cents ?? 0) / BUCK);
}
async function fund(userId: string, bucks: number) {
  // 'pack' is the ledger kind for bucks coming in (credit_ledger_kind_check)
  await creditBalance(db, userId, bucks * BUCK, 'pack', 'paid-pulls-test', Date.now() + skew);
  expect(await balance(userId)).toBe(bucks);
}
async function pullsLogged(userId: string, pool: string): Promise<number> {
  const rows = await db.query<{ n: string }>('SELECT COUNT(*) AS n FROM pulls WHERE user_id = $1 AND pool = $2', [userId, pool]);
  return Number(rows[0]?.n ?? 0);
}
async function pullCount(userId: string, pool: string): Promise<number> {
  const rows = await db.query<{ count: string }>('SELECT count FROM pull_state WHERE user_id = $1 AND pool = $2', [userId, pool]);
  return rows[0] ? Number(rows[0].count) : 0;
}
const paid = (pool: string, token: string) => req(`/pulls/${pool}/paid`, { method: 'POST' }, token);
const free = (pool: string, token: string) => req(`/pulls/${pool}`, { method: 'POST' }, token);

describe('paid tries', () => {
  it('sign-in required, and the machine must exist', async () => {
    expect((await paid('daily')).status).toBe(401);
    const { token } = await signIn('paid-auth');
    expect((await paid('nope', token)).status).toBe(404);
    expect((await paid('dig', token)).status).toBe(404); // digging has no paid tries
  });

  it('GET /pulls publishes the paid prices and your balance', async () => {
    const { token, user } = await signIn('paid-status');
    await fund(user.id, 100);
    const r = await req('/pulls', {}, token);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      pools: { id: string; paidTry?: { bucks: number } }[];
      bucks: number;
    };
    expect(body.bucks).toBe(100);
    expect(body.pools.find((p) => p.id === 'daily')?.paidTry).toEqual({ bucks: 10 });
    expect(body.pools.find((p) => p.id === 'vending')?.paidTry).toEqual({ bucks: 10 });
  });

  it('broke: a 402, and nothing is deducted or granted', async () => {
    const { token, user } = await signIn('paid-broke');
    const r = await paid('vending', token);
    expect(r.status).toBe(402);
    expect(((await r.json()) as { error: string }).error).toMatch(/not enough sand bucks: 10 needed, 0 in your balance/);
    expect(await balance(user.id)).toBe(0);
    expect(await pullsLogged(user.id, 'vending')).toBe(0);
    const ledger = await db.query('SELECT * FROM credit_ledger WHERE user_id = $1', [user.id]);
    expect(ledger).toHaveLength(0);
  });

  it('a paid ball deducts, grants, logs — and leaves the free ball alone', async () => {
    const { token, user } = await signIn('paid-vending');
    await fund(user.id, 100);
    // the free ball is still there: a paid ball doesn't use it up
    const before = (await (await req('/pulls', {}, token)).json()) as { pools: { id: string; free: boolean }[] };
    expect(before.pools.find((p) => p.id === 'vending')?.free).toBe(true);
    // 0.5: a common ball, second common item in both weeks' sets
    forcedRand = () => 0.5;
    try {
      const r = await paid('vending', token);
      expect(r.status).toBe(200);
      const body = (await r.json()) as { missed: boolean; item: string; rarity: string; bucks: number; paid: boolean };
      expect(body).toMatchObject({ missed: false, item: 'blue-seaglass', rarity: 'common', bucks: 90, paid: true });
      expect(await balance(user.id)).toBe(90);
      expect(await owned(token, 'blue-seaglass')).toBe(1);
      expect(await pullsLogged(user.id, 'vending')).toBe(1);
      // pull_state untouched: no free go claimed, no rest started
      expect(await pullCount(user.id, 'vending')).toBe(0);
      const after = (await (await req('/pulls', {}, token)).json()) as { pools: { id: string; free: boolean }[] };
      expect(after.pools.find((p) => p.id === 'vending')?.free).toBe(true);
      // and the free ball still works afterwards
      const f = await free('vending', token);
      expect(f.status).toBe(200);
      expect(await owned(token, 'blue-seaglass')).toBe(2);
      expect(await pullCount(user.id, 'vending')).toBe(1);
    } finally {
      forcedRand = null;
    }
  });

  it('a paid ball can win the one-of-a-kind item', async () => {
    const { token, user } = await signIn('paid-unique');
    await fund(user.id, 100);
    // 0.01: under the 3% unique line, first (only) unique item
    forcedRand = () => 0.01;
    try {
      const r = await paid('vending', token);
      expect(r.status).toBe(200);
      expect(((await r.json()) as { item: string; rarity: string }).item).toBe('nautilus');
      expect(await owned(token, 'nautilus')).toBe(1);
      expect(await balance(user.id)).toBe(90);
    } finally {
      forcedRand = null;
    }
  });

  it('a paid go on the claw deducts and grants like a free go', async () => {
    const { token, user } = await signIn('paid-claw-win');
    await fund(user.id, 100);
    // 0.5: a common ball (second common item), held on (0.5 < 0.8)
    forcedRand = () => 0.5;
    try {
      const r = await paid('daily', token);
      expect(r.status).toBe(200);
      expect(((await r.json()) as { missed: boolean; item: string; rarity: string; bucks: number }).item).toBe('sanddollar');
      expect(await balance(user.id)).toBe(90);
      expect(await owned(token, 'sanddollar')).toBe(1);
      expect(await pullsLogged(user.id, 'daily')).toBe(1);
      expect(await pullCount(user.id, 'daily')).toBe(0);
    } finally {
      forcedRand = null;
    }
  });

  it('a paid go the claw drops still spends the go — and wins nothing', async () => {
    const { token, user } = await signIn('paid-claw-miss');
    await fund(user.id, 100);
    // draw a common ball, then roll 0.9 to drop it (0.9 >= the 0.8 hold)
    const seq = [0.5, 0.5, 0.9];
    forcedRand = () => seq.shift() ?? 0.5;
    try {
      const r = await paid('daily', token);
      expect(r.status).toBe(200);
      const body = (await r.json()) as { missed: boolean; item: string | null; dropped: { item: string; rarity: string }; bucks: number };
      expect(body).toMatchObject({ missed: true, item: null, dropped: { item: 'sanddollar', rarity: 'common' }, bucks: 90 });
      expect(await balance(user.id)).toBe(90);
      expect(await owned(token, 'sanddollar')).toBe(0);
      expect(await pullsLogged(user.id, 'daily')).toBe(0);
    } finally {
      forcedRand = null;
    }
  });

  it('a paid go never takes a starter gift', async () => {
    const { token, user } = await signIn('paid-starter');
    await fund(user.id, 100);
    forcedRand = () => 0.5;
    try {
      // a paid go first: a normal draw, not the first-go gift
      const p = await paid('daily', token);
      expect(p.status).toBe(200);
      expect(((await p.json()) as { item: string }).item).toBe('sanddollar');
      // the first free go is still the rare gift, the second still the deckchair
      const g1 = await free('daily', token);
      expect(g1.status).toBe(200);
      expect(((await g1.json()) as { item: string }).item).toBe('starfish');
      skew += 3 * 60 * 60 * 1000 + 60 * 1000; // past the longest rest
      const g2 = await free('daily', token);
      expect(g2.status).toBe(200);
      expect(((await g2.json()) as { item: string }).item).toBe('deckchair');
      expect(await pullCount(user.id, 'daily')).toBe(2);
    } finally {
      forcedRand = null;
      skew = 0;
    }
  });

  it('two paid balls deduct twice and grant twice — one try, one ball', async () => {
    const { token, user } = await signIn('paid-twice');
    await fund(user.id, 100);
    forcedRand = () => 0.5;
    try {
      expect((await paid('vending', token)).status).toBe(200);
      expect((await paid('vending', token)).status).toBe(200);
      expect(await balance(user.id)).toBe(80);
      expect(await owned(token, 'blue-seaglass')).toBe(2);
      expect(await pullsLogged(user.id, 'vending')).toBe(2);
    } finally {
      forcedRand = null;
    }
  });
});
