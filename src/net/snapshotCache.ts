import { BEACH_STORE } from '../config';
import { localDelete, localGet, localSet } from './localStore';

/**
 * Other people's beaches as last fetched, kept on the device
 * (docs/BEACH_STORE.md, "Snapshots on the device"): the saved bytes, keyed by
 * beach id and checked against the save time the shore reports, so a page
 * reload or a re-anchor draws a beach you've seen without fetching it again
 * when nothing newer was saved. Best effort, like the rest of localStore.
 */
export interface Snapshot {
  bytes: Uint8Array;
  location: string;
  nx: number;
  ny: number;
  updatedAt: number;
  version?: number;
}

export interface SnapshotCache {
  get(id: string): Promise<Snapshot | null>;
  put(id: string, snap: Snapshot): Promise<void>;
  clear(): Promise<void>;
}

/** An in-memory cache (tests, and anywhere IndexedDB isn't wanted). */
export function memorySnapshotCache(capacity: number = BEACH_STORE.diskCapacity): SnapshotCache & { ids(): string[] } {
  const map = new Map<string, Snapshot>();
  return {
    async get(id) {
      const s = map.get(id);
      if (!s) return null;
      map.delete(id);
      map.set(id, s);
      return s;
    },
    async put(id, snap) {
      map.delete(id);
      map.set(id, snap);
      while (map.size > capacity) map.delete(map.keys().next().value as string);
    },
    async clear() {
      map.clear();
    },
    ids: () => [...map.keys()],
  };
}

const INDEX = 'snaps';
const key = (id: string) => `snap:${id}`;

/** The device's cache, in IndexedDB: the least recently used go past `capacity`. */
export function idbSnapshotCache(capacity: number = BEACH_STORE.diskCapacity): SnapshotCache {
  // index changes run one at a time (a read-modify-write of the id list)
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.then(fn, fn);
    queue = p.catch(() => {});
    return p;
  };
  const touch = (id: string, add: boolean) =>
    serial(async () => {
      const ids = ((await localGet<string[]>(INDEX)) ?? []).filter((x) => x !== id);
      if (add) ids.push(id);
      const gone = ids.splice(0, Math.max(0, ids.length - capacity));
      await localSet(INDEX, ids);
      for (const g of gone) await localDelete(key(g));
    });
  return {
    async get(id) {
      const s = await localGet<Snapshot>(key(id));
      if (s) void touch(id, true);
      return s;
    },
    async put(id, snap) {
      await localSet(key(id), snap);
      await touch(id, true);
    },
    clear: () =>
      serial(async () => {
        for (const id of (await localGet<string[]>(INDEX)) ?? []) await localDelete(key(id));
        await localSet(INDEX, []);
      }),
  };
}
