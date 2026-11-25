/**
 * Repro for Discord #bugs 1574941390083723265 (rosejen):
 * "One of my beaches (roro) was overridden when I was switching to the beach"
 *
 * Two binds overlapping (the view passing one beach while another loads), or
 * a timed save mid-bind, used to save the sand still in the worker under the
 * new beach's id. With beach state kept by id (docs/BEACH_STORE.md) a save
 * reads whichever simulation holds *that* id, so this can't happen; these
 * tests keep it that way.
 */
import { describe, expect, it } from 'vitest';
import { BeachStore, type BeachRef, type Saved, type StoreBackend } from '../src/net/beachStore';
import { BeachSync, type SimHost } from '../src/net/beachSync';
import { buildRestProfile } from '../src/sim/profile';
import { decodeSand, encodeSand } from '../src/sim/sandCodec';
import type { UndoHistory } from '../src/sim/undoStack';

// BeachSync touches window timers; node has the same functions.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;

const grid = { nx: 8, ny: 8, dx: 4 };
const n = grid.nx * grid.ny;
const rest = buildRestProfile(grid, 1);

const sandBytes = (fill: number) => encodeSand(new Float32Array(n).fill(fill), grid.nx, grid.ny, []);
const sandFill = async (bytes: Uint8Array) => (await decodeSand(bytes)).delta[0];

async function makeWorld() {
  const server = new Map<string, Uint8Array>([
    ['A', await sandBytes(1)],
    ['B', await sandBytes(2)],
    ['C', await sandBytes(3)],
  ]);
  const saves: { beach: string; fill: number }[] = [];
  const backend: StoreBackend = {
    // slow loads, so a second bind / save can start while the first is in flight
    async load(ref): Promise<Saved | null> {
      await new Promise((r) => setTimeout(r, 30));
      const bytes = server.get(ref.id);
      return bytes ? { location: 'bondi', nx: grid.nx, ny: grid.ny, updatedAt: 1, epoch: 0, bytes } : null;
    },
    async save(ref, bytes) {
      saves.push({ beach: ref.id, fill: await sandFill(bytes) });
      server.set(ref.id, bytes);
      return { updatedAt: Date.now() };
    },
  };
  const store = new BeachStore(grid, rest, backend);
  // the worker: what it holds, and its undo history
  let sim = { fill: 0, history: undefined as UndoHistory | undefined };
  const host: SimHost = {
    read: async (history) => {
      const out = { delta: new Float32Array(n).fill(sim.fill), objects: [], ...(history && sim.history ? { history: sim.history } : {}) };
      if (history) sim.history = undefined;
      return out;
    },
    write: (s) => {
      sim = { fill: s.delta[0], history: s.history };
    },
  };
  const sync = new BeachSync(null, store, host);
  const ref = (id: string): BeachRef => ({ id, code: id, owned: true });
  await sync.bind(ref('A'));
  return { server, saves, store, sync, ref, sim: () => sim, setSim: (f: number) => (sim.fill = f), setHistory: (h: UndoHistory) => (sim.history = h) };
}

describe('binding the worker to a beach by id', () => {
  it('a second bind while the first is loading never saves one beach into another', async () => {
    const w = await makeWorld();
    w.setSim(1.5); // A, changed by the waves
    w.store.markDirty('A', 1e9);
    const first = w.sync.bind(w.ref('B'));
    await new Promise((r) => setTimeout(r, 5));
    await w.sync.bind(w.ref('C'));
    await first;
    await w.store.flushAll();
    expect(await sandFill(w.server.get('B')!)).toBe(2);
    expect(await sandFill(w.server.get('A')!)).toBe(1.5);
    expect(w.sim().fill).toBe(3);
    expect(w.sync.id).toBe('C');
    expect(w.saves.filter((s) => s.beach !== 'A')).toEqual([]);
  });

  it('a save fired mid-bind saves the worker sand under the beach it belongs to', async () => {
    const w = await makeWorld();
    w.setSim(1.25);
    w.store.markDirty('A', 1e9);
    const binding = w.sync.bind(w.ref('B'));
    await new Promise((r) => setTimeout(r, 5));
    await w.store.flushAll();
    await binding;
    expect(await sandFill(w.server.get('B')!)).toBe(2);
    expect(await sandFill(w.server.get('A')!)).toBe(1.25);
    expect(w.sim().fill).toBe(2);
  });

  it('moving the waves hands the undo history over with the beach, and back', async () => {
    const w = await makeWorld();
    const history: UndoHistory = { undos: [{ i0: 0, j0: 0, w: 1, h: 1, delta: new Float32Array(1) }], redos: [] };
    w.setHistory(history);
    await w.sync.bind(w.ref('B'));
    expect(w.store.undoCount('A').undo).toBe(1);
    expect(w.sim().history).toBeUndefined();
    await w.sync.bind(w.ref('A'));
    expect(w.sim().history?.undos.length).toBe(1);
    // nothing fetched again: the store already had both
    expect(w.store.peek('B')?.updatedAt).toBe(1);
  });
});
