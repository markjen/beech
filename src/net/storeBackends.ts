import type { Account } from './account';
import { ApiError, NeighborApi } from './account';
import { LOCAL_BEACH, type StoreBackend } from './beachStore';
import { loadLocalBeach, saveLocalBeach } from './localStore';

/**
 * Where the BeachStore's beaches come from (docs/BEACH_STORE.md): yours by
 * id from your account, anyone else's by code from the shore, and the
 * signed-out / sandbox beach from this device (`saveLocal`: the sandbox keeps
 * it between visits; a signed-out production app doesn't).
 */
export function beachBackend(account: Account | null, opts: { saveLocal: boolean; fresh?: boolean }): StoreBackend {
  const shore = account ? new NeighborApi(account) : null;
  return {
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
}
