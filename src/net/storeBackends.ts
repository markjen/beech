import type { Account } from './account';
import { ApiError, NeighborApi } from './account';
import { LOCAL_BEACH, type BeachRef, type Saved, type StoreBackend } from './beachStore';
import { loadLocalBeach, saveLocalBeach } from './localStore';
import type { Snapshot, SnapshotCache } from './snapshotCache';

/**
 * Where the BeachStore's beaches come from (docs/BEACH_STORE.md): yours by
 * id from your account, anyone else's by code from the shore, and the
 * signed-out / sandbox beach from this device (`saveLocal`: the sandbox keeps
 * it between visits; a signed-out production app doesn't). Other people's
 * beaches go through `snapshots` when given (see `withSnapshots`).
 */
export function beachBackend(account: Account | null, opts: { saveLocal: boolean; fresh?: boolean; snapshots?: SnapshotCache }): StoreBackend {
  const shore = account ? new NeighborApi(account) : null;
  const backend: StoreBackend = {
    async load(ref) {
      if (ref.id === LOCAL_BEACH) {
        if (!opts.saveLocal || opts.fresh) return null;
        const kept = await loadLocalBeach().catch(() => null);
        return kept ? { location: kept.location, nx: 0, ny: 0, bytes: kept.bytes, updatedAt: kept.savedAt } : null;
      }
      if (!account) return null;
      if (ref.owned) return account.loadBeach(ref.id);
      if (!ref.code || !shore) return null;
      return shore.beachByCode(ref.code);
    },
    async save(ref, bytes, o) {
      if (ref.id === LOCAL_BEACH) {
        if (!opts.saveLocal) return { updatedAt: Date.now() };
        const savedAt = Date.now();
        await saveLocalBeach({ bytes, location: o.location, savedAt });
        return { updatedAt: savedAt };
      }
      if (!account?.user) throw new ApiError(401, 'sign in first');
      return account.saveBeach(ref.id, bytes, o.location, o.nx, o.ny, o.keepalive, o.items, o.epoch);
    },
  };
  return opts.snapshots ? withSnapshots(backend, opts.snapshots) : backend;
}

/**
 * Keep other people's beaches on the device (docs/BEACH_STORE.md,
 * "Snapshots on the device"). A beach the store doesn't hold is read from
 * the device when the shore's save time matches the copy kept there, and
 * fetched otherwise; every fetch of someone else's beach is kept. Offline,
 * the kept copy (however old) stands in until the beach can be fetched.
 * Your own beaches, and reloads, always go to the server.
 */
export function withSnapshots(inner: StoreBackend, cache: SnapshotCache): StoreBackend {
  const cacheable = (ref: BeachRef) => !ref.owned && ref.id !== LOCAL_BEACH;
  return {
    async load(ref, o) {
      if (!cacheable(ref)) return inner.load(ref, o);
      const { snapshot, generation } = await cache.read(ref.id).catch(() => ({ snapshot: null, generation: null }));
      const kept = o?.reload ? null : snapshot;
      if (kept && typeof ref.updatedAt === 'number' && kept.updatedAt === ref.updatedAt) return kept;
      const write = (value: Snapshot | null) => {
        if (generation !== null) void cache.write(ref.id, value, generation).catch(() => {});
      };
      let saved: Saved | null;
      try {
        saved = await inner.load(ref, o);
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          if (e.status === 401 || e.status === 403 || e.status === 404) write(null);
          throw e;
        }
        if (kept) return kept;
        throw e;
      }
      if (saved) {
        const { bytes, location, nx, ny, updatedAt, version } = saved;
        write({ bytes, location, nx, ny, updatedAt, ...(version !== undefined ? { version } : {}) });
      } else if (snapshot) write(null);
      return saved;
    },
    save: (ref, bytes, o) => inner.save(ref, bytes, o),
  };
}
