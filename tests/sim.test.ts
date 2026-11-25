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
    for (let s = 0; s < 5; s++) sim.step(DT);
    const d1 = h0 - sim.sand[k];
    for (let s = 0; s < 10; s++) sim.step(DT);
    const d2 = h0 - sim.sand[k];
    sim.endStroke();
    expect(d1).toBeGreaterThan(0.01);
    // after holding, the rate is higher than at the start. Measured over the
    // first half-second only: once the hole gets deep, sand slumps back in
    // about as fast as the brush digs, so the net rate stops rising.
    expect((d2 - d1) / 10).toBeGreaterThan(d1 / 5);
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

describe('importing a beach', () => {
  it('replaces sand and objects as one undo step, undoes and redoes, and stays stable', () => {
    const sim = new BeachSim(grid, 1, { waves: false, erosion: false, healing: false, seep: false });
    const y = PROFILE.shoreline + 10;
    sim.stamp('pile', 10, y, 0.6, 0.5);
    sim.placeObject({ kind: 'rock', item: 'rock', x: 20, y, angle: 0, size: 0.5, variant: 1 });
    const before = sim.sand.slice();
    const undos = sim.undo.undoCount;
    // the import: a flat 0.3 m terrace, and two new objects
    const delta = new Float32Array(sim.n).fill(0.3);
    sim.importBeach(delta, [
      { id: 1, kind: 'flag', item: 'flag', x: 5, y, angle: 0, size: 0.4, variant: 1 },
      { id: 2, kind: 'driftwood', item: 'driftwood', x: 25, y, angle: 0, size: 1, variant: 1 },
    ]);
    expect(sim.undo.undoCount).toBe(undos + 1);
    const k = Math.floor(y / sim.dx) * sim.nx + Math.floor(10 / sim.dx);
    expect(sim.sand[k] - sim.rest[k]).toBeCloseTo(0.3, 4);
    expect(sim.objects.persisted().map((o) => o.item).sort()).toEqual(['driftwood', 'flag']);
    // a steep edge slumps a little while you look at it
    sim.importBeach(new Float32Array(sim.n).map((_, k) => (k % sim.nx > sim.nx / 2 ? 0.6 : 0)), []);
    for (let s = 0; s < 60; s++) sim.step(DT);
    sim.undoStroke(false);
    // undo: the old beach, rock included, comes back exactly (no ghost of the edge)
    sim.undoStroke(false);
    let worst = 0;
    for (let i = 0; i < sim.n; i++) worst = Math.max(worst, Math.abs(sim.sand[i] - before[i]));
    expect(worst).toBeLessThan(1e-5);
    expect(sim.objects.persisted().map((o) => o.item)).toEqual(['rock']);
    // redo: the import again
    sim.redoStroke(false);
    expect(sim.objects.count).toBe(2);
    sim.redoStroke(false);
    sim.undoStroke(false);
    expect(sim.sand[k] - sim.rest[k]).toBeCloseTo(0.3, 4);
    expect(sim.objects.count).toBe(2);
    // and the sea runs on it without blowing up
    const sim2 = new BeachSim(grid, 1);
    sim2.importBeach(delta, []);
    for (let s = 0; s < 300; s++) sim2.step(DT);
    for (let i = 0; i < sim2.n; i++) {
      expect(Number.isFinite(sim2.sand[i])).toBe(true);
      expect(Number.isFinite(sim2.water[i])).toBe(true);
    }
  });
});

describe('the water step skips dry rows above the swash', () => {
  it('still moves water high up the beach (a seeped hole), conserves it, and leaves dried rows still', () => {
    const sim = new BeachSim(grid, 2, { closed: true, waves: false, erosion: false, healing: false, seep: false });
    // a pond well above the waterline, on a flat patch so it spreads
    const j0 = Math.floor((PROFILE.shoreline + 9) / sim.dx);
    const i0 = Math.floor(sim.nx / 2);
    for (let j = j0 - 3; j <= j0 + 3; j++) for (let i = i0 - 3; i <= i0 + 3; i++) sim.water[j * sim.nx + i] = 0.2;
    const before = waterSum(sim);
    for (let s = 0; s < 120; s++) sim.step(DT);
    // it ran downhill toward the sea, and none was made or lost
    let lowest = sim.ny;
    for (let j = 0; j < sim.ny; j++) for (let i = 0; i < sim.nx; i++) if (sim.water[j * sim.nx + i] > 1e-4 && j < lowest) lowest = j;
    expect(lowest).toBeLessThan(j0 - 3);
    expect(waterSum(sim)).toBeCloseTo(before, 3);
    // take the water away: once it's gone, nothing up there is still moving
    sim.water.fill(0);
    for (let s = 0; s < 4; s++) sim.step(DT);
    let moving = 0;
    for (let k = 0; k < sim.n; k++) if (sim.vx[k] !== 0 || sim.vy[k] !== 0) moving++;
    expect(moving).toBe(0);
  });

  it('still slumps a steep dry mound high on the beach across iterations and conserves sand', () => {
    const sim = new BeachSim(grid, 3, { closed: true, waves: false, erosion: false, healing: false, seep: false });
    const j0 = Math.floor((PROFILE.shoreline + 11) / sim.dx);
    const i0 = Math.floor(sim.nx / 2);
    const k0 = j0 * sim.nx + i0;
    sim.sand[k0] += 1.2;
    const before = sandPlusSediment(sim);
    const peak0 = sim.sand[k0];
    for (let s = 0; s < 15; s++) sim.step(DT);
    expect(sim.sand[k0]).toBeLessThan(peak0 - 0.5);
    // neighbours two cells away received sand through multi-iteration propagation
    expect(sim.sand[k0 + 2]).toBeGreaterThan(sim.rest[k0 + 2] + 1e-4);
    expect(sandPlusSediment(sim)).toBeCloseTo(before, 3);
  });

  it('loads a beach with multiple rocks and props via loadDelta without altering rock heights', () => {
    const simA = new BeachSim(grid, 1, { waves: false, erosion: false, healing: false, seep: false });
    const y = PROFILE.shoreline + 9;
    simA.placeObject({ kind: 'rock', item: 'rock', x: 10, y, angle: 0.3, size: 0.5, variant: 1 });
    simA.placeObject({ kind: 'rock', item: 'rock', x: 14, y, angle: 1.1, size: 0.6, variant: 2 });
    simA.placeObject({ kind: 'flag', item: 'flag', x: 18, y, angle: 0, size: 0.4, variant: 3 });
    simA.placeObject({ kind: 'shell', item: 'shell', x: 20, y, angle: 0.5, size: 0.1, variant: 2 });
    const delta = simA.sandDelta();
    const saved = simA.objects.persisted();

    const simB = new BeachSim(grid, 1, { waves: false, erosion: false, healing: false, seep: false });
    simB.loadDelta(delta, saved);
    let maxDiff = 0;
    for (let k = 0; k < simA.n; k++) maxDiff = Math.max(maxDiff, Math.abs(simA.sand[k] - simB.sand[k]));
    expect(maxDiff).toBeLessThan(1e-5);
    expect(simB.objects.count).toBe(4);
  });

  it('stepEdit digs, eases undo/redo, and conserves sand during slump without running the wave solver', () => {
    const sim = new BeachSim(grid, 1, { waves: false, tide: false, erosion: false, healing: false, seep: false });
    const before = sandPlusSediment(sim);
    const y = PROFILE.shoreline + 8;
    sim.beginStroke(14, y, 0.9, 'dig');
    for (let i = 0; i < 12; i++) {
      sim.moveStroke(14 + i * 0.25, y, 0.9);
      sim.stepEdit(DT);
    }
    sim.endStroke();
    const afterDig = sim.sandDelta();
    let dug = 0;
    for (let k = 0; k < afterDig.length; k++) dug += Math.abs(afterDig[k]);
    expect(dug).toBeGreaterThan(0.5);

    // Additional stepEdit ticks with no active stroke conserve sand (slump only)
    const afterStrokeTotal = sandPlusSediment(sim);
    for (let i = 0; i < 10; i++) sim.stepEdit(DT);
    expect(sandPlusSediment(sim)).toBeCloseTo(afterStrokeTotal, 3);

    expect(sim.undoStroke(true)).toBe(true);
    expect(sim.easingActive).toBe(true);
    for (let i = 0; i < 40 && sim.easingActive; i++) sim.stepEdit(DT);
    expect(sim.easingActive).toBe(false);
    let residual = 0;
    const afterUndo = sim.sandDelta();
    for (let k = 0; k < afterUndo.length; k++) residual += Math.abs(afterUndo[k]);
    expect(residual).toBeLessThan(dug * 0.15);
    expect(sandPlusSediment(sim)).toBeCloseTo(before, 2);
  });
});

describe('sandcastle molds', () => {
  it('makes a square tower wider at the corners and undoes either shape', () => {
    const round = new BeachSim(grid, 1);
    const square = new BeachSim(grid, 1);
    const i = grid.nx >> 1;
    const j = grid.ny - 12;
    const x = (i + 0.5) * grid.dx;
    const y = (j + 0.5) * grid.dx;
    const center = j * grid.nx + i;
    const corner = (j + 4) * grid.nx + i + 4;
    const before = square.sand.slice();
    round.moldCastle(x, y, 'round');
    square.moldCastle(x, y, 'square');
    expect(square.sand[center]).toBeGreaterThan(before[center]);
    expect(square.sand[center]).toBe(round.sand[center]);
    expect(square.sand[corner]).toBeGreaterThan(round.sand[corner]);
    for (const sim of [round, square]) {
      sim.undoStroke(false);
      expect(sim.sand[center]).toBeCloseTo(before[center]);
      expect(sim.sand[corner]).toBeCloseTo(before[corner]);
    }
  });
});

describe('the sea takes owned things out past the offshore edge (docs/LIVE_SIM.md)', () => {
  it('removes them without touching the sand, and the sim stays stable', () => {
    const sim = new BeachSim(grid, 1, { waves: false, erosion: false, healing: false, seep: false });
    const b = sim.placeObject({ kind: 'bottle', item: 'bottle', x: 10, y: 2, angle: 0, size: 0.3, variant: 1 });
    sim.placeObject({ kind: 'flag', item: 'flag', x: 12, y: 2, angle: 0, size: 0.3, variant: 1 });
    const before = sandPlusSediment(sim);
    // a strong backwash over the offshore rows
    for (let s = 0; s < 30 * 5; s++) {
      for (let k = 0; k < sim.nx * Math.ceil(3 / sim.dx); k++) {
        sim.water[k] = Math.max(sim.water[k], 1);
        sim.vy[k] = -2;
      }
      sim.objects.step(DT);
    }
    expect(sim.objects.takeLost().map((o) => o.id)).toEqual([b.id]);
    expect(sim.objects.count).toBe(1);
    expect(sandPlusSediment(sim)).toBeCloseTo(before, 6);
    for (let s = 0; s < 30 * 5; s++) sim.step(DT);
    for (let k = 0; k < sim.n; k++) expect(Number.isFinite(sim.sand[k]) && Number.isFinite(sim.water[k])).toBe(true);
  });
});
