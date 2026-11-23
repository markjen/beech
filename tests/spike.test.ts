// Regression tests for the spire spike: a wall of overlapping rocks used to
// stack their sand lifts without bound (each new rock's base was sampled
// from sand already lifted by earlier rocks), and taking the rocks off in
// placement order left the floor — and the sand — raised, because removal
// restored a stale per-rock floor snapshot. The leftover column was
// permanent: slump, healing and erosion all treat the floor as a lower
// bound, and it survived save + load. Riley's beach (a rock corral with
// two flags) grew one about 3.6 m tall.
//
// The fix: a rock's base and `under` come from the terrain (the sand with
// every live rock's lift stripped), removal rebuilds the floor from the
// untouched floor plus the rocks still there, and loading an old save
// re-bases its rocks to the sand around them and caps the sand to what
// those rocks justify.
import { describe, expect, it } from 'vitest';
import { BeachSim, type BrushMode } from '../src/sim/beachSim';
import { GRID_TIERS, PROFILE } from '../src/config';

const grid = GRID_TIERS.low;
const DT = 1 / 30;
const y = PROFILE.shoreline + 10; // dry beach
const FLAGS = { waves: false, erosion: false, healing: false, seep: false };
/** one rock's lift at most: size 1.3 × 0.8 × 0.75 */
const MAX_LIFT = 1.3 * 0.8 * 0.75;

function restAt(sim: BeachSim, x: number, yy: number): number {
  return sim.rest[Math.floor(yy / sim.dx) * sim.nx + Math.floor(x / sim.dx)];
}

/** max sand / floor over a box around (x, yy) */
function maxIn(sim: BeachSim, x: number, yy: number, r: number): { sand: number; bottom: number } {
  let sand = -Infinity;
  let bottom = -Infinity;
  const i0 = Math.max(0, Math.floor((x - r) / sim.dx));
  const i1 = Math.min(sim.nx - 1, Math.ceil((x + r) / sim.dx));
  const j0 = Math.max(0, Math.floor((yy - r) / sim.dx));
  const j1 = Math.min(sim.ny - 1, Math.ceil((yy + r) / sim.dx));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const k = j * sim.nx + i;
      sand = Math.max(sand, sim.sand[k]);
      bottom = Math.max(bottom, sim.bottom[k]);
    }
  return { sand, bottom };
}

/** max |sand - before| over a box around (x, y) */
function sandDiff(sim: BeachSim, before: Float32Array, x: number, r: number): number {
  let m = 0;
  const i0 = Math.max(0, Math.floor((x - r) / sim.dx));
  const i1 = Math.min(sim.nx - 1, Math.ceil((x + r) / sim.dx));
  const j0 = Math.max(0, Math.floor((y - r) / sim.dx));
  const j1 = Math.min(sim.ny - 1, Math.ceil((y + r) / sim.dx));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const k = j * sim.nx + i;
      m = Math.max(m, Math.abs(sim.sand[k] - before[k]));
    }
  return m;
}

/** Hold the stroke still over one spot for `ticks` ticks. */
function hold(sim: BeachSim, x: number, ticks: number, mode: BrushMode): void {
  sim.beginStroke(x, y, 0.5, mode);
  for (let s = 0; s < ticks; s++) sim.step(DT);
  sim.endStroke();
}

/** a wall of four big overlapping rocks, as in Riley's corral */
function placeWall(sim: BeachSim): number[] {
  const ids: number[] = [];
  let x = 16;
  for (let n = 0; n < 4; n++) {
    ids.push(sim.placeObject({ kind: 'rock', item: 'rock', x, y, angle: 0, size: 1.3, variant: 1 }).id);
    x += 0.9;
  }
  return ids;
}

describe('overlapping rocks', () => {
  it('do not stack their lifts: a wall of four big rocks rises at most one lift', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const rest = restAt(sim, 18, y);
    const ids = placeWall(sim);
    expect(ids).toHaveLength(4);
    const peak = maxIn(sim, 18, y, 1.5);
    expect(peak.sand).toBeLessThanOrEqual(rest + MAX_LIFT + 0.05);
    expect(peak.bottom).toBeLessThanOrEqual(rest + MAX_LIFT + 0.05);
    // every rock sits on the terrain, not on its neighbour's dome
    for (const o of sim.objects.persisted()) {
      expect(o.base!).toBeCloseTo(restAt(sim, o.x, y), 1);
    }
  });

  it('a rock placed on another rock\'s dome sits on the terrain underneath', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const rest = restAt(sim, 16, y);
    sim.placeObject({ kind: 'rock', item: 'rock', x: 16, y, angle: 0, size: 1.3, variant: 1 });
    const second = sim.placeObject({ kind: 'rock', item: 'rock', x: 16.4, y, angle: 0, size: 1.3, variant: 2 });
    expect(second.base!).toBeCloseTo(rest, 1);
    expect(maxIn(sim, 16.2, y, 1).sand).toBeLessThanOrEqual(rest + MAX_LIFT + 0.05);
  });

  it('removing them in any order restores the floor and the sand exactly', () => {
    for (const order of ['placement', 'reverse'] as const) {
      const sim = new BeachSim(grid, 1, FLAGS);
      const floorBefore = sim.bottom.slice();
      const sandBefore = sim.sand.slice();
      const ids = placeWall(sim);
      const take = order === 'placement' ? ids : [...ids].reverse();
      for (const id of take) sim.removeObject(id);
      expect(sim.bottom).toEqual(floorBefore);
      let maxSandDiff = 0;
      for (let k = 0; k < sim.n; k++) maxSandDiff = Math.max(maxSandDiff, Math.abs(sim.sand[k] - sandBefore[k]));
      expect(maxSandDiff).toBeLessThan(1e-6);
      // and taking the first three off leaves the last rock's own dome only
      const sim2 = new BeachSim(grid, 1, FLAGS);
      const ids2 = placeWall(sim2);
      for (const id of ids2.slice(0, 3)) sim2.removeObject(id);
      const rest = restAt(sim2, 18, y);
      expect(maxIn(sim2, 18, y, 1).sand).toBeLessThanOrEqual(rest + MAX_LIFT + 0.05);
    }
  });

  it('a rock on a pile sits at pile height, and taking it off leaves the pile', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    sim.stamp('pile', 16, y, 0.6, 0.5);
    sim.stamp('pile', 16, y, 0.6, 0.5);
    const piled = sim.sand.slice();
    const pileTop = maxIn(sim, 16, y, 0.5).sand;
    expect(pileTop).toBeGreaterThan(restAt(sim, 16, y) + 0.2);
    const rock = sim.placeObject({ kind: 'rock', item: 'rock', x: 16, y, angle: 0, size: 0.5, variant: 1 });
    // the rock sits on the pile, not on the rest height underneath it
    expect(rock.base!).toBeGreaterThan(restAt(sim, 16, y) + 0.2);
    expect(rock.base!).toBeLessThanOrEqual(pileTop + 0.01);
    sim.removeObject(rock.id);
    expect(sandDiff(sim, piled, 16, 1)).toBeLessThan(1e-4);
  });

  it('withoutRocks peels overlapping rocks exactly, and keeps piles above them', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const sandBefore = sim.sand.slice();
    placeWall(sim);
    const wallSand = sim.sand.slice();
    const peeled = sim.objects.withoutRocks(sim.sand.slice());
    let maxDiff = 0;
    for (let k = 0; k < sim.n; k++) maxDiff = Math.max(maxDiff, Math.abs(peeled[k] - sandBefore[k]));
    expect(maxDiff).toBeLessThan(1e-4);
    // saving a wall therefore saves flat sand, not a staircase — and
    // loading it back rebuilds the same wall
    const delta = sim.sandDelta();
    const sim2 = new BeachSim(grid, 1, FLAGS);
    sim2.loadDelta(delta, sim.objects.persisted());
    expect(sandDiff(sim2, wallSand, 18, 2)).toBeLessThan(1e-4);
  });

  it('a vacuum sweep of overlapping rocks leaves no dome, and undo puts them back exactly', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const a = sim.placeObject({ kind: 'rock', item: 'rock', x: 16, y, angle: 0, size: 1.3, variant: 1 });
    const b = sim.placeObject({ kind: 'rock', item: 'rock', x: 16.9, y, angle: 0, size: 1.3, variant: 2 });
    const before = sim.sand.slice();
    hold(sim, 16.4, 3, 'vacuum');
    expect(sim.objects.count).toBe(0);
    expect(maxIn(sim, 16.4, y, 1.5).sand).toBeLessThanOrEqual(restAt(sim, 16.4, y) + 0.05);
    sim.undoStroke(false);
    expect(sim.objects.persisted().map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    expect(sandDiff(sim, before, 16.4, 2)).toBeLessThan(1e-4);
    for (const o of sim.objects.persisted()) expect(sim.objects.states().find((s) => s.id === o.id)!.z).toBeCloseTo(o.base!, 6);
  });
});

describe('old stacked saves heal on load', () => {
  it('a spire pillar and stacked bases come back flat, with the rocks on the terrain', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const rest = restAt(sim, 17.5, y);
    // a 2.15 m spire cone baked into the save, as the old stacking left it
    const delta = new Float32Array(sim.n);
    const cx = Math.floor(17.5 / sim.dx);
    const cy = Math.floor(y / sim.dx);
    for (let j = -6; j <= 6; j++)
      for (let i = -6; i <= 6; i++) {
        const d = Math.hypot(i, j);
        if (d > 6) continue;
        delta[(cy + j) * sim.nx + (cx + i)] = 2.15 * Math.max(0, 1 - d / 6);
      }
    // the rocks as the old code saved them: each base stacked on the last
    const objects = [
      { id: 1, kind: 'rock' as const, item: 'rock', x: 16, y, angle: 0, size: 1.3, variant: 1, base: rest },
      { id: 2, kind: 'rock' as const, item: 'rock', x: 16.9, y, angle: 0, size: 1.3, variant: 2, base: rest + 0.78 },
      { id: 3, kind: 'rock' as const, item: 'rock', x: 17.8, y, angle: 0, size: 1.3, variant: 1, base: rest + 1.56 },
    ];
    sim.loadDelta(delta, objects);
    const peak = maxIn(sim, 17.5, y, 2);
    // the spire is gone: no higher than one rock lift plus the margin
    // kept for real piles poking above a top
    expect(peak.sand).toBeLessThanOrEqual(rest + MAX_LIFT + 0.25);
    expect(peak.bottom).toBeLessThanOrEqual(rest + MAX_LIFT + 0.05);
    for (const o of sim.objects.persisted()) {
      expect(o.base!).toBeGreaterThanOrEqual(rest - 0.15);
      expect(o.base!).toBeLessThanOrEqual(rest + 0.15);
    }
    // and taking the healed rocks off leaves no frozen floor: the floor
    // is back to the untouched beach, and the sand left is at most one
    // lift plus the pile margin — loose, unfrozen sand the live sim can
    // reshape, not a pillar
    for (const o of sim.objects.persisted()) sim.removeObject(o.id);
    expect(maxIn(sim, 17.5, y, 2).sand).toBeLessThanOrEqual(rest + MAX_LIFT + 0.25);
    expect(maxIn(sim, 17.5, y, 2).bottom).toBeLessThanOrEqual(rest + 0.05);
    // loading the healed beach again changes nothing (the leftover mound
    // is ordinary sand now, and it stays within the same bound)
    const delta2 = sim.sandDelta();
    const healedSand = sim.sand.slice();
    const sim2 = new BeachSim(grid, 1, FLAGS);
    sim2.loadDelta(delta2, sim.objects.persisted());
    expect(maxIn(sim2, 17.5, y, 2).sand).toBeLessThanOrEqual(rest + MAX_LIFT + 0.25);
    let maxReloadDiff = 0;
    for (let k = 0; k < sim2.n; k++) maxReloadDiff = Math.max(maxReloadDiff, Math.abs(sim2.sand[k] - healedSand[k]));
    expect(maxReloadDiff).toBeLessThan(1e-4);
  });

  it('a healthy beach loads unchanged', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    placeWall(sim);
    const delta = sim.sandDelta();
    const objects = sim.objects.persisted();
    const sandBefore = sim.sand.slice();
    const sim2 = new BeachSim(grid, 1, FLAGS);
    sim2.loadDelta(delta, objects);
    expect(sim2.objects.persisted().map((o) => o.base)).toEqual(objects.map((o) => o.base));
    let maxDiff = 0;
    for (let k = 0; k < sim2.n; k++) maxDiff = Math.max(maxDiff, Math.abs(sim2.sand[k] - sandBefore[k]));
    expect(maxDiff).toBeLessThan(1e-4);
  });
});
