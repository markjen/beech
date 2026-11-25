// Neighbor links against specs/tla/Neighbors.tla (docs/STATE_MACHINES.md).
// Fast: the real server in-process, no rendering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rng, startServer, type Server } from './harness.js';
import { NeighborsModel, linkInvariants, type Side } from './neighborsModel.js';

let s: Server;
beforeAll(async () => {
  s = await startServer();
});
afterAll(() => s.close());

interface Beach { name: string; token: string; id: string; code: string }

let n = 0;
async function beaches(count: number): Promise<Beach[]> {
  const out: Beach[] = [];
  for (let i = 0; i < count; i++) {
    n++;
    const u = await s.signIn(`Shore ${n}`);
    const [b] = await s.db.query<{ code: string }>('SELECT code FROM beach WHERE id = $1', [u.id]);
    out.push({ name: 'ABCDEFGH'[i], token: u.token, id: u.id, code: b.code });
  }
  return out;
}

const ask = (a: Beach, side: Side, b: Beach) =>
  s.req(`/neighbors/${side}`, { method: 'PUT', body: JSON.stringify({ code: b.code }), headers: { 'Content-Type': 'application/json' } }, a.token);
const accept = (b: Beach, a: Beach) => s.post(`/neighbors/requests/${a.code}/accept`, b.token);
const decline = (b: Beach, a: Beach) => s.req(`/neighbors/requests/${a.code}`, { method: 'DELETE' }, b.token);
const moveAway = (a: Beach, side: Side) => s.req(`/neighbors/${side}`, { method: 'DELETE' }, a.token);

/** The two tables, as the model's "a|side|b" sets (beach ids). */
async function tables(bs: Beach[]) {
  const ids = bs.map((b) => b.id);
  const links = await s.db.query<{ beach_id: string; side: Side; neighbor_beach_id: string }>(
    'SELECT beach_id, side, neighbor_beach_id FROM neighbors WHERE beach_id = ANY($1::uuid[])',
    [ids],
  );
  const reqs = await s.db.query<{ from_beach: string; side: Side; to_beach: string }>(
    'SELECT from_beach, side, to_beach FROM neighbor_requests WHERE from_beach = ANY($1::uuid[])',
    [ids],
  );
  return {
    links: new Set(links.map((r) => `${r.beach_id}|${r.side}|${r.neighbor_beach_id}`)),
    reqs: new Set(reqs.map((r) => `${r.from_beach}|${r.side}|${r.to_beach}`)),
  };
}
const sorted = (x: Set<string>) => [...x].sort();

describe('neighbors: one transition at a time', () => {
  it('Ask, then Accept: the link is mutual and the request is gone', async () => {
    const [a, b] = await beaches(2);
    expect((await ask(a, 'left', b)).status).toBe(200);
    expect((await accept(b, a)).status).toBe(200);
    const t = await tables([a, b]);
    expect(sorted(t.links)).toEqual(sorted(new Set([`${a.id}|left|${b.id}`, `${b.id}|right|${a.id}`])));
    expect(t.reqs.size).toBe(0);
  });

  it('crossing asks link at once', async () => {
    const [a, b] = await beaches(2);
    await ask(a, 'left', b);
    const r = await ask(b, 'right', a);
    expect(await r.json()).toMatchObject({ status: 'linked' });
    expect(linkInvariants((await tables([a, b])).links)).toEqual([]);
  });

  it('Decline drops the request; MoveAway drops both rows of the link', async () => {
    const [a, b] = await beaches(2);
    await ask(a, 'left', b);
    expect((await decline(b, a)).status).toBe(204);
    expect((await accept(b, a)).status).toBe(404);
    await ask(a, 'left', b);
    await accept(b, a);
    expect((await moveAway(b, 'right')).status).toBe(204);
    expect((await tables([a, b])).links.size).toBe(0);
  });

  it('a side holds one neighbor', async () => {
    const [a, b, c] = await beaches(3);
    await ask(a, 'left', b);
    await accept(b, a);
    expect((await ask(a, 'left', c)).status).toBe(409);
    expect((await ask(c, 'left', b)).status).toBe(409); // b's right side is a
  });
});

describe('neighbors: TLC counterexample, replayed against the server', () => {
  // Neighbors.cfg, LinkedOnce: Ask(B,left,A), AcceptCheck(A,B), Ask(A,left,B), Ask(B,right,A), AcceptLink(A,B).
  it('an accept and a crossing ask never leave two beaches neighbors on both sides', async () => {
    const [a, b] = await beaches(2);
    expect((await ask(b, 'left', a)).status).toBe(200); // B asks A onto its left
    const gate = s.gate.pauseBefore(/INSERT INTO neighbors/, { orTransaction: true });
    const accepting = accept(a, b); // A accepts: its right side is free (AcceptCheck)
    await Promise.race([gate.reached, accepting]);
    await ask(a, 'left', b); // A asks B onto its left
    await ask(b, 'right', a); // B asks A onto its right: crossing, links at once
    gate.release();
    await accepting; // AcceptLink
    const t = await tables([a, b]);
    expect(linkInvariants(t.links)).toEqual([]);
    expect(t.links.size).toBe(2);
  });
});

describe('neighbors: random walks, server vs model', () => {
  type Action = 'ask' | 'accept' | 'decline' | 'moveAway';
  const actions: Action[] = ['ask', 'ask', 'ask', 'accept', 'accept', 'decline', 'moveAway'];

  for (const seed of [21, 22, 23, 24, 25, 26]) {
    it(`seed ${seed}: 40 steps agree with the model and keep its invariants`, async () => {
      const r = rng(seed);
      const bs = await beaches(3);
      let m = new NeighborsModel();
      const trace: string[] = [];
      for (let step = 0; step < 40; step++) {
        const a = r.pick(bs);
        const b = r.pick(bs.filter((x) => x !== a));
        const side: Side = r.pick(['left', 'right'] as const);
        const act = r.pick(actions);
        trace.push(act === 'moveAway' ? `${act}(${a.name},${side})` : act === 'ask' ? `ask(${a.name},${side},${b.name})` : `${act}(${b.name}<-${a.name})`);
        const where = `seed ${seed} step ${step}: ${trace.join(' ')}`;
        if (act === 'ask') {
          expect((await ask(a, side, b)).status, where).toBe(m.ask(a.id, side, b.id));
        } else if (act === 'accept') {
          const got = (await accept(b, a)).status;
          const t = await tables(bs);
          const match = m.acceptOutcomes(b.id, a.id).find(
            (o) => o.status === got && sorted(o.next.links).join() === sorted(t.links).join() && sorted(o.next.reqs).join() === sorted(t.reqs).join(),
          );
          expect(match, `${where}: the server's answer (${got}) isn't one the model allows`).toBeDefined();
          m = match!.next;
        } else if (act === 'decline') {
          expect((await decline(b, a)).status, where).toBe(204);
          m.decline(b.id, a.id);
        } else {
          expect((await moveAway(a, side)).status, where).toBe(204);
          m.moveAway(a.id, side);
        }
        const t = await tables(bs);
        expect(sorted(t.links), where).toEqual(sorted(m.links));
        expect(sorted(t.reqs), where).toEqual(sorted(m.reqs));
        expect(linkInvariants(t.links), where).toEqual([]);
      }
    });
  }
});
