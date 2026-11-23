import { describe, expect, it } from 'vitest';
import { BeachSim } from '../src/sim/beachSim';
import { BRUSH, GRID_TIERS } from '../src/config';
import { PROFILE } from '../src/config';

const grid = GRID_TIERS.low;
const DT = 1 / 30;

function sandPlusSediment(sim: BeachSim): number {
  let s = 0;
  for (let k = 0; k < sim.n; k++) s += sim.sand[k] + sim.sediment[k];
  return s;
}

function waterSum(sim: BeachSim): number {
  let s = 0;
  for (let k = 0; k < sim.n; k++) s += sim.water[k];
  return s;
}

describe('water', () => {
  it('conserves water with a closed boundary', () => {
    const sim = new BeachSim(grid, 3, { closed: true, erosion: false, healing: false, seep: false });
    // drop a blob of water on the dry beach
    for (let j = 100; j < 110; j++) for (let i = 90; i < 100; i++) sim.water[j * sim.nx + i] += 0.3;
    const w0 = waterSum(sim);
    for (let s = 0; s < 150; s++) sim.step(DT);
    expect(Math.abs(waterSum(sim) - w0) / w0).toBeLessThan(1e-4);
  });

  it('stays finite and runs up the beach with waves on', () => {
    const sim = new BeachSim(grid, 1);
    let maxRun = 0;
    for (let s = 0; s < 30 * 25; s++) {
      sim.step(DT);
      for (let j = sim.ny - 1; j >= 0; j--) {
        if (sim.water[j * sim.nx + (sim.nx >> 1)] > 0.01) {
          maxRun = Math.max(maxRun, j * sim.dx);
          break;
        }
      }
    }
    for (let k = 0; k < sim.n; k++) {
      expect(Number.isFinite(sim.water[k])).toBe(true);
      expect(Number.isFinite(sim.sand[k])).toBe(true);
    }
    // swash runs up past the still shoreline, but not over the back of the beach
    expect(maxRun).toBeGreaterThan(PROFILE.shoreline + 1.5);
    expect(maxRun).toBeLessThan(PROFILE.shoreline + 11.5);
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

describe('sand', () => {
  it('conserves sand through erosion, transport and slumping', () => {
    const sim = new BeachSim(grid, 2, { closed: false, healing: false, seep: false });
    // a steep sand pile in the swash zone so everything gets exercised
    const ci = 96;
    const cj = Math.round((PROFILE.shoreline + 1.5) / sim.dx); // just up the swash
    for (let j = cj - 6; j <= cj + 6; j++) for (let i = ci - 6; i <= ci + 6; i++) sim.sand[j * sim.nx + i] += 0.5;
    const s0 = sandPlusSediment(sim);
    for (let s = 0; s < 300; s++) sim.step(DT);
    // (s0 can be negative now: the sea floor offshore is below sea level)
    expect(Math.abs(sandPlusSediment(sim) - s0)).toBeLessThan(1e-2 * Math.abs(s0) + 0.05);
  });

  it('digs deeper when held still', () => {
    const sim = new BeachSim(grid, 1, { waves: false, erosion: false, healing: false, seep: false });
    const x = 16;
    const y = 20; // dry beach
    const k = Math.floor(y / sim.dx) * sim.nx + Math.floor(x / sim.dx);
    const h0 = sim.sand[k];
    sim.beginStroke(x, y, 0.4);
    for (let s = 0; s < 10; s++) sim.step(DT);
    const d1 = h0 - sim.sand[k];
    for (let s = 0; s < 30; s++) sim.step(DT);
    const d2 = h0 - sim.sand[k];
    sim.endStroke();
    expect(d1).toBeGreaterThan(0.01);
    // after holding, the rate is higher than at the start
    expect((d2 - d1) / 30).toBeGreaterThan(d1 / 10);
  });

  it('builds a rim around a dig', () => {
    const sim = new BeachSim(grid, 1, { waves: false, erosion: false, healing: false, seep: false });
    const before = sim.sand.slice();
    sim.stamp('dig', 16, 20, 0.5, 0.1);
    let removed = 0;
    let added = 0;
    for (let k = 0; k < sim.n; k++) {
      const d = sim.sand[k] - before[k];
      if (d < 0) removed -= d;
      else added += d;
    }
    expect(removed).toBeGreaterThan(0);
    expect(added / removed).toBeCloseTo(BRUSH.rimFraction, 2);
  });
});

describe('undo', () => {
  const quiet = { waves: false, erosion: false, healing: false, seep: false, closed: true };

  function dig(sim: BeachSim, x: number, y: number) {
    sim.beginStroke(x, y, 0.5);
    for (let s = 0; s < 8; s++) {
      sim.moveStroke(x + s * 0.2, y, 0.5);
      sim.step(DT);
    }
    sim.endStroke();
  }

  it('undo puts the sand back, redo re-applies it', () => {
    const sim = new BeachSim(grid, 1, quiet);
    const before = sim.sand.slice();
    dig(sim, 12, 20);
    const after = sim.sand.slice();
    expect(sim.undo.undoCount).toBe(1);
    sim.undoStroke(false);
    let maxErr = 0;
    for (let k = 0; k < sim.n; k++) maxErr = Math.max(maxErr, Math.abs(sim.sand[k] - before[k]));
    expect(maxErr).toBeLessThan(0.02);
    expect(sim.undo.redoCount).toBe(1);
    sim.redoStroke(false);
    maxErr = 0;
    for (let k = 0; k < sim.n; k++) maxErr = Math.max(maxErr, Math.abs(sim.sand[k] - after[k]));
    expect(maxErr).toBeLessThan(0.02);
  });

  it('eases undo in over a few ticks', () => {
    const sim = new BeachSim(grid, 1, quiet);
    const before = sim.sand.slice();
    dig(sim, 12, 20);
    sim.undoStroke(true);
    for (let s = 0; s < 6; s++) sim.step(DT);
    let maxErr = 0;
    for (let k = 0; k < sim.n; k++) maxErr = Math.max(maxErr, Math.abs(sim.sand[k] - before[k]));
    expect(maxErr).toBeLessThan(0.03);
  });

  it('cancel restores the exact pre-stroke sand and records nothing', () => {
    const sim = new BeachSim(grid, 1, quiet);
    const before = sim.sand.slice();
    sim.beginStroke(12, 20, 0.5);
    for (let s = 0; s < 4; s++) sim.step(DT);
    sim.cancelStroke();
    expect(sim.undo.undoCount).toBe(0);
    let same = true;
    for (let k = 0; k < sim.n; k++) if (Math.abs(sim.sand[k] - before[k]) > 1e-3) same = false;
    expect(same).toBe(true);
  });

  it('reset is undoable', () => {
    const sim = new BeachSim(grid, 1, quiet);
    dig(sim, 12, 20);
    const dug = sim.sand.slice();
    sim.resetBeach();
    sim.undoStroke(false);
    let maxErr = 0;
    for (let k = 0; k < sim.n; k++) maxErr = Math.max(maxErr, Math.abs(sim.sand[k] - dug[k]));
    expect(maxErr).toBeLessThan(1e-4);
  });
});

describe('determinism', () => {
  it('same seed + same input gives the same fields', () => {
    const run = () => {
      const sim = new BeachSim(grid, 7);
      for (let s = 0; s < 90; s++) {
        if (s === 10) sim.beginStroke(10, 11, 0.4);
        if (s > 10 && s < 40) sim.moveStroke(10 + s * 0.05, 11, 0.4);
        if (s === 40) sim.endStroke();
        sim.step(DT);
      }
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});

describe('erosion', () => {
  it('waves wear down a mound in the swash zone and fill a pit', () => {
    const sim = new BeachSim(grid, 1);
    for (let s = 0; s < 8; s++) sim.stamp('pile', 12, 9.5, 0.6, 0.05);
    for (let s = 0; s < 8; s++) sim.stamp('dig', 20, 9.5, 0.5, 0.05);
    const extreme = (x: number, sign: number) => {
      let m = -Infinity;
      for (let j = Math.floor(9 / sim.dx); j < 10 / sim.dx; j++)
        for (let i = Math.floor((x - 0.5) / sim.dx); i < (x + 0.5) / sim.dx; i++) {
          const k = j * sim.nx + i;
          m = Math.max(m, sign * (sim.sand[k] - sim.rest[k]));
        }
      return m;
    };
    const mound0 = extreme(12, 1);
    const pit0 = extreme(20, -1);
    for (let s = 0; s < 30 * 60; s++) sim.step(DT);
    expect(extreme(12, 1)).toBeLessThan(mound0 * 0.6);
    expect(extreme(20, -1)).toBeLessThan(pit0 * 0.5);
  });

  it('leaves the untouched beach (nearly) as it was', () => {
    const sim = new BeachSim(grid, 1);
    for (let s = 0; s < 30 * 60; s++) sim.step(DT);
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

describe('stability', () => {
  it('has no growing checkerboard mode near the offshore boundary', () => {
    const sim = new BeachSim(grid, 1, { erosion: false, healing: false, seep: false });
    let worst = 0;
    for (let s = 0; s < 30 * 20; s++) {
      sim.step(DT);
      if (s < 150) continue;
      for (let j = 1; j < 20; j++)
        for (let i = 1; i < sim.nx - 1; i++) {
          const k = j * sim.nx + i;
          const e = (q: number) => sim.sand[q] + sim.water[q];
          worst = Math.max(worst, Math.abs(e(k) - 0.25 * (e(k - 1) + e(k + 1) + e(k - sim.nx) + e(k + sim.nx))));
        }
    }
    expect(worst).toBeLessThan(0.05);
  });
});

describe('bulldozer', () => {
  it('pushes the sand back to the untouched beach along its path, leaves rocks alone, and undoes', () => {
    const sim = new BeachSim(grid, 1, { waves: false, erosion: false, healing: false, seep: false });
    const y = PROFILE.shoreline + 10; // dry beach
    // a dug hole and a pile, plus a rock
    sim.stamp('dig', 10, y, 0.6, 0.4);
    sim.stamp('pile', 14, y, 0.6, 0.5);
    const rock = sim.placeObject({ kind: 'rock', item: 'rock', x: 18, y, angle: 0, size: 0.5, variant: 1 });
    // mean |sand - rest| along the blade's path (sand from outside can slump back in a little)
    const off = (x: number) => {
      let m = 0;
      let n = 0;
      for (let j = Math.floor((y - 0.4) / sim.dx); j <= Math.ceil((y + 0.4) / sim.dx); j++)
        for (let i = Math.floor((x - 0.6) / sim.dx); i <= Math.ceil((x + 0.6) / sim.dx); i++) {
          const k = j * sim.nx + i;
          m += Math.abs(sim.sand[k] - sim.rest[k]);
          n++;
        }
      return m / n;
    };
    expect(off(10)).toBeGreaterThan(0.03);
    expect(off(14)).toBeGreaterThan(0.03);
    const rk = Math.floor(y / sim.dx) * sim.nx + Math.floor(18 / sim.dx);
    const rockTop = sim.sand[rk];
    // drive the bulldozer along the row, over the rock too
    sim.beginStroke(8, y, 0.5, 'flatten');
    for (let s = 0; s <= 60; s++) {
      sim.moveStroke(8 + s * 0.2, y, 0.5);
      sim.step(DT);
    }
    sim.endStroke();
    expect(off(10)).toBeLessThan(0.004);
    expect(off(14)).toBeLessThan(0.004);
    expect(sim.sand[rk]).toBeCloseTo(rockTop, 4);
    expect(sim.objects.count).toBe(1);
    expect(rock.id).toBeGreaterThan(0);
    // finite everywhere, and one undo brings the hole and pile back
    for (let k = 0; k < sim.n; k++) expect(Number.isFinite(sim.sand[k])).toBe(true);
    sim.undoStroke(false);
    expect(off(10)).toBeGreaterThan(0.03);
    expect(off(14)).toBeGreaterThan(0.03);
  });
});

describe('packed sand (building in the sea)', () => {
  const NOT_PACKED = -1e5; // anything below this is unpacked
  const X = 16;
  const Y = PROFILE.shoreline - 3.5; // about 0.75 m of water

  /** hold the build tool still at (X, Y) */
  function build(sim: BeachSim, secs: number, x = X, y = Y) {
    sim.beginStroke(x, y, 0.66, 'pile');
    for (let s = 0; s < secs * 30; s++) sim.step(DT);
    sim.endStroke();
  }
  /** highest sand within 0.5 m of (x, y), above mean sea level */
  function top(sim: BeachSim, x = X, y = Y) {
    let t = -99;
    const ci = Math.floor(x / sim.dx);
    const cj = Math.floor(y / sim.dx);
    const r = Math.ceil(0.5 / sim.dx);
    for (let j = cj - r; j <= cj + r; j++)
      for (let i = ci - r; i <= ci + r; i++) t = Math.max(t, sim.sand[j * sim.nx + i]);
    return t - sim.meanLevel();
  }
  function packedCells(sim: BeachSim) {
    let c = 0;
    for (let k = 0; k < sim.n; k++) if (sim.packed[k] > NOT_PACKED) c++;
    return c;
  }

  it('a pile built out of the sea stays up; the same pile unpacked washes away', () => {
    const sim = new BeachSim(grid, 1);
    for (let s = 0; s < 60; s++) sim.step(DT);
    build(sim, 30);
    expect(top(sim)).toBeGreaterThan(0.4);
    expect(packedCells(sim)).toBeGreaterThan(50);
    // a twin with the packing taken away
    const twin = new BeachSim(grid, 1);
    for (let s = 0; s < 60; s++) twin.step(DT);
    build(twin, 30);
    twin.packed.fill(-1e6);
    for (let s = 0; s < 75 * 30; s++) {
      sim.step(DT);
      twin.step(DT);
    }
    for (const a of [sim.sand, sim.water, twin.sand]) for (let k = 0; k < sim.n; k += 97) expect(Number.isFinite(a[k])).toBe(true);
    expect(top(sim)).toBeGreaterThan(0.3); // still well out of the water
    expect(top(twin)).toBeLessThan(0); // gone under
    // and the sand never sinks below its packed floor
    let below = 0;
    for (let k = 0; k < sim.n; k++) below = Math.max(below, sim.packed[k] - sim.sand[k]);
    expect(below).toBeLessThan(1e-4);
  }, 60000);

  it('conserves sand while the waves work on a packed pile', () => {
    const sim = new BeachSim(grid, 2, { healing: false, seep: false });
    build(sim, 20);
    const s0 = sandPlusSediment(sim);
    for (let s = 0; s < 300; s++) sim.step(DT);
    expect(Math.abs(sandPlusSediment(sim) - s0)).toBeLessThan(1e-2 * Math.abs(s0) + 0.05);
  });

  it('only packs in the sea, not on the dry beach', () => {
    const sim = new BeachSim(grid, 1, { waves: false, erosion: false, healing: false, seep: false });
    build(sim, 3, X, PROFILE.shoreline + 6);
    expect(packedCells(sim)).toBe(0);
    build(sim, 3);
    expect(packedCells(sim)).toBeGreaterThan(0);
  });

  it('undo takes the packing away with the sand, redo brings both back', () => {
    const sim = new BeachSim(grid, 1, { waves: false, erosion: false, healing: false, seep: false, closed: true });
    const before = sim.sand.slice();
    build(sim, 4);
    const after = sim.sand.slice();
    const packedAfter = packedCells(sim);
    expect(packedAfter).toBeGreaterThan(0);
    sim.undoStroke(true);
    for (let s = 0; s < 8; s++) sim.step(DT);
    let maxErr = 0;
    for (let k = 0; k < sim.n; k++) maxErr = Math.max(maxErr, Math.abs(sim.sand[k] - before[k]));
    expect(maxErr).toBeLessThan(0.03);
    expect(packedCells(sim)).toBe(0);
    sim.redoStroke(true);
    for (let s = 0; s < 8; s++) sim.step(DT);
    maxErr = 0;
    for (let k = 0; k < sim.n; k++) maxErr = Math.max(maxErr, Math.abs(sim.sand[k] - after[k]));
    expect(maxErr).toBeLessThan(0.03);
    expect(packedCells(sim)).toBe(packedAfter);
  });

  it('the bulldozer and reset clear packing; dig cuts into it; a reload packs again', () => {
    const sim = new BeachSim(grid, 1, { waves: false, erosion: false, healing: false, seep: false, closed: true });
    build(sim, 4);
    const k = Math.floor(Y / sim.dx) * sim.nx + Math.floor(X / sim.dx);
    const h = sim.sand[k];
    // dig into the packed pile
    sim.stamp('dig', X, Y, 0.4, 0.1);
    expect(sim.sand[k]).toBeLessThan(h - 0.05);
    expect(sim.packed[k]).toBeLessThanOrEqual(sim.sand[k]);
    // a reload packs the raised sea floor again
    const saved = sim.sandDelta();
    const re = new BeachSim(grid, 1, { waves: false, erosion: false, healing: false, seep: false, closed: true });
    re.loadDelta(saved);
    expect(re.packed[k]).toBeCloseTo(re.sand[k], 4);
    // bulldozer
    sim.beginStroke(X - 1.5, Y, 0.6, 'flatten');
    for (let s = 0; s <= 15; s++) {
      sim.moveStroke(X - 1.5 + s * 0.2, Y, 0.6);
      sim.step(DT);
    }
    sim.endStroke();
    expect(sim.packed[k]).toBeLessThan(NOT_PACKED);
    expect(Math.abs(sim.sand[k] - sim.rest[k])).toBeLessThan(0.05);
    // reset
    re.resetBeach();
    expect(packedCells(re)).toBe(0);
    re.undoStroke(false);
    expect(re.packed[k]).toBeCloseTo(re.sand[k], 4);
  });
});
