// The claw and vending machines, against specs/tla/Claw.tla
// (docs/STATE_MACHINES.md). Fast: the real server in-process, no rendering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLAW_EXTRA_GO_BUCKS } from '../../src/paidPulls.js';
import { STARTER } from '../../src/pulls.js';
import { currentSet } from '../../src/vending.js';
import { ClawModel, type Machine, type Prize } from './clawModel.js';
import { rng, startServer, T0, type Server } from './harness.js';

const DAY = 24 * 3600 * 1000;
const UNIQUE = currentSet(T0)!.items.unique[0];

/** the server's randomness, swapped per test: 0.5 = a common the claw holds on to */
let rand: () => number = () => 0.5;
let s: Server;
beforeAll(async () => {
  s = await startServer({ rand: () => rand() });
});
afterAll(() => s.close());

let n = 0;
async function person(bucks = 0) {
  n++;
  const u = await s.signIn(`Claw ${n}`);
  await s.db.query('UPDATE users SET credit_cents = $2 WHERE id = $1', [u.id, bucks * 10]);
  return u;
}
async function pull(token: string, m: Machine, paid = false): Promise<Prize> {
  const r = await s.post(`/pulls/${m}${paid ? '/paid' : ''}`, token);
  const j = (await r.json()) as { item?: string | null; rarity?: string | null };
  return { status: r.status, item: j.item ?? null, rarity: j.rarity ?? null };
}
const pulled = async (id: string) =>
  new Map(
    (
      await s.db.query<{ item_id: string; n: string }>(
        "SELECT item_id, SUM(quantity) AS n FROM inventory WHERE user_id = $1 AND source = 'pull' GROUP BY item_id",
        [id],
      )
    ).map((r) => [r.item_id, Number(r.n)]),
  );
const bucks = async (id: string) =>
  Number((await s.db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [id]))[0].credit_cents) / 10;
const uniqueOwner = async () =>
  (await s.db.query<{ owner_id: string | null }>('SELECT owner_id FROM unique_items WHERE item_id = $1', [UNIQUE]))[0]?.owner_id ?? null;
/** free the unique item again between tests */
const resetUnique = () => s.db.query('DELETE FROM unique_items WHERE item_id = $1', [UNIQUE]);
/** two requests, the first paused just before `re` while the second runs */
async function interleave<T>(re: RegExp, first: () => Promise<T>, second: () => Promise<T>, between?: () => void) {
  const g = s.gate.pauseBefore(re);
  const a = first();
  await g.reached;
  const b = await second();
  between?.();
  g.release();
  return [await a, b] as const;
}

describe('claw: transitions', () => {
  it('FreeClaim: two devices at once take one free go (the Claw.cfg OneGoPerRest trace)', async () => {
    rand = () => 0.5;
    const u = await person();
    const [a, b] = await interleave(/WITH claim AS/, () => pull(u.token, 'daily'), () => pull(u.token, 'daily'));
    expect([a.status, b.status]).toEqual([409, 200]);
    expect(b.item).toBe(STARTER.rare.item);
    expect(await pulled(u.id)).toEqual(new Map([[STARTER.rare.item, 1]]));
  });

  it('FreeClaim: a go drawn before another device took it and the rest ran out claims nothing (the StarterOnce trace)', async () => {
    rand = () => 0.5;
    const u = await person();
    // device 1 draws the first starter gift, then waits; device 2 takes go 1;
    // the rest runs out; device 1's claim still sees the count it drew for
    const [a, b] = await interleave(
      /WITH claim AS/,
      () => pull(u.token, 'daily'),
      () => pull(u.token, 'daily'),
      () => (s.clock.now += DAY),
    );
    expect(b).toMatchObject({ status: 200, item: STARTER.rare.item });
    expect(a.status).toBe(409);
    expect(await pulled(u.id)).toEqual(new Map([[STARTER.rare.item, 1]]));
    // the next go is the second gift, not the first again
    expect(await pull(u.token, 'daily')).toMatchObject({ status: 200, item: STARTER.paid.item });
  });

  it('PaidClaim: two paid tries at once on enough bucks for one charge once (the PaidInFull trace)', async () => {
    rand = () => 0.5;
    const u = await person(CLAW_EXTRA_GO_BUCKS);
    const [a, b] = await interleave(/WITH paid AS/, () => pull(u.token, 'daily', true), () => pull(u.token, 'daily', true));
    expect([a.status, b.status]).toEqual([402, 200]);
    expect(await bucks(u.id)).toBe(0);
    expect([...(await pulled(u.id)).values()].reduce((x, y) => x + y, 0)).toBe(1);
  });

  it('a free ball and a paid one in the same millisecond both land (migration 46: pulls have their own id)', async () => {
    rand = () => 0.5;
    const u = await person(CLAW_EXTRA_GO_BUCKS);
    const got = await Promise.all([pull(u.token, 'vending'), pull(u.token, 'vending', true)]);
    expect(got.map((g) => g.status)).toEqual([200, 200]);
    expect([...(await pulled(u.id)).values()].reduce((x, y) => x + y, 0)).toBe(2);
  });

  it('Release: a unique claimed for a go that then lost is let go, not stranded (NoStrandedUnique)', async () => {
    await resetUnique();
    rand = () => 0; // the unique, then its first item
    const u = await person();
    // device 1 claims the unique and pauses before the go; device 2 draws it
    // too, finds it taken (a rare instead) and takes the go
    const [a, b] = await interleave(/WITH claim AS/, () => pull(u.token, 'vending'), () => pull(u.token, 'vending'));
    expect(b).toMatchObject({ status: 200, rarity: 'rare' });
    expect(a.status).toBe(409);
    expect(await uniqueOwner()).toBeNull();
    expect((await pulled(u.id)).get(UNIQUE)).toBeUndefined();
  });

  it('ClaimUnique: two players drawing the unique at once: one gets it, the other a rare (UniqueOnce)', async () => {
    await resetUnique();
    rand = () => 0;
    const [u, v] = [await person(), await person()];
    const got = await Promise.all([pull(u.token, 'vending'), pull(v.token, 'vending')]);
    expect(got.map((g) => g.status)).toEqual([200, 200]);
    expect(got.map((g) => g.rarity).sort()).toEqual(['rare', 'unique']);
    const winner = got[0].rarity === 'unique' ? u : v;
    expect(await uniqueOwner()).toBe(winner.id);
    expect((await pulled(winner.id)).get(UNIQUE)).toBe(1);
    await resetUnique();
  });
});

describe('claw: random walks, server vs model', () => {
  for (const seed of [61, 62, 63, 64, 65, 66]) {
    it(`seed ${seed}: free and paid goes on both machines (some at once) agree with the model`, async () => {
      await resetUnique();
      const r = rng(seed);
      // the server's own draws come from a seeded stream too, mostly normal,
      // with the unique and the claw's drops turning up now and then
      const draws = rng(seed * 7);
      rand = draws.next;
      const start = 3 * CLAW_EXTRA_GO_BUCKS;
      const m = new ClawModel(CLAW_EXTRA_GO_BUCKS, start, UNIQUE);
      const people = [await person(start), await person(start)];
      for (const p of people) m.add(p.id);
      const trace: string[] = [];
      for (let step = 0; step < 30; step++) {
        if (r.next() < 0.15) {
          s.clock.now += DAY;
          m.tick();
          trace.push('tick');
          continue;
        }
        const who = r.pick(people);
        const one = () => ({ m: r.pick(['daily', 'vending'] as const), paid: r.next() < 0.35 });
        const batch = [one(), ...(r.next() < 0.4 ? [one()] : [])];
        const now = s.clock.now;
        const got = await Promise.all(batch.map((b) => pull(who.token, b.m, b.paid)));
        trace.push(`${who.id.slice(0, 4)} ${batch.map((b, i) => `${b.paid ? 'paid' : 'free'}:${b.m}=${got[i].status}:${got[i].item}`).join(' ')}`);
        // in a race the model takes them in the order the server granted
        // them: winners first, so a 409/402 loser is checked against the go it lost to
        const order = batch.map((b, i) => ({ b, g: got[i] })).sort((x, y) => (x.g.status === 200 ? 0 : 1) - (y.g.status === 200 ? 0 : 1));
        const bad = order.flatMap(({ b, g }) => (b.paid ? m.paid(who.id, b.m, g) : m.free(who.id, b.m, now, g)));
        expect([...bad, ...m.check()], trace.join('\n')).toEqual([]);
        expect(await bucks(who.id)).toBe(m.players.get(who.id)!.bucks);
        expect(await pulled(who.id)).toEqual(m.players.get(who.id)!.bag);
        expect(await uniqueOwner(), trace.join('\n')).toBe(m.owner.get(UNIQUE) ?? null);
      }
    });
  }
});
