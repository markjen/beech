// Buried finds, against specs/tla/DigFinds.tla (docs/STATE_MACHINES.md).
// Fast: the real server in-process, no rendering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DIG_FIND_DAILY_CAP, DIG_FIND_ROLL_COOLDOWN_MS } from '../../src/digFinds.js';
import { DigFindsModel } from './digFindsModel.js';
import { rng, startServer, type Server } from './harness.js';

const COOL = DIG_FIND_ROLL_COOLDOWN_MS;
/** 0.05: a find (under the 10% chance), and a rare from the set; 0.5: a miss */
const FIND = 0.05;
const MISS = 0.5;
let rand: () => number = () => MISS;
let s: Server;
beforeAll(async () => {
  s = await startServer({ rand: () => rand() });
});
afterAll(() => s.close());

let n = 0;
async function digger() {
  n++;
  const u = await s.signIn(`Digger ${n}`);
  const edit = await s.claim(u.token);
  return { ...u, edit };
}
type Who = Awaited<ReturnType<typeof digger>>;
async function dig(w: Who): Promise<{ status: number; found: boolean }> {
  const r = await s.post('/dig-finds', w.token, { pathM: 3, durationMs: 2000 }, { 'X-Edit-Token': w.edit });
  const j = (await r.json()) as { found?: boolean };
  return { status: r.status, found: !!j.found };
}
const findsBy = async (id: string) =>
  (await s.db.query<{ day: string; n: string }>("SELECT day, COUNT(*) AS n FROM pulls WHERE user_id = $1 AND pool = 'dig' GROUP BY day", [id])).reduce(
    (m, r) => m.set(r.day, Number(r.n)),
    new Map<string, number>(),
  );
async function interleave<T>(first: () => Promise<T>, second: () => Promise<T>, between?: () => void) {
  const g = s.gate.pauseBefore(/WITH s AS|INSERT INTO dig_state/);
  const a = first();
  await g.reached;
  between?.();
  const b = await second();
  g.release();
  return [await a, b] as const;
}

describe('dig finds: transitions', () => {
  it('Write: two devices digging at once with one find left get one (the DigFinds.cfg CapHolds trace)', async () => {
    rand = () => FIND;
    const w = await digger();
    for (let i = 0; i < DIG_FIND_DAILY_CAP - 1; i++) {
      expect(await dig(w)).toEqual({ status: 200, found: true });
      s.clock.now += COOL;
    }
    const [a, b] = await interleave(() => dig(w), () => dig(w));
    expect([a.status, b.status]).toEqual([409, 200]);
    expect([...(await findsBy(w.id)).values()]).toEqual([DIG_FIND_DAILY_CAP]);
    s.clock.now += COOL;
    expect((await dig(w)).status).toBe(409); // that's all for today
  });

  it('Write: two misses at once record one roll (the OneRollPerCooldown trace)', async () => {
    rand = () => MISS;
    const w = await digger();
    const [a, b] = await interleave(() => dig(w), () => dig(w));
    expect([a.status, b.status]).toEqual([409, 200]);
    rand = () => FIND;
    expect((await dig(w)).status).toBe(409); // still cooling down
  });

  it('Write: a roll that started before midnight and lands after another device rolled the new day claims nothing', async () => {
    rand = () => FIND;
    const w = await digger();
    const midnight = Date.UTC(2026, 10, 26);
    s.clock.now = midnight - 5_000;
    const [a, b] = await interleave(
      () => dig(w),
      () => dig(w),
      () => (s.clock.now = midnight + COOL),
    );
    expect([a.status, b.status]).toEqual([409, 200]);
    expect(await findsBy(w.id)).toEqual(new Map([['2026-11-26', 1]]));
  });
});

describe('dig finds: random walks, server vs model', () => {
  for (const seed of [71, 72, 73, 74, 75, 76]) {
    it(`seed ${seed}: digs (some at once) and the clock agree with the model`, async () => {
      const r = rng(seed);
      const draws = rng(seed * 11);
      // finds come up often enough to reach the cap
      rand = () => (draws.next() < 0.5 ? FIND : MISS);
      const w = await digger();
      const m = new DigFindsModel(DIG_FIND_DAILY_CAP, COOL);
      const trace: string[] = [];
      for (let step = 0; step < 40; step++) {
        const x = r.next();
        if (x < 0.35) {
          const dt = r.pick([10_000, COOL, 2 * COOL, 6 * 3600_000]);
          s.clock.now += dt;
          trace.push(`+${dt}`);
          continue;
        }
        const now = s.clock.now;
        const got = await Promise.all(Array.from({ length: x < 0.75 ? 1 : 2 }, () => dig(w)));
        trace.push(got.map((g) => `${g.status}${g.found ? '*' : ''}`).join(' '));
        // winners first, then the loser must be one the model refuses
        for (const g of [...got].sort((p, q) => (p.status === 200 ? 0 : 1) - (q.status === 200 ? 0 : 1))) {
          if (g.status === 200) {
            expect(m.refusedEarly(now), trace.join('\n')).toBe(false);
            m.dig(now, g.found);
          } else {
            expect(g.status, trace.join('\n')).toBe(409);
            expect(m.refusedEarly(now), trace.join('\n')).toBe(true);
          }
        }
        expect(m.check(), trace.join('\n')).toEqual([]);
        expect(await findsBy(w.id), trace.join('\n')).toEqual(m.granted);
      }
    });
  }
});
