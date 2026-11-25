// Editing beaches from several devices, against specs/tla/BeachEditing.tla
// (docs/STATE_MACHINES.md). Fast: the real server in-process, no rendering.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { beachBytes, rng, startServer, type Server } from './harness.js';
import { EditingModel, type Answer, type Device } from './editingModel.js';

let s: Server;
beforeAll(async () => {
  s = await startServer();
});
afterAll(() => s.close());

const ITEM = 'lighthouse';
/**
 * Where a save is paused: its token and bag checks have passed and it is
 * taking the before-edit snapshot, just ahead of the write (SaveBag done,
 * SaveUpd next, in the spec's terms). The same statement runs there in the
 * old and the fixed code, so the replay means the same thing in both.
 */
const AFTER_CHECKS = /SELECT sand FROM beach WHERE id = \$1 AND sand IS NOT NULL/;

interface Player {
  token: string;
  id: string;
  beaches: [string, string];
  /** each device's edit token (from its last claim) */
  edit: Record<Device, string>;
  /** the epoch each device last saw, per beach (what it sends as X-Beach-Epoch) */
  seen: Record<Device, Record<string, number>>;
}

let n = 0;
async function player(owned: number): Promise<Player> {
  n++;
  const u = await s.signIn(`Editor ${n}`);
  if (owned) await s.grant(u.token, ITEM, owned);
  await s.grant(u.token, 'beach');
  const edit = { d1: await s.claim(u.token), d2: '' };
  const r = await s.post('/beaches/mine', u.token, { name: 'Second' }, { 'X-Edit-Token': edit.d1 });
  expect(r.status).toBe(200);
  const second = ((await r.json()) as { beach: { id: string } }).beach.id;
  const beaches: [string, string] = [u.id, second];
  return { ...u, beaches, edit, seen: { d1: { [u.id]: 0, [second]: 0 }, d2: { [u.id]: 0, [second]: 0 } } };
}

const claim = async (p: Player, d: Device) => {
  p.edit[d] = await s.claim(p.token);
};
const load = async (p: Player, d: Device, b: string) => {
  const r = await s.req(`/beaches/mine/${b}/sand`, {}, p.token);
  p.seen[d][b] = Number(r.headers.get('X-Beach-Epoch') ?? 0);
};
const save = (p: Player, d: Device, b: string, count: number) =>
  s.req(
    `/beaches/mine/${b}/sand`,
    {
      method: 'PUT',
      body: beachBytes(count ? { [ITEM]: count } : {}),
      headers: {
        'X-Beach-Location': 'bondi',
        'X-Beach-Nx': '16',
        'X-Beach-Ny': '16',
        'X-Beach-Max': '2000',
        'X-Beach-Epoch': String(p.seen[d][b]),
        'X-Edit-Token': p.edit[d] || 'never-claimed',
      },
    },
    p.token,
  );
const checkpoint = async (p: Player, b: string, name: string) => {
  const r = await s.post(`/beaches/mine/${b}/checkpoints`, p.token, { name });
  expect(r.status).toBe(201);
  return ((await r.json()) as { checkpoint: { id: string } }).checkpoint.id;
};
const restore = async (p: Player, d: Device, b: string, cp: string) => {
  const r = await s.post(`/beaches/mine/${b}/restore`, p.token, { checkpoint: cp }, { 'X-Edit-Token': p.edit[d] || 'never-claimed' });
  if (r.status === 200) p.seen[d][b] = ((await r.clone().json()) as { epoch: number }).epoch;
  return r;
};

/** What the server answered, in the model's terms. */
async function answer(r: Response): Promise<Answer> {
  if (r.status !== 409) return { status: r.status };
  const why = ((await r.json()) as { error: string }).error;
  return { status: 409, why: why as Answer['why'] };
}

async function stored(p: Player) {
  const rows = await s.db.query<{ id: string; items: Record<string, number> | string | null; epoch: number }>(
    'SELECT id, items, epoch FROM beach WHERE owner_id = $1',
    [p.id],
  );
  const out: Record<string, { n: number; epoch: number }> = {};
  for (const r of rows) {
    const items = typeof r.items === 'string' ? JSON.parse(r.items) : (r.items ?? {});
    out[r.id] = { n: Number(items[ITEM] ?? 0), epoch: Number(r.epoch) };
  }
  return out;
}

describe('editing: one transition at a time', () => {
  it('Claim fences the last device: its saves are refused, the new editor\'s land', async () => {
    const p = await player(1);
    const [b1] = p.beaches;
    expect(await answer(await save(p, 'd1', b1, 1))).toEqual({ status: 200 });
    await claim(p, 'd2');
    expect(await answer(await save(p, 'd1', b1, 0))).toEqual({ status: 409, why: 'fenced' });
    await load(p, 'd2', b1);
    expect(await answer(await save(p, 'd2', b1, 0))).toEqual({ status: 200 });
    expect((await stored(p))[b1].n).toBe(0);
  });

  it('WithinBag: what one beach holds counts against the others', async () => {
    const p = await player(1);
    const [b1, b2] = p.beaches;
    expect(await answer(await save(p, 'd1', b1, 1))).toEqual({ status: 200 });
    expect(await answer(await save(p, 'd1', b2, 1))).toEqual({ status: 409, why: 'short' });
    // moving it across: take it off b1, then b2 may have it
    expect(await answer(await save(p, 'd1', b1, 0))).toEqual({ status: 200 });
    expect(await answer(await save(p, 'd1', b2, 1))).toEqual({ status: 200 });
  });

  it('Restore bumps the epoch: a save made before it is refused until the device reloads', async () => {
    const p = await player(1);
    const [b1] = p.beaches;
    await save(p, 'd1', b1, 1);
    const one = await checkpoint(p, b1, 'one');
    await save(p, 'd1', b1, 0);
    const before = { ...p.seen.d1 };
    expect((await restore(p, 'd1', b1, one)).status).toBe(200);
    // another tab of the same device, still on the old epoch
    p.seen.d1 = before;
    expect(await answer(await save(p, 'd1', b1, 0))).toEqual({ status: 409, why: 'restored' });
    await load(p, 'd1', b1);
    expect(await answer(await save(p, 'd1', b1, 0))).toEqual({ status: 200 });
  });

  it('Restore is refused when the bag can\'t cover it (strict)', async () => {
    const p = await player(1);
    const [b1, b2] = p.beaches;
    await save(p, 'd1', b1, 1);
    const one = await checkpoint(p, b1, 'one');
    const r = await restore(p, 'd1', b2, one);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe('short');
  });
});

describe('editing: TLC counterexamples, replayed against the server', () => {
  // PGlite serializes whole transactions. PostgreSQL can run them on
  // different connections, so the takeover must wait for the editor's lock.
  it.runIf(Boolean(process.env.TEST_DATABASE_URL))('a takeover waits for the player write lock', async () => {
    const p = await player(1);
    let locked!: (pid: number) => void;
    let release!: () => void;
    const holder = new Promise<number>((resolve) => (locked = resolve));
    const hold = new Promise<void>((resolve) => (release = resolve));
    const writing = s.db.withTransaction(async (tx) => {
      const [row] = await tx.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid FROM users WHERE id = $1 FOR NO KEY UPDATE', [p.id],
      );
      locked(row.pid);
      await hold;
    });
    const pid = await Promise.race([holder, writing.then(() => {
      throw new Error('The player lock transaction ended early');
    })]);
    let finished = false;
    const takeover = claim(p, 'd2').then(() => { finished = true; });
    try {
      await vi.waitFor(async () => {
        const [row] = await s.db.query<{ blocked: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked', [pid],
        );
        expect(row.blocked).toBe(true);
        expect(finished).toBe(false);
      }, { timeout: 2500 });
    } finally {
      release();
      await Promise.all([writing, takeover]);
    }
    expect(await answer(await save(p, 'd1', p.beaches[0], 0))).toEqual({ status: 409, why: 'fenced' });
  });

  // BeachEditing.cfg, OnlyEditorWrites: Claim(d1), SaveStart, SaveTok, SaveBag, Claim(d2), SaveUpd.
  it('a device that loses the edit session mid-save does not write', async () => {
    const p = await player(1);
    const [b1] = p.beaches;
    await save(p, 'd1', b1, 1);
    const gate = s.gate.pauseBefore(AFTER_CHECKS);
    const saving = save(p, 'd1', b1, 0); // SaveTok + SaveBag pass
    await Promise.race([gate.reached, saving]);
    await claim(p, 'd2'); // Claim(d2) in the gap
    gate.release();
    expect(await answer(await saving)).toEqual({ status: 409, why: 'fenced' }); // SaveUpd
    expect((await stored(p))[b1].n).toBe(1);
  });

  // BeachEditing.cfg, WithinBag: two saves from d1 (b1 and b2) both pass the bag check, then both write.
  it('two saves at once can\'t place the one thing owned on two beaches', async () => {
    const p = await player(1);
    const [b1, b2] = p.beaches;
    const gate = s.gate.pauseBefore(AFTER_CHECKS);
    const first = save(p, 'd1', b1, 1);
    await Promise.race([gate.reached, first]);
    const second = await answer(await save(p, 'd1', b2, 1));
    gate.release();
    const answers = [await answer(await first), second];
    expect(answers.filter((a) => a.status === 200)).toHaveLength(1);
    expect(answers.find((a) => a.status === 409)).toEqual({ status: 409, why: 'short' });
    const st = await stored(p);
    expect(st[b1].n + st[b2].n).toBe(1);
  });
});

describe('editing: random walks, server vs model', () => {
  type Action = 'claim' | 'load' | 'save' | 'restore';
  const actions: Action[] = ['claim', 'load', 'load', 'save', 'save', 'save', 'restore'];

  for (const seed of [11, 12, 13, 14, 15, 16]) {
    it(`seed ${seed}: 30 steps agree with the model and keep its invariants`, async () => {
      const r = rng(seed);
      const owned = 1 + r.int(2);
      const p = await player(owned);
      const m = new EditingModel(p.beaches);
      m.owned = owned;
      m.claim('d1');
      // two checkpoints to restore from: one holding a lighthouse, one empty
      const [b1] = p.beaches;
      await save(p, 'd1', b1, 1);
      m.save('d1', b1, 1);
      const cps = [
        { id: await checkpoint(p, b1, 'one'), n: 1 },
        { id: '', n: 0 },
      ];
      await save(p, 'd1', b1, 0);
      m.save('d1', b1, 0);
      cps[1].id = await checkpoint(p, b1, 'none');
      const trace: string[] = [];
      for (let step = 0; step < 30; step++) {
        s.clock.now += 1000;
        const a = r.pick(actions);
        const d: Device = r.pick(['d1', 'd2'] as const);
        const b = r.pick(p.beaches);
        let got: Answer = { status: 200 };
        let want: Answer = { status: 200 };
        if (a === 'claim') {
          await claim(p, d);
          m.claim(d);
        } else if (a === 'load') {
          await load(p, d, b);
          m.load(d, b);
        } else if (a === 'save') {
          const count = r.int(3);
          trace.push(`${a}(${d},${b === b1 ? 'b1' : 'b2'},${count})`);
          if (!p.edit[d]) continue; // a device never claimed is an old app (426): not modelled
          [got, want] = [await answer(await save(p, d, b, count)), m.save(d, b, count)];
        } else {
          const cp = r.pick(cps);
          trace.push(`${a}(${d},${b === b1 ? 'b1' : 'b2'},${cp.n})`);
          if (!p.edit[d]) continue;
          [got, want] = [await answer(await restore(p, d, b, cp.id)), m.restore(d, b, cp.n)];
        }
        if (a === 'claim' || a === 'load') trace.push(`${a}(${d}${a === 'load' ? ',' + (b === b1 ? 'b1' : 'b2') : ''})`);
        const where = `seed ${seed} step ${step}: ${trace.join(' ')}`;
        expect(got, where).toEqual(want);
        const st = await stored(p);
        for (const x of p.beaches) expect({ n: st[x].n, epoch: st[x].epoch }, where).toEqual({ n: m.stored[x], epoch: m.epoch[x] });
        expect(m.invariants(), where).toEqual([]);
      }
    });
  }
});
