import { describe, expect, it, vi } from 'vitest';
import { GRID_TIERS } from '../src/config';
import { BeachStore, type BeachRef, type Saved, type StoreBackend } from '../src/net/beachStore';
import { buildRestProfile } from '../src/sim/profile';
import { encodeSand } from '../src/sim/sandCodec';

const grid = GRID_TIERS.low;
const rest = buildRestProfile(grid, 1);
const n = grid.nx * grid.ny;

/** A backend over an in-memory server, counting calls; `fail` makes the next save throw with that status. */
function fakeBackend() {
  const server = new Map<string, Saved>();
  const calls = { load: [] as string[], save: [] as string[] };
  let fail: { status: number; message?: string } | null = null;
  let gate: Promise<void> | null = null;
  const backend: StoreBackend = {
    async load(ref: BeachRef) {
      calls.load.push(ref.id);
      await gate;
      return server.get(ref.id) ?? null;
    },
    async save(ref, bytes, opts) {
      calls.save.push(ref.id);
      await gate;
      if (fail) {
        const f = fail;
        fail = null;
        throw Object.assign(new Error(f.message ?? 'refused'), { status: f.status });
      }
      const updatedAt = Date.now();
      server.set(ref.id, { location: opts.location, nx: opts.nx, ny: opts.ny, bytes, updatedAt, epoch: opts.epoch });
      return { updatedAt };
    },
  };
  return {
    backend,
    server,
    calls,
    failNext: (status: number, message?: string) => (fail = { status, message }),
    hold: () => {
      let release!: () => void;
      gate = new Promise<void>((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
  };
}

async function seed(server: Map<string, Saved>, id: string, height: number) {
  const delta = new Float32Array(n).fill(height);
  server.set(id, { location: 'bondi', nx: grid.nx, ny: grid.ny, bytes: await encodeSand(delta, grid.nx, grid.ny, []), updatedAt: 100, epoch: 2 });
}

const mine = (id: string): BeachRef => ({ id, code: id.toUpperCase(), owned: true });
const theirs = (id: string): BeachRef => ({ id, code: id.toUpperCase(), owned: false });

describe('BeachStore', () => {
  it('fetches a beach once however many ask, and keeps it by id', async () => {
    const f = fakeBackend();
    await seed(f.server, 'a', 0.1);
    const store = new BeachStore(grid, rest, f.backend);
    const [x, y] = await Promise.all([store.load(mine('a')), store.load(mine('a'))]);
    expect(f.calls.load).toEqual(['a']);
    expect(x).toBe(y);
    expect(x!.delta[0]).toBeCloseTo(0.1, 3);
    expect(x!.epoch).toBe(2);
    await store.load(mine('a'));
    expect(f.calls.load).toEqual(['a']);
  });

  it('a beach with no save is an empty, fresh one of yours', async () => {
    const f = fakeBackend();
    const store = new BeachStore(grid, rest, f.backend);
    const st = await store.load(mine('new'));
    expect(st!.fresh).toBe(true);
    expect(st!.epoch).toBe(0);
    expect(st!.delta.every((v) => v === 0)).toBe(true);
  });

  it('edits save under their own id; a stale reload never drops unsaved edits', async () => {
    const f = fakeBackend();
    await seed(f.server, 'a', 0);
    const store = new BeachStore(grid, rest, f.backend);
    await store.load(mine('a'));
    const sim = store.editSim('a')!;
    sim.beginStroke(16, 10, 1, 'pile');
    sim.stepEdit(1 / 30);
    sim.endStroke();
    store.edited('a');
    expect(store.isDirty('a')).toBe(true);
    // the shore says there's a newer save: the edits stay
    store.markStale('a', 999);
    await store.load({ ...mine('a'), updatedAt: 999 });
    expect(f.calls.load).toEqual(['a']);
    await store.flush('a');
    expect(f.calls.save).toEqual(['a']);
    expect(store.isDirty('a')).toBe(false);
  });

  it('a change during a save leaves the beach dirty for the next one', async () => {
    const f = fakeBackend();
    const store = new BeachStore(grid, rest, f.backend);
    await store.load(mine('a'));
    store.markDirty('a', 1e9);
    const release = f.hold();
    const first = store.flush('a');
    await Promise.resolve();
    store.markDirty('a', 1e9);
    release();
    await first;
    expect(store.isDirty('a')).toBe(true);
    await store.flush('a');
    expect(store.isDirty('a')).toBe(false);
    expect(f.calls.save).toEqual(['a', 'a']);
  });

  it('let go of the least recently used, never in view, changed or held by a sim', async () => {
    const f = fakeBackend();
    const store = new BeachStore(grid, rest, f.backend, 1, 4);
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) await store.load(id < 'c' ? mine(id) : theirs(id));
    store.markDirty('a', 1e9); // changed
    store.checkout('b', { read: async () => ({ delta: new Float32Array(n), objects: [] }) }); // in the worker
    store.retain(['f']);
    store.get('c'); // used recently
    const dropped = store.gc();
    expect(dropped).toEqual(['d', 'e']);
    expect(store.ids().sort()).toEqual(['a', 'b', 'c', 'f']);
  });

  it('hands sand and undo history to a simulation and back', async () => {
    const f = fakeBackend();
    const store = new BeachStore(grid, rest, f.backend);
    await store.load(mine('a'));
    const sim = store.editSim('a')!;
    sim.beginStroke(16, 10, 1, 'dig');
    sim.stepEdit(1 / 30);
    sim.endStroke();
    store.edited('a', false);
    expect(store.undoCount('a').undo).toBe(1);
    const out = store.checkout('a', { read: async () => ({ delta: new Float32Array(n), objects: [] }) })!;
    expect(out.history?.undos.length).toBe(1);
    expect(store.peek('a')!.sim).toBeUndefined();
    expect(store.editSim('a')).toBeNull(); // held by the source
    store.checkin('a', out);
    const again = store.editSim('a')!;
    expect(again.undo.undoCount).toBe(1);
    expect(again.undoStroke(true)).toBe(true);
  });

  it('saves read the simulation that holds the beach', async () => {
    const f = fakeBackend();
    const store = new BeachStore(grid, rest, f.backend);
    await store.load(mine('a'));
    let reads = 0;
    store.checkout('a', {
      read: async () => {
        reads++;
        return { delta: new Float32Array(n).fill(0.25), objects: [] };
      },
    });
    store.markDirty('a', 1e9);
    await store.flush('a');
    expect(reads).toBe(1);
    const again = new BeachStore(grid, rest, f.backend);
    expect((await again.load(mine('a')))!.delta[5]).toBeCloseTo(0.25, 3);
  });

  it('a restore elsewhere (409) reloads that beach; fenced stops all saves', async () => {
    const f = fakeBackend();
    await seed(f.server, 'a', 0.3);
    const store = new BeachStore(grid, rest, f.backend);
    await store.load(mine('a'));
    await store.load(mine('b'));
    const problems: string[] = [];
    store.onProblem((id, p) => problems.push(`${id}:${p}`));
    let reloaded = '';
    store.onReloaded((id) => (reloaded = id));
    store.markDirty('a', 1e9);
    f.failNext(409, 'restored');
    await store.flush('a');
    await new Promise((r) => setTimeout(r, 0));
    await store.load(mine('a'));
    expect(problems).toEqual(['a:restored']);
    expect(reloaded).toBe('a');
    expect(store.isDirty('a')).toBe(false);

    store.markDirty('b', 1e9);
    f.failNext(409, 'fenced');
    await store.flush('b');
    expect(store.fenced).toBe(true);
    expect(store.state).toBe('fenced');
    store.markDirty('a', 1e9);
    expect(store.isDirty('a')).toBe(false);
  });

  it('over the bag (409 short): saves your other beaches, then tries once more', async () => {
    const f = fakeBackend();
    const store = new BeachStore(grid, rest, f.backend);
    await store.load(mine('a'));
    await store.load(mine('b'));
    const problems: string[] = [];
    store.onProblem((id, p) => problems.push(`${id}:${p}`));
    // a thing moved from b to a across the seam; a's save reached the server first
    store.markDirty('a', 1e9);
    store.markDirty('b', 1e9);
    f.failNext(409, 'short');
    await store.flush('a');
    await vi.waitFor(() => {
      expect(store.isDirty('a')).toBe(false);
      expect(store.isDirty('b')).toBe(false);
    });
    expect(f.calls.save).toEqual(['a', 'b', 'a']);
    expect(problems).toEqual([]);
  });

  it('still over the bag after the retry: the saved beach comes back, and says so', async () => {
    const f = fakeBackend();
    await seed(f.server, 'a', 0.3);
    const store = new BeachStore(grid, rest, f.backend);
    await store.load(mine('a'));
    const problems: string[] = [];
    store.onProblem((id, p) => problems.push(`${id}:${p}`));
    let reloaded = '';
    store.onReloaded((id) => (reloaded = id));
    const save = f.backend.save.bind(f.backend);
    let refusals = 0;
    f.backend.save = async (ref, bytes, opts) => {
      if (refusals++ < 2) throw Object.assign(new Error('short'), { status: 409 });
      return save(ref, bytes, opts);
    };
    store.markDirty('a', 1e9);
    await store.flush('a');
    await vi.waitFor(() => expect(reloaded).toBe('a'));
    expect(refusals).toBe(2);
    expect(problems).toEqual(['a:short']);
    expect(store.isDirty('a')).toBe(false);
  });

  it('forgets everything for the next person', async () => {
    const f = fakeBackend();
    const store = new BeachStore(grid, rest, f.backend);
    await store.load(mine('a'));
    store.markDirty('a', 1e9);
    store.reset();
    expect(store.size).toBe(0);
    expect(store.hasPendingSaves()).toBe(false);
  });
});
