import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgDb, createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { VENDING_SETS } from '../src/vending.js';
import { DIG_FIND_CHANCE, DIG_FIND_DAILY_CAP, DIG_FIND_ROLL_COOLDOWN_MS, digDraw } from '../src/digFinds.js';

let db: Db;
/** the server's clock in these tests: real time plus however far a test moved it on */
let skew = 0;
/** the server's dice in these tests: a test can force them, then put them back */
let forcedRand: (() => number) | null = null;
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
/** one edit token per bearer token: claim once, reuse (a new claim would fence the old one) */
const editTokens = new Map<string, string>();
const editToken = async (t: string) => {
  const hit = editTokens.get(t);
  if (hit) return hit;
  const r = await req('/edit-session', { method: 'POST' }, t);
  expect(r.status).toBe(200);
  const { token } = (await r.json()) as { token: string };
  editTokens.set(t, token);
  return token;
};
/** a request from the current editor (saves, restores, the beach roster, dig rolls) */
const reqE = async (path: string, init: RequestInit = {}, token?: string) => {
  const headers = { ...(init.headers as Record<string, string>), ...(token ? { 'X-Edit-Token': await editToken(token) } : {}) };
  return req(path, { ...init, headers }, token);
};
/** a real dig: the brush travelled 3 m over 2 s */
const dig = (token: string) => reqE('/dig-finds', json('POST', { pathM: 3, durationMs: 2000 }), token);

describe('digging finds', () => {
  it('sign-in required, and the body is checked', async () => {
    expect((await req('/dig-finds', json('POST', { pathM: 3, durationMs: 2000 }))).status).toBe(401);
    const { token } = await signIn('digger-auth');
    expect((await req('/dig-finds', json('POST', {}), token)).status).toBe(400);
    expect((await req('/dig-finds', json('POST', { pathM: -1, durationMs: 2000 }), token)).status).toBe(400);
  });

  it('a tap is not a dig', async () => {
    const { token } = await signIn('digger-tap');
    const r = await req('/dig-finds', json('POST', { pathM: 0.1, durationMs: 100 }), token);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/dig a little more/);
  });

  it('a miss spends the roll but grants nothing', async () => {
    const { token, user } = await signIn('digger-miss');
    forcedRand = () => 0.5; // 0.5 >= the 1-in-10 chance: nothing buried
    try {
      const r = await dig(token);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ found: false });
      expect(await owned(token, 'pink-shell')).toBe(0);
      const st = await db.query<{ last_roll_at: string }>('SELECT last_roll_at FROM dig_state WHERE user_id = $1', [user.id]);
      expect(Number(st[0].last_roll_at)).toBeGreaterThan(0);
    } finally {
      forcedRand = null;
    }
  });

  it('a roll too soon after the last one waits', async () => {
    const { token } = await signIn('digger-soon');
    forcedRand = () => 0.5;
    try {
      expect((await dig(token)).status).toBe(200);
      const r = await dig(token);
      expect(r.status).toBe(409);
      expect(((await r.json()) as { error: string }).error).toMatch(/slow down/);
    } finally {
      forcedRand = null;
    }
  });

  it('a hit draws from this week’s set and lands in the bag', async () => {
    const { token, user } = await signIn('digger-hit');
    // chance 0.05 < 0.1: found. Draw 0.05: rare (0.03–0.15), first rare item.
    forcedRand = () => 0.05;
    try {
      const r = await dig(token);
      expect(r.status).toBe(200);
      const body = (await r.json()) as { found: boolean; item: string; rarity: string; findsToday: number; findsLeft: number };
      expect(body).toMatchObject({ found: true, item: 'sunset-starfish', rarity: 'rare', findsToday: 1, findsLeft: DIG_FIND_DAILY_CAP - 1 });
      expect(await owned(token, 'sunset-starfish')).toBe(1);
      const logged = await db.query<{ pool: string; item_id: string }>('SELECT pool, item_id FROM pulls WHERE user_id = $1', [user.id]);
      expect(logged).toEqual([{ pool: 'dig', item_id: 'sunset-starfish' }]);
      // the bag's "found" list
      const list = (await (await req('/dig-finds', {}, token)).json()) as { finds: { item: string; rarity: string; at: number }[] };
      expect(list.finds.map((f) => [f.item, f.rarity])).toEqual([['sunset-starfish', 'rare']]);
    } finally {
      forcedRand = null;
    }
  });

  it('a tiny chance roll can dig up the unique', async () => {
    const { token } = await signIn('digger-unique');
    forcedRand = () => 0.005; // chance 0.005 < 0.1; draw 0.005 < 0.03: unique
    try {
      const r = await dig(token);
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ found: true, item: 'nautilus', rarity: 'unique' });
      expect(await owned(token, 'nautilus')).toBe(1);
    } finally {
      forcedRand = null;
    }
  });

  it('three finds a day, then the beach is done until tomorrow', async () => {
    const { token } = await signIn('digger-cap');
    forcedRand = () => 0.05; // always a hit
    // start at noon UTC, so stepping past the cooldowns never crosses midnight
    // (the test used to fail when it ran just before 00:00 UTC)
    const real = Date.now();
    skew = Math.floor(real / 86400000) * 86400000 + 12 * 3600000 - real;
    try {
      for (let i = 1; i <= DIG_FIND_DAILY_CAP; i++) {
        const r = await dig(token);
        expect(r.status).toBe(200);
        expect((await r.json()) as { findsToday: number }).toMatchObject({ findsToday: i });
        skew += DIG_FIND_ROLL_COOLDOWN_MS + 1000; // past the cooldown, same day
      }
      const done = await dig(token);
      expect(done.status).toBe(409);
      expect(((await done.json()) as { error: string }).error).toMatch(/all the buried treasure for today/);
      expect(await owned(token, 'sunset-starfish')).toBe(DIG_FIND_DAILY_CAP);
      // tomorrow the count starts over
      skew += 24 * 60 * 60 * 1000;
      const next = await dig(token);
      expect(next.status).toBe(200);
      expect((await next.json()) as { findsToday: number }).toMatchObject({ findsToday: 1 });
    } finally {
      forcedRand = null;
      skew = 0;
    }
  });

  it('two rolls at once still grant only one find', async () => {
    const { token } = await signIn('digger-race');
    forcedRand = () => 0.05; // both roll a hit
    try {
      const [a, b] = await Promise.all([dig(token), dig(token)]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
      expect(await owned(token, 'sunset-starfish')).toBe(1);
    } finally {
      forcedRand = null;
    }
  });
});

describe('digDraw', () => {
  it('finds about one dig in ten, at the vending odds', () => {
    const n = 20000;
    const count: Record<string, number> = { common: 0, uncommon: 0, rare: 0, unique: 0 };
    let found = 0;
    let seed = 4242;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const s = VENDING_SETS[0];
    for (let i = 0; i < n; i++) {
      const d = digDraw(s, rand);
      if (d.found) {
        found++;
        count[d.rarity!]++;
      }
    }
    expect(found / n).toBeCloseTo(DIG_FIND_CHANCE, 1);
    for (const k of Object.keys(count)) expect(count[k] / found).toBeCloseTo(s.odds[k as keyof typeof s.odds], 1);
  });
});
