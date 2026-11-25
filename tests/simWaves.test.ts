import { beforeAll, describe, expect, it } from 'vitest';
import { BeachSim } from '../src/sim/beachSim';
import { GRID_TIERS, PROFILE, WAVES } from '../src/config';

const grid = GRID_TIERS.low;
const DT = 1 / 30;

function sandPlusSediment(sim: BeachSim): number {
  let s = 0;
  for (let k = 0; k < sim.n; k++) s += sim.sand[k] + sim.sediment[k];
  return s;
}

describe('untouched beach with waves', () => {
  let sim!: BeachSim;
  let maxRun25s = 0;
  let finiteAt25s = true;

  beforeAll(async () => {
    sim = new BeachSim(grid, 1);
    for (let s = 0; s < 30 * 60; s++) {
      if (s % 150 === 0) await new Promise((r) => setTimeout(r, 0));
      sim.step(DT);
      if (s < 30 * 25) {
        for (let j = sim.ny - 1; j >= 0; j--) {
          if (sim.water[j * sim.nx + (sim.nx >> 1)] > 0.01) {
            maxRun25s = Math.max(maxRun25s, j * sim.dx);
            break;
          }
        }
        if (s === 30 * 25 - 1) {
          for (let k = 0; k < sim.n; k++) {
            if (!Number.isFinite(sim.water[k]) || !Number.isFinite(sim.sand[k])) {
              finiteAt25s = false;
              break;
            }
          }
        }
      }
    }
  });

  it('stays finite and runs up the beach with waves on', () => {
    expect(finiteAt25s).toBe(true);
    // swash runs up past the still shoreline, but not over the back of the beach
    expect(maxRun25s).toBeGreaterThan(PROFILE.shoreline + 1.5);
    expect(maxRun25s).toBeLessThan(PROFILE.shoreline + 11.5);
  });

  it('leaves the untouched beach (nearly) as it was', () => {
    let sum = 0;
    let max = 0;
    for (let k = 0; k < sim.n; k++) {
      const d = Math.abs(sim.sand[k] - sim.rest[k]);
      sum += d;
      max = Math.max(max, d);
    }
    expect(sum / sim.n).toBeLessThan(0.005);
    expect(max).toBeLessThan(0.12);
  });
});

describe('deep water', () => {
  it('stays smooth with the lighter offshore damping (no checkerboard), and keeps its waves', async () => {
    const sim = new BeachSim(grid, 4);
    let swing = 0;
    for (let s = 0; s < 30 * 60; s++) {
      if (s % 150 === 0) await new Promise((r) => setTimeout(r, 0));
      sim.step(DT);
    }
    // cell-to-cell roughness of the water surface over the deep sea (away from the forced rows)
    let rough = 0;
    let n = 0;
    const j0 = 12;
    const j1 = Math.floor((PROFILE.shoreline - 4) / sim.dx);
    for (let j = j0; j < j1; j++) {
      for (let i = 1; i < sim.nx - 1; i++) {
        const k = j * sim.nx + i;
        const h = (k2: number) => sim.sand[k2] + sim.water[k2];
        rough = Math.max(rough, Math.abs(h(k) - 0.5 * (h(k - 1) + h(k + 1))));
        n++;
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(rough).toBeLessThan(0.02);
    // and there are still waves out there: the surface moves at mid-sea
    const k = Math.floor((PROFILE.shoreline / 2) / sim.dx) * sim.nx + (sim.nx >> 1);
    let lo = Infinity;
    let hi = -Infinity;
    for (let s = 0; s < 30 * 12; s++) {
      sim.step(DT);
      const h = sim.sand[k] + sim.water[k];
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    swing = hi - lo;
    expect(swing).toBeGreaterThan(0.15);
  });
});

describe('wave strength (calm · gentle · lively · surf)', () => {
  it('eases the swell toward the chosen level, stays finite at surf, and conserves sand', () => {
    const surf = new BeachSim(grid, 5, { waveLevel: WAVES.levels.surf, healing: false, seep: false });
    const calm = new BeachSim(grid, 5, { waveLevel: WAVES.levels.calm, healing: false, seep: false });
    const s0 = sandPlusSediment(surf);
    // a moment in: still easing (no jolt), then settled at the level
    surf.step(DT);
    expect(surf.waveMul).toBeGreaterThan(1);
    expect(surf.waveMul).toBeLessThan(WAVES.levels.surf);
    const run = { surf: 0, calm: 0 };
    for (let s = 0; s < 30 * 20; s++) {
      surf.step(DT);
      calm.step(DT);
      for (const [name, sim] of [['surf', surf], ['calm', calm]] as const) {
        for (let j = sim.ny - 1; j >= 0; j--) {
          if (sim.water[j * sim.nx + (sim.nx >> 1)] > 0.01) {
            run[name] = Math.max(run[name], j * sim.dx);
            break;
          }
        }
      }
    }
    expect(surf.waveMul).toBeCloseTo(WAVES.levels.surf, 2);
    expect(calm.waveMul).toBeCloseTo(WAVES.levels.calm, 2);
    for (let k = 0; k < surf.n; k++) {
      expect(Number.isFinite(surf.water[k])).toBe(true);
      expect(Number.isFinite(surf.sand[k])).toBe(true);
    }
    // surf runs further up the beach than calm, and still not over the back
    expect(run.surf).toBeGreaterThan(run.calm);
    expect(run.surf).toBeLessThan(PROFILE.shoreline + 13);
    // open boundary: sand only moves around (allow the usual transport tolerance)
    expect(Math.abs(sandPlusSediment(surf) - s0)).toBeLessThan(1e-2 * Math.abs(s0) + 0.1);
  });
});
