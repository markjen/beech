// The pier's shape against the beach it stands on (docs/PIERS.md).
import { describe, expect, it } from 'vitest';
import { PIER, PROFILE, WAVES, WORLD_SIZE_Z } from '../src/config';
import { pierGeometry } from '../src/render/pier';
import { restHeight } from '../src/sim/profile';

const ORIGIN_Z = -WORLD_SIZE_Z / 2;

describe('pier', () => {
  const g = pierGeometry();
  const zs = (P: number[]) => P.filter((_, i) => i % 3 === 2);
  const ys = (P: number[]) => P.filter((_, i) => i % 3 === 1);

  it('runs from world Z +5 on the sand to -13 over the water, centred on the beach', () => {
    const z = zs(g.deck.P);
    expect(Math.max(...z)).toBeCloseTo(PIER.landY + ORIGIN_Z, 0);
    expect(Math.min(...z)).toBeCloseTo(PIER.endY + ORIGIN_Z, 1);
    const x = g.deck.P.filter((_, i) => i % 3 === 0);
    expect(Math.max(...x) + Math.min(...x)).toBeCloseTo(0, 6);
  });

  it('starts on dry sand and reaches well past the still-water shoreline', () => {
    expect(PIER.landY).toBeGreaterThan(PROFILE.shoreline + 2);
    expect(PROFILE.shoreline - PIER.endY).toBeGreaterThan(12);
    // the ramp's foot sits on the sand (within a hand's width) across the beach's cusps
    for (const x of [14, 16, 18]) expect(Math.abs(restHeight(x, PIER.landY) - PIER.footHeight)).toBeLessThan(0.15);
  });

  it('keeps its deck above the tide', () => {
    expect(Math.max(...ys(g.deck.P))).toBeCloseTo(PIER.deckHeight, 6);
    expect(PIER.deckHeight - PIER.deckThickness).toBeGreaterThan(WAVES.tideAmp * 4);
  });

  it('plants its pilings below the seabed at the far end', () => {
    expect(Math.min(...ys(g.pilings.P))).toBeLessThan(restHeight(16, PIER.endY));
  });
});
