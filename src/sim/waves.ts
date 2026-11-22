import { WAVES } from '../config';
import { hash2 } from './profile';

/**
 * The swell is a pure function of time so that the simulation (which uses it
 * as the offshore boundary), the decorative far ocean (shader) and the audio
 * (which plays a wash on each crest) all agree without talking to each other.
 */
export interface SwellComponent {
  amp: number;
  omega: number;
  phase: number;
  /** alongshore wavenumber (rad/m): crests arriving at an angle */
  k: number;
}

interface Group {
  amp: number;
  omega: number;
  phase: number;
}

/** The swell: a few components, and the slow groups that make sets. */
export type Swell = SwellComponent[] & { groups: Group[]; bigSet: Group & { sharpness: number } };

export function makeSwell(seed: number): Swell {
  const comps = WAVES.components.map((c, i) => {
    const omega = (2 * Math.PI) / c.period;
    const angle = (hash2(i, 29, seed) * 2 - 1) * WAVES.maxAngle;
    return { amp: c.amp, omega, phase: hash2(i, 17, seed) * Math.PI * 2, k: (omega / WAVES.farSpeed) * Math.sin(angle) };
  });
  const groups = WAVES.groups.map((g, i) => ({ amp: g.amp, omega: (2 * Math.PI) / g.period, phase: hash2(i, 41, seed) * Math.PI * 2 }));
  const b = WAVES.bigSet;
  const bigSet = { amp: b.amp, omega: (2 * Math.PI) / b.period, phase: hash2(3, 43, seed) * Math.PI * 2, sharpness: b.sharpness };
  return Object.assign(comps, { groups, bigSet });
}

/**
 * How big the swell is right now relative to its average (about 0.4 in a
 * quiet spell, up to about 2 in a big set). Slow: periods of minutes.
 */
export function swellEnvelope(t: number, sw: Swell): number {
  let e = 1;
  for (const g of sw.groups) e += g.amp * Math.sin(g.omega * t + g.phase);
  const b = sw.bigSet;
  e += b.amp * Math.pow(Math.max(0, Math.sin(b.omega * t + b.phase)), b.sharpness);
  return Math.max(0.35, e);
}

/** Surface elevation of the swell at the offshore boundary, at world x (m along the shore). */
export function swellAt(t: number, sw: Swell, ampScale = 1, x = 0): number {
  let s = 0;
  for (const c of sw) s += c.amp * Math.sin(c.omega * t - c.k * x + c.phase);
  return s * ampScale * swellEnvelope(t, sw);
}

export function tideAt(t: number, enabled = true): number {
  if (!enabled) return 0;
  return WAVES.tideAmp * Math.sin((2 * Math.PI * t) / WAVES.tidePeriod);
}
