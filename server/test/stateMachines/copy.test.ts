// Copying a beach, against specs/tla/BeachCopy.tla (docs/COPY_BEACH.md,
// docs/STATE_MACHINES.md). Fast: the real server in-process, no rendering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { beachBytes, rng, startServer, type Server } from './harness.js';
import { CopyModel, type CopyAnswer, type Mode } from './copyModel.js';

let s: Server;
beforeAll(async () => {
  s = await startServer();
});
afterAll(() => s.close());

const ITEM = 'lighthouse';

interface Who {
  token: string;
  id: string;
  edit: string;
}
let n = 0;
async function person(label: string): Promise<Who> {
  n++;
  const u = await s.signIn(`${label} ${n}`);
  return { ...u, edit: await s.claim(u.token) };
}

const saveRaw = (w: Who, beach: string, count: number) =>
  s.req(
    `/beaches/mine/${beach}/sand`,
    {
      method: 'PUT',
      body: beachBytes(count ? { [ITEM]: count, rock: 2 } : { rock: 2 }),
      headers: {
        'X-Beach-Location': 'bondi',
        'X-Beach-Nx': '16',
        'X-Beach-Ny': '16',
        'X-Beach-Max': '2000',
        // the epoch it last saw: a copy bumps it, so ask the server each time (one device here)
        'X-Beach-Epoch': String(epochs.get(beach) ?? 0),
        'X-Edit-Token': w.edit,
      },
    },
    w.token,
  );
const epochs = new Map<string, number>();
async function save(w: Who, beach: string, count: number) {
  const rows = await s.db.query<{ epoch: number }>('SELECT epoch FROM beach WHERE id = $1', [beach]);
  epochs.set(beach, Number(rows[0]?.epoch ?? 0));
  return saveRaw(w, beach, count);
}

/** An owner with a public beach holding `items` lighthouses (granted). */
async function source(items: number) {
  const o = await person('Owner');
  if (items) await s.grant(o.token, ITEM, items);
  expect((await save(o, o.id, items)).status).toBe(200);
  const code = (await s.db.query<{ code: string }>('SELECT code FROM beach WHERE id = $1', [o.id]))[0].code;
  return { ...o, code };
}
const version = async (beach: string) => Number((await s.db.query<{ version: number }>('SELECT version FROM beach WHERE id = $1', [beach]))[0].version);
const hide = (beach: string, pub: boolean) => s.db.query('UPDATE beach SET on_shore = $1 WHERE id = $2', [pub, beach]);

const copy = (w: Who, from: string, ver: number, target: string, mode: Mode = 'strict') =>
  s.post('/beaches/mine/copy', w.token, { from, version: ver, target, mode }, { 'X-Edit-Token': w.edit });
const fit = async (w: Who, from: string, target = 'new') => {
  const r = await s.req(`/beaches/${from}/copy-fit?target=${target}`, {}, w.token);
  expect(r.status).toBe(200);
  return (await r.json()) as {
    version: number;
    short: { item: string; need: number; have: number }[];
    room: boolean;
    basket: { lines: { product: string; quantity: number; item: string; cents: number }[]; cents: number; notForSale: { item: string }[] };
  };
};

async function answer(r: Response): Promise<CopyAnswer> {
  if (r.status === 404) return { status: 404, why: 'gone' };
  if (r.status !== 409) return { status: r.status };
  const why = ((await r.clone().json()) as { error: string }).error;
  return { status: 409, why: why as CopyAnswer['why'] };
}

async function held(w: Who) {
  const rows = await s.db.query<{ id: string; items: Record<string, number> | string | null }>('SELECT id, items FROM beach WHERE owner_id = $1', [w.id]);
  const out = new Map<string, number>();
  for (const r of rows) {
    const items = typeof r.items === 'string' ? JSON.parse(r.items) : (r.items ?? {});
    out.set(r.id, Number(items[ITEM] ?? 0));
  }
  return out;
}
const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe('copy: one transition at a time', () => {
  it('copies a public beach onto a new one: sand and things, a name, and where it came from', async () => {
    const src = await source(1);
    const me = await person('Copier');
    await s.grant(me.token, ITEM);
    await s.grant(me.token, 'beach');
    const f = await fit(me, src.code);
    expect(f.short).toEqual([]);
    expect(f.room).toBe(true);
    const r = await copy(me, src.code, f.version, 'new');
    expect(r.status).toBe(200);
    const body = (await r.json()) as { beach: string; code: string; dropped: number };
    expect(body.dropped).toBe(0);
    const [row] = await s.db.query<{ name: string; copied_from: string; copied_version: number; items: unknown }>(
      'SELECT name, copied_from, copied_version, items FROM beach WHERE id = $1',
      [body.beach],
    );
    expect(row.copied_from).toBe(src.id);
    expect(Number(row.copied_version)).toBe(f.version);
    expect((await held(me)).get(body.beach)).toBe(1);
  });

  it('strict refuses when short and writes nothing (not even the new beach); drop-missing copies the rest', async () => {
    const src = await source(2);
    const me = await person('Copier');
    await s.grant(me.token, ITEM); // owns 1 of the 2
    await s.grant(me.token, 'beach');
    const f = await fit(me, src.code);
    expect(f.short).toEqual([{ item: ITEM, need: 2, have: 1 }]);
    expect(f.basket.lines).toEqual([{ product: 'item_lighthouse', quantity: 1, item: ITEM, cents: 299 }]);
    expect(await answer(await copy(me, src.code, f.version, 'new'))).toEqual({ status: 409, why: 'short' });
    expect((await held(me)).size).toBe(1);
    const r = await copy(me, src.code, f.version, 'new', 'drop-missing');
    expect(r.status).toBe(200);
    expect(((await r.json()) as { dropped: number }).dropped).toBe(1);
    expect(total(await held(me))).toBe(1);
  });

  it('onto an existing beach: its things do not count against you, and Undo is its "Before copying" checkpoint', async () => {
    const src = await source(1);
    const me = await person('Copier');
    await s.grant(me.token, ITEM);
    expect((await save(me, me.id, 1)).status).toBe(200);
    const f = await fit(me, src.code, me.id);
    expect(f.short).toEqual([]);
    const r = await copy(me, src.code, f.version, me.id);
    expect(r.status).toBe(200);
    const { undo } = (await r.json()) as { undo: string };
    const [cp] = await s.db.query<{ name: string; kind: string }>('SELECT name, kind FROM checkpoints WHERE id = $1', [undo]);
    expect(cp.kind).toBe('auto');
    expect(cp.name).toMatch(/^Before copying/);
  });

  it('refuses a changed version, a beach off the shore, and a new beach past the allowance', async () => {
    const src = await source(0);
    const me = await person('Copier');
    const v = await version(src.id);
    expect((await save(src, src.id, 0)).status).toBe(200);
    expect(await answer(await copy(me, src.code, v, 'new'))).toEqual({ status: 409, why: 'changed' });
    await hide(src.id, false);
    expect(await answer(await copy(me, src.code, v + 1, me.id))).toEqual({ status: 404, why: 'gone' });
    await hide(src.id, true);
    // allowance 1: only the home beach, so no new one
    expect(await answer(await copy(me, src.code, v + 1, 'new'))).toEqual({ status: 409, why: 'room' });
    expect((await fit(me, src.code)).basket.lines.map((l) => l.product)).toEqual(['beach_1']);
    expect(await answer(await copy(me, src.code, v + 1, me.id))).toEqual({ status: 200 });
  });

  it('you can duplicate your own beach even off the shore, and that is not counted as a copy', async () => {
    const me = await source(0);
    await s.grant(me.token, 'beach');
    await hide(me.id, false);
    const r = await copy(me, me.code, await version(me.id), 'new');
    expect(r.status).toBe(200);
    expect(await s.db.query('SELECT 1 FROM beach_copies WHERE source_beach = $1', [me.id])).toHaveLength(0);
  });

  it('counts each person once and tells the owner the first time', async () => {
    const src = await source(0);
    const me = await person('Copier');
    for (let i = 0; i < 2; i++) expect((await copy(me, src.code, await version(src.id), me.id)).status).toBe(200);
    expect(await s.db.query('SELECT 1 FROM beach_copies WHERE source_beach = $1', [src.id])).toHaveLength(1);
    const inbox = await s.db.query<{ kind: string; actor_id: string }>("SELECT kind, actor_id FROM inbox WHERE user_id = $1 AND kind = 'copied'", [src.id]);
    expect(inbox).toEqual([{ kind: 'copied', actor_id: me.id }]);
  });

  it('keep as a checkpoint: no bag needed', async () => {
    const src = await source(2);
    const me = await person('Copier');
    const r = await s.post('/checkpoints/copy', me.token, { from: src.code, version: await version(src.id) });
    expect(r.status).toBe(201);
    const { checkpoint } = (await r.json()) as { checkpoint: { source: string; items: Record<string, number> } };
    expect(checkpoint.source).toBe('copy');
    expect(checkpoint.items[ITEM]).toBe(2);
  });
});

describe('copy: TLC counterexamples, replayed against the server', () => {
  // BeachCopy.cfg, WithinBag: CopyStart, CopyRead, CopyCheck, Save(home, 1), CopyWrite.
  it('a save landing while a copy is on its way cannot put the one thing owned on two beaches', async () => {
    const src = await source(1);
    const me = await person('Copier');
    await s.grant(me.token, ITEM);
    await s.grant(me.token, 'beach');
    const v = (await fit(me, src.code)).version; // the preview: fits
    const gate = s.gate.pauseBefore(/^$/, { orTransaction: true });
    const copying = copy(me, src.code, v, 'new');
    await Promise.race([gate.reached, copying]);
    expect((await save(me, me.id, 1)).status).toBe(200); // Save in the gap
    gate.release();
    expect(await answer(await copying)).toEqual({ status: 409, why: 'short' });
    expect(total(await held(me))).toBe(1);
  });

  // BeachCopy.cfg, WithinAllowance: two copies to "a new beach" both pass the check, then both insert.
  it('two copies to a new beach at once make one beach', async () => {
    const src = await source(0);
    const me = await person('Copier');
    await s.grant(me.token, 'beach'); // allowance 2: room for one more
    const v = await version(src.id);
    const gate = s.gate.pauseBefore(/^$/, { orTransaction: true });
    const first = copy(me, src.code, v, 'new');
    await Promise.race([gate.reached, first]);
    const second = copy(me, src.code, v, 'new');
    gate.release();
    const answers = await Promise.all([first, second].map(async (p) => answer(await p)));
    expect(answers.filter((a) => a.status === 200)).toHaveLength(1);
    expect(answers.find((a) => a.status !== 200)).toEqual({ status: 409, why: 'room' });
    expect((await held(me)).size).toBe(2);
  });

  // BeachCopy.cfg, NoCopyOffShore: CopyStart, CopyRead, SourceShore, CopyCheck, CopyWrite.
  it('a beach taken off the shore while a copy is on its way is not copied', async () => {
    const src = await source(0);
    const me = await person('Copier');
    const v = await version(src.id);
    const gate = s.gate.pauseBefore(/^$/, { orTransaction: true });
    const copying = copy(me, src.code, v, me.id);
    await Promise.race([gate.reached, copying]);
    await hide(src.id, false); // SourceShore in the gap
    gate.release();
    expect(await answer(await copying)).toEqual({ status: 404, why: 'gone' });
    const [row] = await s.db.query<{ copied_from: string | null }>('SELECT copied_from FROM beach WHERE id = $1', [me.id]);
    expect(row.copied_from).toBeNull();
  });
});

describe('copy: random walks, server vs model', () => {
  type Action = 'save' | 'copy' | 'edit' | 'shore' | 'buy';
  const actions: Action[] = ['save', 'save', 'copy', 'copy', 'copy', 'edit', 'shore', 'buy'];

  for (const seed of [21, 22, 23, 24, 25, 26]) {
    it(`seed ${seed}: 30 steps agree with the model and keep its invariants`, async () => {
      const r = rng(seed);
      const src = await source(0);
      await s.grant(src.token, ITEM, 2); // the owner can put up to 2 on the source
      const me = await person('Copier');
      await s.grant(me.token, 'beach');
      const m = new CopyModel(me.id, 2);
      m.sver = await version(src.id);
      const trace: string[] = [];
      for (let step = 0; step < 30; step++) {
        s.clock.now += 1000;
        const a = r.pick(actions);
        const beaches = [...m.stored.keys()];
        let got: CopyAnswer = { status: 200 };
        let want: CopyAnswer = { status: 200 };
        if (a === 'save') {
          const b = r.pick(beaches);
          const k = r.int(3);
          trace.push(`save(${beaches.indexOf(b)},${k})`);
          [got, want] = [await answer(await save(me, b, k)), m.save(b, k)];
        } else if (a === 'copy') {
          const target = r.next() < 0.4 ? null : r.pick(beaches);
          const pin = r.next() < 0.2 ? m.sver - 1 : m.sver;
          const mode: Mode = r.pick(['strict', 'drop-missing'] as const);
          trace.push(`copy(${target === null ? 'new' : beaches.indexOf(target)},${pin === m.sver ? 'pin' : 'stale'},${mode})`);
          const res = await copy(me, src.code, pin, target ?? 'new', mode);
          got = await answer(res);
          const w = m.copy(target, pin, mode);
          want = { status: w.status, ...(w.why ? { why: w.why } : {}) };
          if (res.status === 200 && w.status === 200) m.land(((await res.json()) as { beach: string }).beach, w.writes!);
        } else if (a === 'edit') {
          const k = r.int(3);
          trace.push(`edit(${k})`);
          expect((await save(src, src.id, k)).status).toBe(200);
          m.sourceEdit(k);
        } else if (a === 'shore') {
          const pub = !m.spub;
          trace.push(`shore(${pub})`);
          await hide(src.id, pub);
          m.sourceShore(pub);
        } else {
          trace.push('buy');
          await s.grant(me.token, ITEM);
          m.buy();
        }
        const where = `seed ${seed} step ${step}: ${trace.join(' ')}`;
        expect(got, where).toEqual(want);
        const h = await held(me);
        expect(Object.fromEntries(h), where).toEqual(Object.fromEntries(m.stored));
        expect(await version(src.id), where).toBe(m.sver);
        expect(m.invariants(), where).toEqual([]);
      }
    });
  }
});
