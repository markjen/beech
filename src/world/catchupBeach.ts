// The server's catch-up of a saved beach (docs/LIVE_SIM.md, section 3): the
// saved bytes in, the beach as the sea left it out, at the beach's own place
// (its real tide and swell).
//
// The server can't import src/ (it's a separate package), so
// scripts/bundle-server.mjs bundles this file into
// server/src/generated/catchup.ts. One source: `tests/bundleServer.test.ts`
// fails if the bundle is out of date (npm run bundle:server).

import { CATCHUP } from '../config';
import { catchUp } from '../sim/catchup';
import { decodeSand, encodeSand, fitWorld } from '../sim/sandCodec';
import { diorama } from './live';
import { beachById } from './locations';
import { tideHeight } from './tides';

// Saves and catch-up use the same object validation as the app's decoder.
export { sanitizeObjects } from '../sim/sandCodec';

export interface SavedCatchUp {
  /** the beach as the sea left it (sandCodec format) */
  bytes: Uint8Array;
  nx: number;
  ny: number;
  /** did anything change at all (sand, things lost, strays brought in) */
  changed: boolean;
  /** item ids of the owned things the sea took (back in the bag) */
  lost: string[];
  broughtIn: number;
  highTides: number;
  /** m³ */
  sandMoved: number;
  /** the part of the gap that was simulated */
  from: number;
  to: number;
}

/** The catch-up's defaults, for the server (its env can override the cap). */
export const CATCHUP_DEFAULTS = { ...CATCHUP };

/**
 * Catch a saved beach up from `from` to `to` (ms). Null when its place is
 * unknown (nothing to take the tide from).
 */
export async function catchUpSaved(
  bytes: Uint8Array,
  location: string,
  from: number,
  to: number,
  maxGapDays: number = CATCHUP.maxGapDays,
): Promise<SavedCatchUp | null> {
  const place = beachById(location);
  if (!place) return null;
  const saved = fitWorld(await decodeSand(bytes));
  const out = catchUp({
    nx: saved.nx,
    ny: saved.ny,
    delta: saved.delta,
    objects: saved.objects,
    tide: (ms) => diorama(tideHeight(place.tide, new Date(ms))),
    waves: place.waves,
    from,
    to,
    maxGapDays,
  });
  const changed = out.sandMoved > 1e-6 || out.lost.length > 0 || out.broughtIn > 0;
  return {
    // the sand piled on buried rocks (BCH3) is kept as it was: the catch-up
    // works on the sand around them
    bytes: changed ? await encodeSand(out.delta, saved.nx, saved.ny, out.objects, saved.cover) : bytes,
    nx: saved.nx,
    ny: saved.ny,
    changed,
    lost: out.lost.map((o) => o.item),
    broughtIn: out.broughtIn,
    highTides: out.highTides,
    sandMoved: out.sandMoved,
    from: out.from,
    to: out.to,
  };
}
