// Inland beach sections, against specs/tla/InlandSections.tla
// (docs/INLAND_SECTIONS.md, docs/STATE_MACHINES.md). Fast: the real server
// in-process, no rendering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rng, startServer, type Server } from './harness.js';
import { ROWS, SectionsModel } from './sectionsModel.js';

let s: Server;
beforeAll(async () => {
  s = await startServer();
});
afterAll(() => s.close());

interface Player {
  token: string;
  id: string;
  edit: string;
  beaches: string[];
  codes: string[];
}
let n = 0;
async function player(count: number): Promise<Player> {
  n++;
  const u = await s.signIn(`Sections ${n}`);
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

const BW = 'section-boardwalk';
const SAND = 'section-sand';
const hdr = (p: Player, edit = p.edit) => ({ 'X-Edit-Token': edit, 'Content-Type': 'application/json' });
const write = (p: Player, b: number, rows: string[], rev: number, edit?: string) =>
  s.req(`/beaches/mine/${p.beaches[b]}/sections`, { method: 'PUT', body: JSON.stringify({ rows, rev }), headers: hdr(p, edit) }, p.token);
const del = (p: Player, b: number) => s.req(`/beaches/mine/${p.beaches[b]}`, { method: 'DELETE', headers: hdr(p) }, p.token);
const tradeIn = (p: Player, item: string) => s.post('/bag/trade-in', p.token, { item });
const link = (p: Player, l: number, r: number) =>
  s.req(`/neighbors/right?beach=${p.beaches[l]}`, { method: 'PUT', body: JSON.stringify({ code: p.codes[r] }), headers: { 'Content-Type': 'application/json' } }, p.token);

interface Mine {
  beaches: { id: string; sections: string[]; sectionsRev: number }[];
  sections: { owned: Record<string, number>; placed: Record<string, number> };
}
const mine = async (p: Player): Promise<Mine> => {
  const r = await s.req('/beaches/mine', {}, p.token);
  expect(r.status).toBe(200);
  return (await r.json()) as Mine;
};
const layoutOf = async (p: Player, b: number) => (await mine(p)).beaches.find((x) => x.id === p.beaches[b])!;

describe('inland sections: transitions (InlandSections.tla)', () => {
  it('append, reorder, replace and return to the bag, each from the latest revision', async () => {
    const p = await player(1);
    await s.grant(p.token, BW);
    await s.grant(p.token, SAND);
    expect(await layoutOf(p, 0)).toMatchObject({ sections: [], sectionsRev: 0 });
    expect((await write(p, 0, [BW], 0)).status).toBe(200);
    const two = await write(p, 0, [BW, SAND], 1);
    expect(two.status).toBe(200);
    expect(await two.json()).toMatchObject({ rows: [BW, SAND], rev: 2, sections: { owned: { [BW]: 1, [SAND]: 1 }, placed: { [BW]: 1, [SAND]: 1 } } });
    expect((await write(p, 0, [SAND, BW], 2)).status).toBe(200); // reorder
    expect((await write(p, 0, [SAND], 3)).status).toBe(200); // return the boardwalk
    expect(await layoutOf(p, 0)).toMatchObject({ sections: [SAND], sectionsRev: 4 });
    expect((await mine(p)).sections.placed).toEqual({ [SAND]: 1 });
  });

  it('refuses a stale revision, a fifth row, an unknown type and what you do not own', async () => {
    const p = await player(1);
    await s.grant(p.token, BW, 5);
    expect((await write(p, 0, [BW], 1)).status).toBe(409); // stale (it's 0)
    expect((await write(p, 0, [BW, BW, BW, BW, BW], 0)).status).toBe(409);
    expect((await write(p, 0, ['rock'], 0)).status).toBe(400);
    expect((await write(p, 0, [SAND], 0)).status).toBe(409);
    expect((await write(p, 0, [BW, BW, BW, BW], 0)).status).toBe(200); // four of one type, all owned
    expect(await layoutOf(p, 0)).toMatchObject({ sections: [BW, BW, BW, BW], sectionsRev: 1 });
  });

  it('needs the edit token', async () => {
    const p = await player(1);
    await s.grant(p.token, BW);
    expect((await write(p, 0, [BW], 0, 'stale')).status).toBe(409);
    expect((await layoutOf(p, 0)).sections).toEqual([]);
  });

  it('counts every beach: one copy goes on one beach at a time', async () => {
    const p = await player(2);
    await s.grant(p.token, BW);
    expect((await write(p, 0, [BW], 0)).status).toBe(200);
    expect((await write(p, 1, [BW], 0)).status).toBe(409);
    expect((await write(p, 0, [], 1)).status).toBe(200);
    expect((await write(p, 1, [BW], 0)).status).toBe(200); // the stored copy, reused on another beach
  });

  it('a placed section can be neither traded in nor given away; the bag shows it placed', async () => {
    const p = await player(1);
    const friend = await player(1);
    await s.grant(p.token, BW);
    expect((await write(p, 0, [BW], 0)).status).toBe(200);
    expect((await tradeIn(p, BW)).status).toBe(409);
    expect((await s.post('/gifts', p.token, { code: friend.codes[0], item: BW })).status).toBe(409);
    const bag = (await (await s.req('/bag', {}, p.token)).json()) as { items: { item: string; owned: number; placed: number; free: number }[] };
    expect(bag.items.find((i) => i.item === BW)).toMatchObject({ owned: 1, placed: 1, free: 0 });
    expect((await write(p, 0, [], 1)).status).toBe(200);
    expect((await tradeIn(p, BW)).status).toBe(200);
  });

  it('deleting a beach puts its sections back in the bag', async () => {
    const p = await player(2);
    await s.grant(p.token, BW);
    expect((await write(p, 1, [BW], 0)).status).toBe(200);
    expect((await del(p, 1)).status).toBe(204);
    expect((await mine(p)).sections).toEqual({ owned: { [BW]: 1 }, placed: {} });
    expect((await write(p, 0, [BW], 0)).status).toBe(200);
  });

  it('everyone sees the rows on the shore, front first', async () => {
    const p = await player(2);
    await s.grant(p.token, BW);
    await s.grant(p.token, SAND);
    expect((await link(p, 0, 1)).status).toBe(200);
    expect((await write(p, 1, [SAND, BW], 0)).status).toBe(200);
    const r = await s.req(`/shore?code=${p.codes[0]}&depth=1`, {}, p.token);
    const shore = (await r.json()) as { center: { sections?: string[] }; right: { sections?: string[] }[]; left: { sections?: string[] }[] };
    expect(shore.center.sections).toBeUndefined();
    expect([...shore.left, ...shore.right].map((b) => b.sections)).toContainEqual([SAND, BW]);
    await s.db.query("UPDATE beach SET sand = '\\x00'::bytea WHERE id = $1", [p.beaches[1]]);
    const pub = await s.req(`/public/shore?code=${p.codes[1]}&depth=0`);
    expect(((await pub.json()) as { center: { sections?: string[] } }).center.sections).toEqual([SAND, BW]);
  });
});

describe('inland sections: replays of what TLC found in the other form', () => {
  it('NoLostUpdate: two devices write from the same revision, the second is refused', async () => {
    const p = await player(1);
    await s.grant(p.token, BW);
    await s.grant(p.token, SAND);
    const g = s.gate.pauseBefore(/^\s*$/, { orTransaction: true });
    const first = write(p, 0, [BW], 0);
    await g.reached;
    expect((await write(p, 0, [SAND], 0)).status).toBe(200);
    g.release();
    expect((await first).status).toBe(409);
    expect(await layoutOf(p, 0)).toMatchObject({ sections: [SAND], sectionsRev: 1 });
  });

  it('PaidPlacement: the one copy placed on two beaches at once lands on one', async () => {
    const p = await player(2);
    await s.grant(p.token, BW);
    const g = s.gate.pauseBefore(/^\s*$/, { orTransaction: true });
    const first = write(p, 0, [BW], 0);
    await g.reached;
    expect((await write(p, 1, [BW], 0)).status).toBe(200);
    g.release();
    expect((await first).status).toBe(409);
    expect((await mine(p)).sections.placed).toEqual({ [BW]: 1 });
  });

  it('PaidPlacement: a trade-in racing a placement of the only copy leaves one or the other', async () => {
    const p = await player(1);
    await s.grant(p.token, BW);
    const g = s.gate.pauseBefore(/^\s*$/, { orTransaction: true });
    const trading = tradeIn(p, BW);
    await g.reached;
    expect((await write(p, 0, [BW], 0)).status).toBe(200);
    g.release();
    expect((await trading).status).toBe(409);
    expect((await mine(p)).sections).toEqual({ owned: { [BW]: 1 }, placed: { [BW]: 1 } });
  });
});

describe('inland sections: a random walk against the model', () => {
  const TYPES = [BW, SAND, 'section-road'];
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}`, async () => {
      const r = rng(seed);
      const COUNT = 3;
      const p = await player(COUNT);
      const m = new SectionsModel(COUNT);
      for (let step = 0; step < 70; step++) {
        const a = r.int(10);
        const b = r.pick([...m.beaches]);
        const t = r.pick(TYPES);
        let want: number;
        let got: number;
        let what: string;
        if (a <= 1) {
          if ((m.owned.get(t) ?? 0) >= 3) continue;
          what = `buy ${t}`;
          want = m.buy(t);
          await s.grant(p.token, t);
          got = 200;
        } else if (a === 2) {
          what = `trade-in ${t}`;
          want = m.tradeIn(t);
          got = (await tradeIn(p, t)).status;
        } else if (a === 3) {
          if (r.int(4) !== 0) continue;
          what = `delete ${b}`;
          want = m.deleteBeach(b);
          got = (await del(p, b)).status;
        } else {
          // a layout made from what the device last saw; sometimes stale, sometimes too long
          const cur = m.layout.get(b)!;
          const rows = [...cur];
          const k = r.int(4);
          if (k === 0 || rows.length === 0) rows.push(t);
          else if (k === 1) rows.splice(r.int(rows.length), 1);
          else if (k === 2) rows.reverse();
          else rows[r.int(rows.length)] = t;
          if (r.int(8) === 0) while (rows.length <= ROWS) rows.push(t);
          const rev = m.rev.get(b)! - (r.int(6) === 0 ? 1 : 0);
          what = `write ${b} [${rows.join(' ')}] @${rev}`;
          want = m.write(b, rows, rev);
          got = (await write(p, b, rows, rev)).status;
        }
        expect(got, `step ${step}: ${what}`).toBe(want);
        const now = await mine(p);
        for (const i of m.beaches) {
          const x = now.beaches.find((y) => y.id === p.beaches[i])!;
          expect({ rows: x.sections, rev: x.sectionsRev }, `step ${step}: ${what}, beach ${i}`).toEqual({ rows: m.layout.get(i), rev: m.rev.get(i) });
        }
        const placed = Object.fromEntries(TYPES.map((y) => [y, m.placed(y)]).filter(([, v]) => v));
        expect(now.sections.placed, `step ${step}: ${what}`).toEqual(placed);
        expect(m.check()).toEqual([]);
      }
    });
  }
});
