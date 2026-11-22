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
}

export function makeSwell(seed: number): SwellComponent[] {
  return WAVES.components.map((c, i) => ({
    amp: c.amp,
    omega: (2 * Math.PI) / c.period,
    phase: hash2(i, 17, seed) * Math.PI * 2,
  }));
}

/** Surface elevation of the swell at the offshore boundary. */
export function swellAt(t: number, comps: SwellComponent[], ampScale = 1): number {
  let s = 0;
  for (const c of comps) s += c.amp * Math.sin(c.omega * t + c.phase);
  return s * ampScale;
}

export function tideAt(t: number, enabled = true): number {
  if (!enabled) return 0;
  return WAVES.tideAmp * Math.sin((2 * Math.PI * t) / WAVES.tidePeriod);
}
