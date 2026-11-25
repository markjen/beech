import { GRID_TIERS, PROFILE } from '../src/config';
import { buildRestProfile } from '../src/sim/profile';

export const g = GRID_TIERS.low;
export const rest = buildRestProfile(g, 1);

/** A delta with a round castle (radius r m, h m tall) centred at (x, y) sim metres. */
export function castle(delta: Float32Array, x: number, y: number, r = 1, h = 0.5): void {
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const d = Math.hypot((i + 0.5) * g.dx - x, (j + 0.5) * g.dx - y);
      if (d < r) delta[j * g.nx + i] += h * Math.min(1, (r - d) / 0.3);
    }
  }
}

/** Highest sand above rest within r of (x, y). */
export function peak(delta: Float32Array, x: number, y: number, r = 1): number {
  let m = 0;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      if (Math.hypot((i + 0.5) * g.dx - x, (j + 0.5) * g.dx - y) < r) m = Math.max(m, delta[j * g.nx + i]);
    }
  }
  return m;
}

/** A semi-diurnal diorama tide, ±amp m. */
export const tide = (amp = 0.25) => (ms: number) => amp * Math.sin((2 * Math.PI * ms) / (12.42 * 3600000));

/** the still-water shoreline, from the offshore edge (m) */
export const SHORE = PROFILE.shoreline;
