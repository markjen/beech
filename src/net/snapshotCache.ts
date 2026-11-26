import { BEACH_STORE } from '../config';
import { localTransaction } from './localStore';

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

interface SnapshotRead {
  snapshot: Snapshot | null;
  generation: number | null;
}

export interface SnapshotCache {
  read(id: string): Promise<SnapshotRead>;
  write(id: string, snapshot: Snapshot | null, generation: number): Promise<void>;
  clear(): Promise<void>;
}

/** An in-memory cache for tests. */
export function memorySnapshotCache(capacity: number = BEACH_STORE.diskCapacity): SnapshotCache & { ids(): string[] } {
  const map = new Map<string, Snapshot>();
  let generation = 0;
  return {
    async read(id) {
      const snapshot = map.get(id) ?? null;
      if (snapshot) {
        map.delete(id);
        map.set(id, snapshot);
      }
      return { snapshot, generation };
    },
    async write(id, snapshot, expected) {
      if (generation !== expected) return;
      map.delete(id);
      if (snapshot) map.set(id, snapshot);
      while (map.size > capacity) map.delete(map.keys().next().value as string);
    },
    async clear() {
      generation++;
      map.clear();
    },
    ids: () => [...map.keys()],
  };
}

interface SnapshotIndex {
  ids: string[];
  generation: number;
}

const INDEX = 'snaps';
const key = (id: string) => `snap:${id}`;

/** The index and the saved bytes change in one transaction, even across tabs. */
export function idbSnapshotCache(capacity: number = BEACH_STORE.diskCapacity): SnapshotCache {
  function withIndex<T>(run: (index: SnapshotIndex, store: IDBObjectStore, result: (value: T) => void) => void): Promise<T | null> {
    return localTransaction<T>((store, result) => {
      const req = store.get(INDEX);
      req.onsuccess = () => {
        const index = req.result as SnapshotIndex | string[] | undefined;
        run(Array.isArray(index) ? { ids: index, generation: 0 } : (index ?? { ids: [], generation: 0 }), store, result);
      };
    });
  }

  return {
    async read(id) {
      return (await withIndex<SnapshotRead>((index, store, result) => {
        const { ids, generation } = index;
        if (!ids.includes(id)) return result({ snapshot: null, generation });
        const req = store.get(key(id));
        req.onsuccess = () => {
          const snapshot = (req.result as Snapshot | undefined) ?? null;
          index.ids = ids.filter((other) => other !== id);
          if (snapshot) index.ids.push(id);
          store.put(index, INDEX);
          result({ snapshot, generation });
        };
      })) ?? { snapshot: null, generation: null };
    },
    async write(id, snapshot, expected) {
      await withIndex((index, store) => {
        if (index.generation !== expected) return;
        index.ids = index.ids.filter((other) => other !== id);
        if (snapshot) {
          index.ids.push(id);
          store.put(snapshot, key(id));
        } else {
          store.delete(key(id));
        }
        const evicted = index.ids.splice(0, Math.max(0, index.ids.length - capacity));
        for (const other of evicted) store.delete(key(other));
        store.put(index, INDEX);
      });
    },
    async clear() {
      await withIndex(({ generation }, store) => {
        store.delete(IDBKeyRange.bound('snap:', 'snap:\uffff'));
        store.put({ ids: [], generation: generation + 1 }, INDEX);
      });
    },
  };
}
