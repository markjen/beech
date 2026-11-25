import { describe, expect, it } from 'vitest';
import { GRID_TIERS } from '../src/config';
import { BeachStore, LOCAL_BEACH, type BeachRef, type Saved, type StoreBackend } from '../src/net/beachStore';
import { memorySnapshotCache } from '../src/net/snapshotCache';
import { withSnapshots } from '../src/net/storeBackends';
import { buildRestProfile } from '../src/sim/profile';
import { encodeSand } from '../src/sim/sandCodec';

// Other people's beaches kept on the device (docs/BEACH_STORE.md, "Snapshots on the device").

const grid = GRID_TIERS.low;
const rest = buildRestProfile(grid, 1);
const n = grid.nx * grid.ny;

function server() {
  const beaches = new Map<string, Saved>();
  const loads: string[] = [];
  let offline = false;
  const backend: StoreBackend = {
    async load(ref) {
      loads.push(ref.id);
      if (offline) throw new Error('offline');
      return beaches.get(ref.id) ?? null;
    },
    async save() {
      return { updatedAt: Date.now() };
    },
  };
  return { beaches, loads, backend, setOffline: (v: boolean) => (offline = v) };
}

async function saved(height: number, updatedAt: number, version = 1): Promise<Saved> {
  const delta = new Float32Array(n).fill(height);
  return { location: 'bondi', nx: grid.nx, ny: grid.ny, bytes: await encodeSand(delta, grid.nx, grid.ny, []), updatedAt, version };
}

const theirs = (id: string, updatedAt: number | null | undefined): BeachRef => ({ id, code: id.toUpperCase(), owned: false, updatedAt });

describe('snapshots on the device', () => {
  it('a reload draws a beach seen before without fetching it, while nothing newer was saved', async () => {
    const s = server();
    const cache = memorySnapshotCache();
    s.beaches.set('a', await saved(0.2, 100, 3));
    const first = new BeachStore(grid, rest, withSnapshots(s.backend, cache));
    await first.load(theirs('a', 100));
    expect(s.loads).toEqual(['a']);

    // a page reload: a new store, the same device
    const second = new BeachStore(grid, rest, withSnapshots(s.backend, cache));
    const st = await second.load(theirs('a', 100));
    expect(s.loads).toEqual(['a']);
    expect(st?.display[0]).toBeCloseTo(0.2);
    expect(st?.version).toBe(3);
    expect(st?.updatedAt).toBe(100);
  });

  it('a newer save on the shore is fetched (and kept in place of the old copy)', async () => {
    const s = server();
    const cache = memorySnapshotCache();
    s.beaches.set('a', await saved(0.2, 100));
    await new BeachStore(grid, rest, withSnapshots(s.backend, cache)).load(theirs('a', 100));
    s.beaches.set('a', await saved(0.5, 200, 2));
    const st = await new BeachStore(grid, rest, withSnapshots(s.backend, cache)).load(theirs('a', 200));
    expect(s.loads).toEqual(['a', 'a']);
    expect(st?.display[0]).toBeCloseTo(0.5);
    expect((await cache.get('a'))?.updatedAt).toBe(200);
  });

  it('a beach the store holds is reloaded from the server, never from the device', async () => {
    const s = server();
    const cache = memorySnapshotCache();
    s.beaches.set('a', await saved(0.2, 100, 1));
    const store = new BeachStore(grid, rest, withSnapshots(s.backend, cache));
    await store.load(theirs('a', 100));
    // a live viewer saw the version move on; the shore still says 100
    s.beaches.set('a', await saved(0.4, 150, 2));
    const st = await store.reload(theirs('a', 100));
    expect(s.loads).toEqual(['a', 'a']);
    expect(st?.display[0]).toBeCloseTo(0.4);
    expect(st?.version).toBe(2);
  });

  it('without a save time from the shore it fetches', async () => {
    const s = server();
    const cache = memorySnapshotCache();
    s.beaches.set('a', await saved(0.2, 100));
    await new BeachStore(grid, rest, withSnapshots(s.backend, cache)).load(theirs('a', 100));
    await new BeachStore(grid, rest, withSnapshots(s.backend, cache)).load(theirs('a', undefined));
    expect(s.loads).toEqual(['a', 'a']);
  });

  it('offline, the kept copy stands in however old it is', async () => {
    const s = server();
    const cache = memorySnapshotCache();
    s.beaches.set('a', await saved(0.2, 100));
    await new BeachStore(grid, rest, withSnapshots(s.backend, cache)).load(theirs('a', 100));
    s.setOffline(true);
    const st = await new BeachStore(grid, rest, withSnapshots(s.backend, cache)).load(theirs('a', 300));
    expect(st?.display[0]).toBeCloseTo(0.2);
    // and a beach never seen is still unavailable
    expect(await new BeachStore(grid, rest, withSnapshots(s.backend, cache)).load(theirs('b', 300))).toBeNull();
  });

  it('your own beaches and the device beach are never kept', async () => {
    const s = server();
    const cache = memorySnapshotCache();
    s.beaches.set('mine', await saved(0.2, 100));
    const b = withSnapshots(s.backend, cache);
    await b.load({ id: 'mine', owned: true, updatedAt: 100 });
    await b.load({ id: LOCAL_BEACH, owned: false, updatedAt: 100 });
    expect(cache.ids()).toEqual([]);
  });

  it('keeps at most its capacity, dropping the least recently used', async () => {
    const cache = memorySnapshotCache(2);
    const snap = await saved(0, 1);
    await cache.put('a', snap);
    await cache.put('b', snap);
    await cache.get('a');
    await cache.put('c', snap);
    expect(cache.ids()).toEqual(['a', 'c']);
  });
});
