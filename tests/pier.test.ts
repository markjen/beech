// The pier's shape against the beach it stands on (docs/PIERS.md).
import { describe, expect, it } from 'vitest';
import { GRID_TIERS, PIER, PROFILE, WAVES, WORLD_SIZE_Z } from '../src/config';
import { pierGeometry } from '../src/render/pier';
import { BeachSim } from '../src/sim/beachSim';
import { restHeight } from '../src/sim/profile';
import { swellAt } from '../src/sim/waves';

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

  // Big real tides and storm waves (PIERS.md): the highest the sim's tide goes
  // (diorama() tops out at 0.3 m), the strongest waves (surf on a beach with
  // the biggest real swell), and a day's worst set at the offshore edge. The
  // water under the deck must stay below its underside: the pier isn't in the
  // simulation, so water above it would show through the planks.
  it('stays above the water in a storm at the highest tide', () => {
    const scale = WAVES.levels.surf * WAVES.maxScale;
    const sim = new BeachSim(GRID_TIERS.low, 5, { waveLevel: WAVES.levels.surf, erosion: false, healing: false, seep: false });
    let worstT = 0;
    let worst = -Infinity;
    for (let t = 0; t < 86400; t += 0.25) {
      const v = swellAt(t, sim.swell, scale);
      if (v > worst) [worst, worstT] = [v, t];
    }
    expect(worst).toBeGreaterThan(1.4); // a real storm set
    sim.setSea(0.3, WAVES.maxScale);
    sim.waveMul = WAVES.levels.surf;
    sim.time = worstT - 40;
    const { dx, nx } = sim;
    const cx = nx / 2;
    let highest = -Infinity;
    for (let s = 0; s < 55 * 30; s++) {
      sim.step(1 / 30);
      for (let y = Math.floor(PIER.endY / dx); y <= Math.ceil(PIER.rampTopY / dx); y++) {
        for (let x = Math.floor(cx - PIER.width / 2 / dx); x <= Math.ceil(cx + PIER.width / 2 / dx); x++) {
          const k = y * nx + x;
          if (sim.water[k] > 0.01) highest = Math.max(highest, sim.sand[k] + sim.water[k]);
        }
      }
    }
    expect(highest).toBeGreaterThan(1); // the set did reach the pier
    expect(highest).toBeLessThan(PIER.deckHeight - PIER.deckThickness - 0.1);
  }, 60000);
});
