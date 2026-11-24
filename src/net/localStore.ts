// The sandbox build has no accounts, so it keeps things on the device, in
// IndexedDB: the beach you're playing on (between visits) and checkpoints
// (docs/CHECKPOINTS.md, C6). Best effort: a private window or blocked
// storage just means nothing is kept, and the app carries on.

const DB = 'beech';
const STORE = 'kv';

let opening: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export const localGet = <T>(key: string): Promise<T | null> => run<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
export const localSet = (key: string, value: unknown): Promise<unknown> => run('readwrite', (s) => s.put(value, key));
export const localDelete = (key: string): Promise<unknown> => run('readwrite', (s) => s.delete(key));

// ------------------------------------------------------------------ the sandbox beach

export interface LocalBeach {
  /** saved-beach bytes (src/sim/sandCodec.ts) */
  bytes: Uint8Array;
  location: string;
  savedAt: number;
}

export const loadLocalBeach = () => localGet<LocalBeach>('beach');
export const saveLocalBeach = (b: LocalBeach) => localSet('beach', b);

// ------------------------------------------------------------------ checkpoints on the device

export interface LocalCheckpoint {
  id: string;
  name: string;
  createdAt: number;
  objects: number;
  bytes: number;
  location: string;
}

/** at most this many checkpoints on the device */
export const LOCAL_CHECKPOINTS = 20;

export const LocalCheckpoints = {
  async list(): Promise<LocalCheckpoint[]> {
    return ((await localGet<LocalCheckpoint[]>('checkpoints')) ?? []).sort((a, b) => b.createdAt - a.createdAt);
  },
  async save(name: string, bytes: Uint8Array, objects: number, location: string): Promise<LocalCheckpoint> {
    const list = await this.list();
    if (list.length >= LOCAL_CHECKPOINTS) throw new Error(`${LOCAL_CHECKPOINTS} checkpoints is the most this device keeps: delete one first`);
    const cp: LocalCheckpoint = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, name, createdAt: Date.now(), objects, bytes: bytes.byteLength, location };
    if ((await localSet(`cp:${cp.id}`, bytes)) === null) throw new Error("this browser isn't keeping anything (private mode?)");
    await localSet('checkpoints', [cp, ...list]);
    return cp;
  },
  sand: (id: string) => localGet<Uint8Array>(`cp:${id}`),
  async rename(id: string, name: string): Promise<void> {
    const list = await this.list();
    await localSet('checkpoints', list.map((c) => (c.id === id ? { ...c, name } : c)));
  },
  async remove(id: string): Promise<void> {
    await localDelete(`cp:${id}`);
    await localSet('checkpoints', (await this.list()).filter((c) => c.id !== id));
  },
};
