// Live beaches (docs/LIVE_SIM.md): the sea keeps working while nobody has a
// beach open. When a beach is read (by its owner, a neighbor, a visitor) and
// it hasn't been simulated for a while, the server catches it up first: the
// coarse catch-up model from src/sim/catchup.ts, bundled into
// ./generated/catchup.ts, run at the beach's place.
//
// - Not while the owner's app has it open (`here_until`): that app is
//   simulating it already.
// - Compare-and-set on `version`: two readers at once compute the same thing,
//   one write lands, the other reader serves it.
// - The epoch goes up, so a device still holding the old sand reloads
//   instead of saving it back over the sea's work (as after a restore).
// - A long gap first keeps the beach as its "Before the tide" checkpoint.
import { catchUpSaved as catchUpRaw, CATCHUP_DEFAULTS } from './generated/catchup.js';
import { BadBlob, inspectBlob } from './checkpoints.js';
import type { Db } from './db.js';
import { toBytes } from './db.js';

export interface SavedCatchUp {
  bytes: Uint8Array;
  nx: number;
  ny: number;
  changed: boolean;
  lost: string[];
  broughtIn: number;
  highTides: number;
  sandMoved: number;
  from: number;
  to: number;
}

/** src/world/catchupBeach.ts, typed (the bundle is plain JS) */
export const catchUpSaved = catchUpRaw as (
  bytes: Uint8Array,
  location: string,
  from: number,
  to: number,
  maxGapDays?: number,
) => Promise<SavedCatchUp | null>;

const DEFAULTS = CATCHUP_DEFAULTS as { minGapMin: number; maxGapDays: number; tideCheckpointGapH: number };

export interface LiveConfig {
  /** most of a gap simulated (days): CATCHUP_MAX_GAP_DAYS, default 14 */
  maxGapDays: number;
  /** gaps shorter than this (ms) are left */
  minGapMs: number;
  /** gaps longer than this (ms) keep a "Before the tide" checkpoint first */
  tideCheckpointGapMs: number;
}

/** The config from the environment (CATCHUP_MAX_GAP_DAYS), falling back to src/config.ts. */
export function liveConfig(env: Record<string, string | undefined> = process.env): LiveConfig {
  const days = Number(env.CATCHUP_MAX_GAP_DAYS);
  return {
    maxGapDays: Number.isFinite(days) && days > 0 ? Math.min(days, 365) : DEFAULTS.maxGapDays,
    minGapMs: DEFAULTS.minGapMin * 60000,
    tideCheckpointGapMs: DEFAULTS.tideCheckpointGapH * 3600000,
  };
}

/** how long a heartbeat from the owner's app keeps catch-ups off (it beats every 20 s) */
export const HERE_MS = 45000;
/** how long a viewer's read or poll counts as someone watching (they poll every 5 s) */
export const VIEW_MS = 15000;
/** "while you were away" events are kept this long */
const EVENTS_KEPT_MS = 30 * 86400000;
export const TIDE_CHECKPOINT_NAME = 'Before the tide';

interface BeachRow {
  owner_id: string;
  name: string;
  location: string | null;
  version: number;
  updated_at: string | null;
  simulated_until: string | null;
  here_until: string | null;
  owner_seen_at: string | null;
  sand: unknown;
}

export type CatchUpOutcome = 'none' | 'here' | 'recent' | 'unchanged' | 'caught-up' | 'raced' | 'failed';

export function createLiveBeaches(db: Db, now: () => number, cfg: LiveConfig = liveConfig(), log: (e: Record<string, unknown>) => void = () => {}) {
  /** one catch-up per beach at a time in this instance */
  const inflight = new Map<string, Promise<CatchUpOutcome>>();

  async function run(beachId: string): Promise<CatchUpOutcome> {
    const row = (
      await db.query<BeachRow>(
        'SELECT owner_id, name, location, version, updated_at, simulated_until, here_until, owner_seen_at, sand FROM beach WHERE id = $1 AND sand IS NOT NULL',
        [beachId],
      )
    )[0];
    if (!row || !row.location) return 'none';
    const t = now();
    if (row.here_until !== null && Number(row.here_until) > t) return 'here';
    const since = Number(row.simulated_until ?? row.updated_at ?? t);
    if (t - since < cfg.minGapMs) return 'recent';
    const before = toBytes(row.sand);
    let res: SavedCatchUp | null;
    try {
      res = await catchUpSaved(before, row.location, since, t, cfg.maxGapDays);
    } catch (e) {
      // an unreadable save: leave it as it is, and don't try again until the next gap
      log({ event: 'catchup_failed', beach: beachId, error: String(e) });
      await db.query('UPDATE beach SET simulated_until = $2 WHERE id = $1 AND version = $3', [beachId, t, row.version]);
      return 'failed';
    }
    if (!res || !res.changed) {
      // nothing the water reached: the beach is as the sea would leave it
      await db.query('UPDATE beach SET simulated_until = $2 WHERE id = $1 AND version = $3', [beachId, t, row.version]);
      return 'unchanged';
    }
    let items: Record<string, number>;
    let beforeInfo: { items: Record<string, number>; objects: number } = { items: {}, objects: 0 };
    try {
      items = inspectBlob(res.bytes).items;
      beforeInfo = inspectBlob(before);
    } catch (e) {
      if (!(e instanceof BadBlob)) throw e;
      log({ event: 'catchup_failed', beach: beachId, error: e.message });
      return 'failed';
    }
    const keepBefore = t - since > cfg.tideCheckpointGapMs;
    const seenAt = Number(row.owner_seen_at ?? 0);
    // one statement: the beach, its "Before the tide" checkpoint and the event
    // all land together, and only if nobody changed the beach meanwhile.
    // Don't overwrite a "Before the tide" kept earlier during this same away
    // period (created after owner_seen_at), or repeated visitor reads would
    // replace the owner's original pre-away beach with an already-eroded one.
    const rows = await db.query<{ version: number }>(
      `WITH upd AS (
         UPDATE beach SET sand = $3, nx = $4, ny = $5, items = $6, version = version + 1, epoch = epoch + 1, simulated_until = $7
          WHERE id = $1 AND version = $2
         RETURNING id, version
       ),
       snap AS (
         INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, from_name, location, nx, ny, sand, bytes, items, objects, created_at)
         SELECT $8, $9, $10, 'tide', 'beach', $1, $11, $12, $13, $14, $15, $16, $17, $18, $7
          WHERE $19::boolean AND EXISTS (SELECT 1 FROM upd)
         ON CONFLICT (from_beach) WHERE kind = 'tide' DO UPDATE SET
           name = EXCLUDED.name, from_name = EXCLUDED.from_name, location = EXCLUDED.location, nx = EXCLUDED.nx, ny = EXCLUDED.ny,
           sand = EXCLUDED.sand, bytes = EXCLUDED.bytes, items = EXCLUDED.items, objects = EXCLUDED.objects, created_at = EXCLUDED.created_at
           WHERE checkpoints.created_at <= $25
         RETURNING id
       ),
       ev AS (
         INSERT INTO beach_events (beach_id, from_at, to_at, tides, sand_moved, lost, brought, checkpoint, created_at)
         SELECT $1, $20, $7, $21, $22, $23, $24, (SELECT id FROM snap), $7
          WHERE EXISTS (SELECT 1 FROM upd)
         RETURNING id
       )
       SELECT version, (SELECT COUNT(*) FROM ev) AS ev FROM upd`,
      [
        beachId,
        row.version,
        res.bytes,
        res.nx,
        res.ny,
        JSON.stringify(items),
        t,
        crypto.randomUUID(),
        row.owner_id,
        TIDE_CHECKPOINT_NAME,
        row.name,
        row.location,
        // the checkpoint holds the beach as it was
        ...gridOf(before),
        before,
        before.byteLength,
        JSON.stringify(beforeInfo.items),
        beforeInfo.objects,
        keepBefore,
        res.from,
        res.highTides,
        res.sandMoved,
        res.lost.length,
        res.broughtIn,
        seenAt,
      ],
    );
    if (!rows[0]) return 'raced';
    await db.query('DELETE FROM beach_events WHERE beach_id = $1 AND created_at < $2', [beachId, t - EVENTS_KEPT_MS]);
    log({ event: 'catchup', beach: beachId, hours: Math.round((t - res.from) / 360000) / 10, tides: res.highTides, lost: res.lost.length, kept: keepBefore });
    return 'caught-up';
  }

  return {
    cfg,
    /** Catch a beach up if it's due (safe to call on every read). */
    ensure(beachId: string): Promise<CatchUpOutcome> {
      const running = inflight.get(beachId);
      if (running) return running;
      const p = run(beachId).finally(() => inflight.delete(beachId));
      inflight.set(beachId, p);
      return p;
    },
    /**
     * The owner's app has the beach open: no catch-ups for a while. Returns
     * its epoch (the app reloads if that moved on) and whether anyone else is
     * watching (then the app saves every few seconds, so they see it live).
     */
    async here(beachId: string): Promise<{ epoch: number; watched: boolean } | null> {
      const t = now();
      const rows = await db.query<{ epoch: number; viewed_until: string | null }>(
        'UPDATE beach SET here_until = $2 WHERE id = $1 RETURNING epoch, viewed_until',
        [beachId, t + HERE_MS],
      );
      if (!rows[0]) return null;
      return { epoch: Number(rows[0].epoch), watched: rows[0].viewed_until !== null && Number(rows[0].viewed_until) > t };
    },
    /** Someone other than the owner is looking at this beach. */
    async viewed(beachId: string): Promise<void> {
      await db.query('UPDATE beach SET viewed_until = $2 WHERE id = $1', [beachId, now() + VIEW_MS]);
    },
    /**
     * A viewer's poll: the beach's version (fetch the sand again when it
     * changes) and whether its owner's app has it open right now (poll fast).
     * Catches it up first if it's due, like any read.
     */
    async status(beachId: string): Promise<{ version: number; updatedAt: number | null; live: boolean } | null> {
      await this.ensure(beachId);
      await this.viewed(beachId);
      const t = now();
      const rows = await db.query<{ version: number; updated_at: string | null; here_until: string | null }>(
        'SELECT version, updated_at, here_until FROM beach WHERE id = $1 AND sand IS NOT NULL',
        [beachId],
      );
      const r = rows[0];
      if (!r) return null;
      return { version: Number(r.version), updatedAt: r.updated_at === null ? null : Number(r.updated_at), live: r.here_until !== null && Number(r.here_until) > t };
    },
  };
}

export type LiveBeaches = ReturnType<typeof createLiveBeaches>;

/** nx, ny from a saved beach's header (both formats keep them at bytes 4..8) */
function gridOf(bytes: Uint8Array): [number, number] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [dv.getUint16(4, true), dv.getUint16(6, true)];
}
