import { describe, expect, it } from 'vitest';
import { WAVES } from '../src/config';
import { makeSwell, swellAt, swellEnvelope } from '../src/sim/waves';
import { BeachSim } from '../src/sim/beachSim';
import { GRID_TIERS } from '../src/config';

describe('varied waves', () => {
  it('come in sets: quiet spells and bigger sets, now and then a big one', () => {
    const sw = makeSwell(3);
    let lo = Infinity;
    let hi = -Infinity;
    for (let t = 0; t < 3600; t += 1) {
      const e = swellEnvelope(t, sw);
      lo = Math.min(lo, e);
      hi = Math.max(hi, e);
    }
    expect(lo).toBeLessThan(0.7);
    expect(hi).toBeGreaterThan(1.6);
    expect(lo).toBeGreaterThanOrEqual(0.35);
  });

  it('arrive at an angle: the surface differs along the shore, and each seed differs', () => {
    const sw = makeSwell(5);
    expect(sw.some((c) => Math.abs(c.k) > 0.01)).toBe(true);
    for (const c of sw) expect(Math.abs(c.k)).toBeLessThanOrEqual((c.omega / WAVES.farSpeed) * Math.sin(WAVES.maxAngle) + 1e-9);
    let spread = 0;
    for (let t = 0; t < 30; t += 0.5) spread = Math.max(spread, Math.abs(swellAt(t, sw, 1, -16) - swellAt(t, sw, 1, 16)));
    expect(spread).toBeGreaterThan(0.05);
    const other = makeSwell(6);
    expect(other.map((c) => c.k)).not.toEqual(sw.map((c) => c.k));
  });

  it('the sim boundary is the same swell the ocean shader draws, column by column', () => {
    const sim = new BeachSim(GRID_TIERS.low, 2, { erosion: false, healing: false, seep: false, tide: false });
    for (let s = 0; s < 30; s++) sim.step(1 / 30);
    for (const x of [-15, 0, 12.5]) expect(sim.seaLevel(sim.time, x)).toBeCloseTo(swellAt(sim.time, sim.swell, 1, x), 9);
    // and the forced first row really does vary along the shore
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < sim.nx; i++) {
      const h = sim.sand[i] + sim.water[i];
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(hi - lo).toBeGreaterThan(0.02);
  });
});
