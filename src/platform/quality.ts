import type { QualityTier } from '../config';

/**
 * Pick the sim grid from a short benchmark of the smallest grid (run once on
 * first launch, then remembered). Medium costs ~1.8x low and high ~2.8x, and
 * a tick must stay well under the 33 ms budget even on a busy phone. The high
 * tier is desktop-only (touch devices would spend the battery for little gain).
 */
export function tierFromBench(msPerTickLow: number, touch: boolean, allowTouchHigh = false): QualityTier {
  if (msPerTickLow < 1.6 && (!touch || allowTouchHigh)) return 'high';
  if (msPerTickLow < 4.5) return 'medium';
  return 'low';
}
