// Piers, against specs/tla/Piers.tla (docs/PIERS.md, docs/STATE_MACHINES.md).
// Fast: the real server in-process, no rendering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rng, startServer, type Server } from './harness.js';
import { PiersModel } from './piersModel.js';

let s: Server;
beforeAll(async () => {
  s = await startServer();
});
afterAll(() => s.close());

interface Player {
  token: string;
  id: string;
  edit: string;
  /** beach ids by index (0 = home) */
  beaches: string[];
  codes: string[];
}
let n = 0;
/** A player with `count` beaches (home + extras), none linked. */
async function player(count: number): Promise<Player> {
  n++;
  const u = await s.signIn(`Pier ${n}`);
  const edit = await s.claim(u.token);
  if (count > 1) await s.grant(u.token, 'beach', count - 1);
  const beaches = [u.id];
  for (let i = 1; i < count; i++) {
    const r = await s.post('/beaches/mine', u.token, { name: `b${i}` }, { 'X-Edit-Token': edit });
    expect(r.status).toBe(200);
    beaches.push(((await r.json()) as { beach: { id: string } }).beach.id);
  }
  const codes: string[] = [];
  for (const b of beaches) codes.push((await s.db.query<{ code: string }>('SELECT code FROM beach WHERE id = $1', [b]))[0].code);
  return { ...u, edit, beaches, codes };
}

const hdr = (p: Player) => ({ 'X-Edit-Token': p.edit });
const link = (p: Player, l: number, r: number, to: Player = p) =>
  s.req(`/neighbors/right?beach=${p.beaches[l]}`, { method: 'PUT', body: JSON.stringify({ code: to.codes[r] }), headers: { 'Content-Type': 'application/json' } }, p.token);
const unlink = (p: Player, l: number) => s.req(`/neighbors/right?beach=${p.beaches[l]}`, { method: 'DELETE' }, p.token);
const del = (p: Player, b: number) => s.req(`/beaches/mine/${p.beaches[b]}`, { method: 'DELETE', headers: hdr(p) }, p.token);
const land = (p: Player, b: number) => s.req(`/beaches/mine/${p.beaches[b]}/pier`, { method: 'PUT', headers: hdr(p) }, p.token);
const lift = (p: Player, b: number) => s.req(`/beaches/mine/${p.beaches[b]}/pier`, { method: 'DELETE', headers: hdr(p) }, p.token);
const tradeIn = (p: Player) => s.post('/bag/trade-in', p.token, { item: 'pier' });

interface Mine {
  beaches: { id: string; pier: 'active' | 'paused' | null; pierSite: boolean }[];
  piers: { owned: number; placed: number };
}
const mine = async (p: Player): Promise<Mine> => {
  const r = await s.req('/beaches/mine', {}, p.token);
  expect(r.status).toBe(200);
  return (await r.json()) as Mine;
};
const pierOf = async (p: Player, b: number) => (await mine(p)).beaches.find((x) => x.id === p.beaches[b])?.pier ?? null;
/** what everyone sees: the `pier` flag on the beach in the shore data */
const shown = async (p: Player, b: number) => {
  const r = await s.req(`/shore?code=${p.codes[b]}&depth=1`, {}, p.token);
  expect(r.status).toBe(200);
  const shore = (await r.json()) as { center: { pier?: boolean } | null };
  return shore.center?.pier === true;
};

/** A player with three beaches linked 0-1-2 and one pier in the bag. */
async function trio(): Promise<Player> {
  const p = await player(3);
  expect((await link(p, 0, 1)).status).toBe(200);
  expect((await link(p, 1, 2)).status).toBe(200);
  await s.grant(p.token, 'pier');
  return p;
}

describe('piers: transitions (Piers.tla)', () => {
  it('a lone beach and a pair have no pier site', async () => {
    const one = await player(1);
    await s.grant(one.token, 'pier');
    expect((await land(one, 0)).status).toBe(409);
    const two = await player(2);
    await s.grant(two.token, 'pier');
    expect((await link(two, 0, 1)).status).toBe(200);
    expect((await land(two, 0)).status).toBe(409);
    expect((await land(two, 1)).status).toBe(409);
    expect((await mine(two)).beaches.every((b) => !b.pierSite)).toBe(true);
  });

  it('the middle of an owned trio takes a pier, and everyone sees it', async () => {
    const p = await trio();
    expect((await mine(p)).beaches.map((b) => b.pierSite)).toEqual([false, true, false]);
    expect((await land(p, 0)).status).toBe(409); // an end isn't a site
    expect((await land(p, 1)).status).toBe(200);
    expect(await pierOf(p, 1)).toBe('active');
    expect((await mine(p)).piers).toEqual({ owned: 1, placed: 1 });
    expect(await shown(p, 1)).toBe(true);
    // signed out too, once the beach is public (on the shore and saved)
    await s.db.query("UPDATE beach SET sand = '\\x00'::bytea WHERE id = $1", [p.beaches[1]]);
    const pub = await s.req(`/public/shore?code=${p.codes[1]}&depth=0`);
    expect(pub.status).toBe(200);
    expect(((await pub.json()) as { center: { pier?: boolean } }).center.pier).toBe(true);
  });

  it('a trio with someone else in it is not a site', async () => {
    const p = await player(2);
    const other = await player(1);
    await s.grant(p.token, 'pier');
    expect((await link(p, 0, 1)).status).toBe(200);
    // the other player asks to be on the right of p's beach 1, and p accepts
    const ask = await s.req(
      `/neighbors/left?beach=${other.beaches[0]}`,
      { method: 'PUT', body: JSON.stringify({ code: p.codes[1] }), headers: { 'Content-Type': 'application/json' } },
      other.token,
    );
    expect(ask.status).toBe(200);
    expect((await s.post(`/neighbors/requests/${other.codes[0]}/accept?beach=${p.beaches[1]}`, p.token)).status).toBe(200);
    expect((await land(p, 1)).status).toBe(409);
  });

  it('two sites on a longer stretch each take one, a second pier on one is refused', async () => {
    const p = await player(4);
    for (const [l, r] of [[0, 1], [1, 2], [2, 3]]) expect((await link(p, l, r)).status).toBe(200);
    expect((await land(p, 1)).status).toBe(409); // no pier yet
    await s.grant(p.token, 'pier', 2);
    expect((await land(p, 1)).status).toBe(200);
    expect((await land(p, 1)).status).toBe(409); // one per beach
    expect((await land(p, 2)).status).toBe(200);
    expect((await mine(p)).piers).toEqual({ owned: 2, placed: 2 });
  });

  it('an unlink pauses it, a relink brings it back, lifting returns it to the bag', async () => {
    const p = await trio();
    expect((await land(p, 1)).status).toBe(200);
    expect((await unlink(p, 1)).status).toBe(204);
    expect(await pierOf(p, 1)).toBe('paused');
    expect(await shown(p, 1)).toBe(false);
    expect((await link(p, 1, 2)).status).toBe(200);
    expect(await pierOf(p, 1)).toBe('active');
    expect(await shown(p, 1)).toBe(true);
    expect((await lift(p, 1)).status).toBe(200);
    expect((await lift(p, 1)).status).toBe(404);
    expect((await mine(p)).piers).toEqual({ owned: 1, placed: 0 });
  });

  it('deleting an outer beach pauses it; deleting the middle returns it to the bag', async () => {
    const p = await player(4);
    for (const [l, r] of [[1, 2], [2, 3]]) expect((await link(p, l, r)).status).toBe(200);
    await s.grant(p.token, 'pier');
    expect((await land(p, 2)).status).toBe(200);
    expect((await del(p, 3)).status).toBe(204);
    expect(await pierOf(p, 2)).toBe('paused');
    expect((await mine(p)).piers).toEqual({ owned: 1, placed: 1 });
    // a different beach of theirs fills the missing side: it shows again
    expect((await link(p, 2, 0)).status).toBe(200);
    expect(await pierOf(p, 2)).toBe('active');
    expect((await del(p, 2)).status).toBe(204);
    expect((await mine(p)).piers).toEqual({ owned: 1, placed: 0 });
  });

  it('a placed pier can be neither traded in nor given away (PaidAttachment)', async () => {
    const p = await trio();
    const friend = await player(1);
    expect((await land(p, 1)).status).toBe(200);
    expect((await tradeIn(p)).status).toBe(409);
    expect((await s.post('/gifts', p.token, { code: friend.codes[0], item: 'pier' })).status).toBe(409);
    expect((await lift(p, 1)).status).toBe(200);
    expect((await tradeIn(p)).status).toBe(200);
    expect((await mine(p)).piers).toEqual({ owned: 0, placed: 0 });
  });

  it('placing needs the edit token', async () => {
    const p = await trio();
    const r = await s.req(`/beaches/mine/${p.beaches[1]}/pier`, { method: 'PUT', headers: { 'X-Edit-Token': 'stale' } }, p.token);
    expect(r.status).toBe(409);
    expect(await pierOf(p, 1)).toBeNull();
  });

  it('the bag lists placed piers as placed', async () => {
    const p = await trio();
    expect((await land(p, 1)).status).toBe(200);
    const bag = (await (await s.req('/bag', {}, p.token)).json()) as { items: { item: string; owned: number; placed: number; free: number }[] };
    expect(bag.items.find((i) => i.item === 'pier')).toMatchObject({ owned: 1, placed: 1, free: 0 });
  });
});

describe('piers: replays of what TLC found in the other form', () => {
  it('PlacementWasEligible: an unlink between the check and the insert leaves nothing placed', async () => {
    const p = await trio();
    // stop the placement just before its transaction, after the route's own reads
    const g = s.gate.pauseBefore(/^\s*$/, { orTransaction: true });
    const placing = land(p, 1);
    await g.reached;
    expect((await unlink(p, 1)).status).toBe(204);
    g.release();
    expect((await placing).status).toBe(409);
    expect(await pierOf(p, 1)).toBeNull();
  });

  it('PaidAttachment: a placement and a trade-in of the only pier at once leave one or the other', async () => {
    const p = await trio();
    const g = s.gate.pauseBefore(/^\s*$/, { orTransaction: true });
    const trading = tradeIn(p);
    await g.reached;
    expect((await land(p, 1)).status).toBe(200);
    g.release();
    expect((await trading).status).toBe(409);
    expect((await mine(p)).piers).toEqual({ owned: 1, placed: 1 });
  });
});

describe('piers: a random walk against the model', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}`, async () => {
      const r = rng(seed);
      const COUNT = 4;
      const p = await player(COUNT);
      const m = new PiersModel(COUNT);
      const live = () => [...m.beaches];
      for (let step = 0; step < 70; step++) {
        const a = r.int(9);
        const b = r.pick(live());
        let want: number;
        let got: number;
        let what: string;
        if (a <= 1) {
          const c = r.pick(live());
          what = `link ${b}>${c}`;
          want = m.link(b, c);
          got = (await link(p, b, c)).status;
        } else if (a === 2) {
          what = `unlink ${b}`;
          want = m.unlink(b);
          got = (await unlink(p, b)).status;
        } else if (a === 3) {
          if (r.int(4) !== 0) continue; // deletions are rarer: they use up the beaches
          what = `delete ${b}`;
          want = m.deleteBeach(b);
          got = (await del(p, b)).status;
        } else if (a === 4) {
          if (m.owned >= 3) continue;
          what = 'buy';
          want = m.buy();
          await s.grant(p.token, 'pier');
          got = 200;
        } else if (a === 5) {
          what = 'trade-in';
          want = m.tradeIn();
          got = (await tradeIn(p)).status;
        } else if (a <= 7) {
          what = `land ${b}`;
          want = m.land(b);
          got = (await land(p, b)).status;
        } else {
          what = `lift ${b}`;
          want = m.lift(b);
          got = (await lift(p, b)).status;
        }
        expect(got, `step ${step}: ${what}`).toBe(want);
        // the database matches the model, and the invariants hold
        const rows = await s.db.query<{ beach_id: string }>('SELECT beach_id FROM beach_piers WHERE owner_id = $1', [p.id]);
        expect(new Set(rows.map((x) => p.beaches.indexOf(x.beach_id))), `step ${step}: ${what}`).toEqual(m.site);
        const now = await mine(p);
        expect(now.piers, `step ${step}: ${what}`).toEqual({ owned: m.owned, placed: m.attached });
        for (const i of m.beaches) expect(now.beaches.find((x) => x.id === p.beaches[i])?.pier ?? null, `step ${step}: ${what}, beach ${i}`).toBe(m.pier(i));
        expect(m.check()).toEqual([]);
      }
    });
  }
});
