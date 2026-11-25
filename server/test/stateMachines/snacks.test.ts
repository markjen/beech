// Beach snacks and pets against specs/tla/Snacks.tla (docs/STATE_MACHINES.md).
// Fast: the real server in-process on PGlite, no rendering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BEFRIEND_FEED_THRESHOLD, PET_CRAB_ITEM_ID, SNACK_OUT_MS, TREAT_ITEM_ID, countTreats } from '../../src/animals.js';
import { rng, startServer, type Server } from './harness.js';
import { SnacksModel, type Player } from './snacksModel.js';

let s: Server;
beforeAll(async () => {
  s = await startServer();
});
afterAll(() => s.close());

interface Players {
  owner: { token: string; id: string };
  visitor: { token: string; id: string };
  beach: string;
  code: string;
}

let n = 0;
async function players(): Promise<Players> {
  n++;
  const owner = await s.signIn(`Owner ${n}`);
  const visitor = await s.signIn(`Visitor ${n}`);
  // visitors can only reach beaches on the shore
  const [b] = await s.db.query<{ code: string }>('UPDATE beach SET on_shore = true WHERE id = $1 RETURNING code', [owner.id]);
  return { owner, visitor, beach: owner.id, code: b.code };
}

const toss = (p: Players) => s.post('/animals/feed', p.owner.token, { beachId: p.beach });
const pickUp = (p: Players) => s.post('/animals/feed/return', p.owner.token, { beachId: p.beach });
const adopt = (p: Players, mode: 'befriend' | 'shop') => s.post('/pet/adopt', p.owner.token, { beachId: p.beach, mode, name: 'Pinch' });
const visit = (p: Players, useFood = false) => s.post(`/beaches/${p.code}/pet/feed`, p.visitor.token, { useFood });

async function observe(p: Players) {
  const now = s.clock.now;
  const [prog] = await s.db.query<{ feed_count: number }>('SELECT feed_count FROM wild_feed_progress WHERE beach_id = $1', [p.beach]);
  const [pet] = await s.db.query<{ source: string; fed_count: number; last_fed_at: string }>(
    'SELECT source, fed_count, last_fed_at FROM beach_pets WHERE beach_id = $1',
    [p.beach],
  );
  const [snack] = await s.db.query<{ tossed_at: string }>('SELECT tossed_at FROM beach_snacks WHERE beach_id = $1', [p.beach]);
  const [items] = await s.db.query<{ n: string | null }>(
    "SELECT COALESCE(SUM(quantity), 0) AS n FROM inventory WHERE user_id = $1 AND item_id = $2 AND quantity > 0",
    [p.owner.id, PET_CRAB_ITEM_ID],
  );
  return {
    owner: await countTreats(s.db, p.owner.id, now),
    visitor: await countTreats(s.db, p.visitor.id, now),
    petItem: Number(items?.n ?? 0),
    progress: Number(prog?.feed_count ?? 0),
    pet: pet ? { src: pet.source, fed: Number(pet.fed_count), last: Number(pet.last_fed_at) } : null,
    returnable: !!snack && Number(snack.tossed_at) > now - SNACK_OUT_MS,
  };
}

const modelView = (m: SnacksModel, now: number) => ({
  owner: m.bag.owner,
  visitor: m.bag.visitor,
  petItem: m.petItem,
  progress: m.pet ? m.progress : m.progress,
  pet: m.pet ? { src: m.pet.src, fed: m.pet.fed, last: m.pet.last } : null,
  returnable: m.returnable(now),
});

/** Advance the clock a second, so every feed gets its own time (as in the spec's `t`). */
const tick = (ms = 1000) => {
  s.clock.now += ms;
};

describe('snacks: one transition at a time', () => {
  it('Toss on a beach with no pet counts toward befriending; PickUp takes it back', async () => {
    const p = await players();
    await s.grant(p.owner.token, TREAT_ITEM_ID, 2);
    tick();
    expect((await toss(p)).status).toBe(200);
    expect(await observe(p)).toMatchObject({ owner: 1, progress: 1, returnable: true, pet: null });
    tick();
    expect((await pickUp(p)).status).toBe(200);
    expect(await observe(p)).toMatchObject({ owner: 2, progress: 0, returnable: false });
    expect((await pickUp(p)).status).toBe(409); // nothing out
  });

  it('a second Toss replaces the first (eaten): only the last comes back', async () => {
    const p = await players();
    await s.grant(p.owner.token, TREAT_ITEM_ID, 2);
    tick();
    await toss(p);
    tick();
    await toss(p);
    expect(await observe(p)).toMatchObject({ owner: 0, progress: 2 });
    tick();
    expect((await pickUp(p)).status).toBe(200);
    expect(await observe(p)).toMatchObject({ owner: 1, progress: 1 });
  });

  it('Eaten: after SNACK_OUT_MS a snack can no longer be picked up', async () => {
    const p = await players();
    await s.grant(p.owner.token, TREAT_ITEM_ID, 1);
    tick();
    await toss(p);
    tick(SNACK_OUT_MS);
    expect((await pickUp(p)).status).toBe(409);
    expect(await observe(p)).toMatchObject({ owner: 0, progress: 1, returnable: false });
  });

  it('AdoptBefriend needs Threshold feeds, and the crab eats the snack that is out', async () => {
    const p = await players();
    await s.grant(p.owner.token, TREAT_ITEM_ID, BEFRIEND_FEED_THRESHOLD);
    for (let i = 0; i < BEFRIEND_FEED_THRESHOLD - 1; i++) {
      tick();
      await toss(p);
    }
    expect((await adopt(p, 'befriend')).status).toBe(409);
    tick();
    await toss(p);
    tick();
    expect((await adopt(p, 'befriend')).status).toBe(200);
    expect(await observe(p)).toMatchObject({ progress: 0, returnable: false, pet: { src: 'befriended', fed: 1 } });
    expect((await pickUp(p)).status).toBe(409);
    expect((await adopt(p, 'befriend')).status).toBe(409); // one pet per beach
  });

  it('AdoptShop spends the pet crab; a Toss on the pet feeds it and PickUp undoes the feed', async () => {
    const p = await players();
    await s.grant(p.owner.token, PET_CRAB_ITEM_ID, 1);
    await s.grant(p.owner.token, TREAT_ITEM_ID, 1);
    tick();
    expect((await adopt(p, 'shop')).status).toBe(200);
    const adopted = (await observe(p)).pet!;
    expect(await observe(p)).toMatchObject({ petItem: 0, pet: { src: 'shop', fed: 1 } });
    tick();
    await toss(p);
    expect((await observe(p)).pet).toMatchObject({ fed: 2, last: s.clock.now });
    tick();
    await pickUp(p);
    expect((await observe(p)).pet).toEqual(adopted);
  });

  it('Visit: one free feed a day, then the visitor\'s own snacks', async () => {
    const p = await players();
    await s.grant(p.owner.token, PET_CRAB_ITEM_ID, 1);
    await adopt(p, 'shop');
    tick();
    expect((await visit(p)).status).toBe(200);
    tick();
    expect((await visit(p)).status).toBe(409); // free one used, no snacks
    await s.grant(p.visitor.token, TREAT_ITEM_ID, 1);
    tick();
    expect((await visit(p, true)).status).toBe(200);
    expect(await observe(p)).toMatchObject({ visitor: 0, pet: { fed: 3 } });
  });
});

describe('snacks: TLC counterexamples, replayed against the server', () => {
  // Snacks.cfg, BefriendedFairly: Toss x Threshold, AdoptCheck, PickUp, AdoptInsert.
  it('a snack picked up while an adopt is in flight never leaves a crab befriended for less', async () => {
    const p = await players();
    await s.grant(p.owner.token, TREAT_ITEM_ID, BEFRIEND_FEED_THRESHOLD);
    for (let i = 0; i < BEFRIEND_FEED_THRESHOLD; i++) {
      tick();
      await toss(p);
    }
    tick();
    const gate = s.gate.pauseBefore(/INSERT INTO beach_pets/);
    const adopting = adopt(p, 'befriend');
    await Promise.race([gate.reached, adopting]); // AdoptCheck done (or the adopt is atomic)
    const picked = await pickUp(p); // PickUp in the gap
    gate.release();
    const adopted = await adopting; // AdoptInsert
    // both can't succeed: either the snack came back (and the crab isn't
    // befriended), or the crab moved in (and ate it)
    expect([adopted.status, picked.status].sort()).toEqual([200, 409]);
    const o = await observe(p);
    if (adopted.status === 200) expect(o).toMatchObject({ owner: 0, pet: { src: 'befriended' } });
    else expect(o).toMatchObject({ owner: 1, progress: BEFRIEND_FEED_THRESHOLD - 1, pet: null });
  });

  // Snacks.cfg, OneFreeFeedADay: VisitCheck(r1), VisitCheck(r2), VisitFeed(r1), VisitFeed(r2).
  it('two feed requests from one visitor at once get one free feed between them', async () => {
    const p = await players();
    await s.grant(p.owner.token, PET_CRAB_ITEM_ID, 1);
    await adopt(p, 'shop');
    tick();
    const gate = s.gate.pauseBefore(/UPDATE beach_pets\s+SET last_fed_at/);
    const first = visit(p);
    await Promise.race([gate.reached, first]);
    const second = await visit(p);
    gate.release();
    const statuses = [(await first).status, second.status].sort();
    expect(statuses).toEqual([200, 409]); // no snacks in the bag: the second has nothing to pay with
    expect((await observe(p)).pet).toMatchObject({ fed: 2 });
  });
});

describe('snacks: random walks, server vs model', () => {
  type Action = 'toss' | 'pickUp' | 'eaten' | 'befriend' | 'shop' | 'visit' | 'visitFood' | 'grantOwner' | 'grantVisitor';
  const actions: Action[] = ['toss', 'toss', 'toss', 'pickUp', 'eaten', 'befriend', 'shop', 'visit', 'visitFood', 'grantOwner', 'grantVisitor'];

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}: 40 steps agree with the model and keep its invariants`, async () => {
      const r = rng(seed);
      const p = await players();
      const m = new SnacksModel();
      await s.grant(p.owner.token, TREAT_ITEM_ID, 6);
      m.grant('owner', 6);
      await s.grant(p.owner.token, PET_CRAB_ITEM_ID, 1);
      m.petItem = 1;
      const trace: string[] = [];
      for (let step = 0; step < 40; step++) {
        tick();
        const a = r.pick(actions);
        trace.push(a);
        const now = s.clock.now;
        let got = 200;
        let want = 200;
        if (a === 'toss') [got, want] = [(await toss(p)).status, m.toss(now)];
        else if (a === 'pickUp') [got, want] = [(await pickUp(p)).status, m.pickUp(now)];
        else if (a === 'eaten') tick(SNACK_OUT_MS);
        else if (a === 'befriend') [got, want] = [(await adopt(p, 'befriend')).status, m.adoptBefriend(now)];
        else if (a === 'shop') [got, want] = [(await adopt(p, 'shop')).status, m.adoptShop(now)];
        else if (a === 'visit' || a === 'visitFood') [got, want] = [(await visit(p, a === 'visitFood')).status, m.visit(now, a === 'visitFood')];
        else {
          const who: Player = a === 'grantOwner' ? 'owner' : 'visitor';
          await s.grant(who === 'owner' ? p.owner.token : p.visitor.token, TREAT_ITEM_ID, 1);
          m.grant(who, 1);
        }
        expect(got, `seed ${seed} step ${step} ${a}: ${trace.join(' ')}`).toBe(want);
        expect(await observe(p), `seed ${seed} step ${step} ${a}: ${trace.join(' ')}`).toEqual(modelView(m, s.clock.now));
        expect(m.invariants(s.clock.now)).toEqual([]);
      }
    });
  }
});
