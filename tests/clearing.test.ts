import { describe, expect, it } from 'vitest';
import { BeachSim, CLEARING_MODES, SAND_MODES, isClearingMode, isSandMode, type BrushMode } from '../src/sim/beachSim';
import { GRID_TIERS, PROFILE } from '../src/config';

const grid = GRID_TIERS.low;
const DT = 1 / 30;
const y = PROFILE.shoreline + 10; // dry beach
const FLAGS = { waves: false, erosion: false, healing: false, seep: false };

/** mean |sand - rest| over a strip of the beach */
function offPath(sim: BeachSim, x0: number, x1: number): number {
  let m = 0;
  let n = 0;
  for (let j = Math.floor((y - 0.4) / sim.dx); j <= Math.ceil((y + 0.4) / sim.dx); j++)
    for (let i = Math.floor((x0 - 0.6) / sim.dx); i <= Math.ceil((x1 + 0.6) / sim.dx); i++) {
      const k = j * sim.nx + i;
      m += Math.abs(sim.sand[k] - sim.rest[k]);
      n++;
    }
  return m / n;
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

/** Drive a stroke from x0 to x1 at `speed` m/s, one sim tick per move. */
function drive(sim: BeachSim, x0: number, x1: number, speed: number, mode: BrushMode): void {
  sim.beginStroke(x0, y, 0.5, mode);
  const ticks = Math.ceil(Math.abs(x1 - x0) / speed / DT);
  for (let s = 0; s <= ticks; s++) {
    sim.moveStroke(x0 + Math.min(Math.abs(x1 - x0), s * speed * DT) * Math.sign(x1 - x0), y, 0.5);
    sim.step(DT);
  }
  sim.endStroke();
}

/** Hold the stroke still over one spot for `ticks` ticks (a tap that lingers). */
function hold(sim: BeachSim, x: number, ticks: number, mode: BrushMode): void {
  sim.beginStroke(x, y, 0.5, mode);
  for (let s = 0; s < ticks; s++) sim.step(DT);
  sim.endStroke();
}

/** a row of things on the beach: limited prizes, free items, a stray, a rock, and one out of the way */
function setRow(sim: BeachSim) {
  const chair = sim.placeObject({ kind: 'deckchair', item: 'deckchair', x: 10, y, angle: 0, size: 1, variant: 1 });
  const star = sim.placeObject({ kind: 'starfish', item: 'starfish', x: 12, y, angle: 0, size: 0.15, variant: 1 });
  const shell = sim.placeObject({ kind: 'shell', item: 'shell', x: 14, y, angle: 0, size: 0.1, variant: 1 });
  const wood = sim.placeObject({ kind: 'driftwood', item: 'driftwood', x: 16, y, angle: 0, size: 1.5, variant: 1 });
  const stray = sim.placeObject({ kind: 'shell', item: 'shell', x: 18, y, angle: 0, size: 0.1, variant: 1, wild: true });
  const rock = sim.placeObject({ kind: 'rock', item: 'rock', x: 20, y, angle: 0, size: 0.5, variant: 1 });
  const far = sim.placeObject({ kind: 'deckchair', item: 'deckchair', x: 26, y, angle: 0, size: 1, variant: 2 });
  return { chair, star, shell, wood, stray, rock, far };
}

describe('clearing modes', () => {
  it('are dozer (default), flatten, and vacuum; sand modes are dig (default), pile, and smooth', () => {
    expect(CLEARING_MODES).toEqual(['dozer', 'flatten', 'vacuum']);
    for (const m of ['dozer', 'flatten', 'vacuum']) expect(isClearingMode(m)).toBe(true);
    for (const m of ['look', 'sand', 'dig', 'pile', 'smooth', 'place']) expect(isClearingMode(m)).toBe(false);
    expect(SAND_MODES).toEqual(['dig', 'pile', 'smooth']);
    for (const m of ['dig', 'pile', 'smooth']) expect(isSandMode(m)).toBe(true);
    for (const m of ['look', 'clearing', 'dozer', 'flatten', 'vacuum', 'place']) expect(isSandMode(m)).toBe(false);
  });

  it('flatten flattens the sand and leaves items where they are', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const o = setRow(sim);
    sim.stamp('dig', 10, y, 0.6, 0.4);
    sim.stamp('pile', 14, y, 0.6, 0.5);
    expect(offPath(sim, 8, 17)).toBeGreaterThan(0.02);
    drive(sim, 8, 20, 2, 'flatten');
    expect(offPath(sim, 8, 17)).toBeLessThan(0.004);
    expect(sim.objects.persisted().map((p) => p.id).sort()).toEqual(
      [o.chair.id, o.star.id, o.shell.id, o.wood.id, o.stray.id, o.rock.id, o.far.id].sort(),
    );
  });

  it('dozer flattens the sand AND scoops up items in the blade path', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const o = setRow(sim);
    sim.stamp('dig', 10, y, 0.6, 0.4);
    sim.stamp('pile', 14, y, 0.6, 0.5);
    expect(offPath(sim, 8, 17)).toBeGreaterThan(0.02);
    drive(sim, 8, 22, 2, 'dozer');
    expect(offPath(sim, 8, 17)).toBeLessThan(0.004);
    // everything in the path is gone, rocks included; the far chair is untouched
    expect(sim.objects.persisted().map((p) => p.id).sort()).toEqual([o.far.id].sort());
  });

  it('vacuum moves no sand at all', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    setRow(sim);
    sim.stamp('dig', 10, y, 0.6, 0.4);
    sim.stamp('pile', 14, y, 0.6, 0.5);
    const before = offPath(sim, 8, 17);
    expect(before).toBeGreaterThan(0.02);
    drive(sim, 8, 20, 10, 'vacuum');
    // the hole and the pile are still there: the vacuum only picks things up
    expect(offPath(sim, 8, 17)).toBeGreaterThan(0.015);
  });
});

describe('vacuum pickup', () => {
  it('a tap picks up exactly the one item under it', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const o = setRow(sim);
    expect(sim.objects.count).toBe(7);
    hold(sim, 12, 3, 'vacuum'); // over the starfish
    expect(sim.objects.persisted().map((p) => p.id).sort()).toEqual(
      [o.chair.id, o.shell.id, o.wood.id, o.stray.id, o.rock.id, o.far.id].sort(),
    );
  });

  it('a drag vacuums everything in the path and leaves the rest alone', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const o = setRow(sim);
    drive(sim, 8, 22, 2, 'vacuum');
    const left = sim.objects.persisted();
    expect(left.map((p) => p.id).sort()).toEqual([o.far.id].sort());
    // the bag counts what's placed: nothing vacuumed is placed any more, so it's back in hand
    expect(left.some((p) => p.item === 'deckchair' && p.id === o.chair.id)).toBe(false);
    expect(left.some((p) => p.item === 'starfish')).toBe(false);
  });

  it('a swept rock goes back in the bag; a wild stray is swept away but never credited', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const o = setRow(sim);
    drive(sim, 8, 22, 2, 'vacuum');
    // the rock is gone — it was placed, so it is back in hand — and so is the stray (never in the bag)
    expect(sim.objects.persisted().some((p) => p.id === o.rock.id)).toBe(false);
    expect(sim.objects.persisted().some((p) => p.id === o.stray.id)).toBe(false);
  });

  it('one undo puts vacuumed items back; redo takes them off again', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const o = setRow(sim);
    drive(sim, 8, 22, 2, 'vacuum');
    expect(sim.objects.count).toBe(1);
    sim.undoStroke(false);
    expect(sim.objects.persisted().map((p) => p.id).sort()).toEqual(
      [o.chair.id, o.star.id, o.shell.id, o.wood.id, o.stray.id, o.rock.id, o.far.id].sort(),
    );
    sim.redoStroke(false);
    expect(sim.objects.persisted().map((p) => p.id).sort()).toEqual([o.far.id].sort());
  });

  it('a stroke that only vacuums an object (no sand change) is still undoable', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const chair = sim.placeObject({ kind: 'deckchair', item: 'deckchair', x: 12, y, angle: 0, size: 1, variant: 1 });
    const undos = sim.undo.undoCount;
    hold(sim, 12, 3, 'vacuum');
    expect(sim.objects.count).toBe(0);
    expect(sim.undo.undoCount).toBe(undos + 1);
    sim.undoStroke(false);
    expect(sim.objects.persisted().map((p) => p.id)).toEqual([chair.id]);
  });

  it('cancelling a stroke (second finger) puts vacuumed items back', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const chair = sim.placeObject({ kind: 'deckchair', item: 'deckchair', x: 12, y, angle: 0, size: 1, variant: 1 });
    sim.beginStroke(8, y, 0.5, 'vacuum');
    for (let s = 0; s <= 20; s++) {
      sim.moveStroke(8 + s * 0.2, y, 0.5);
      sim.step(DT);
    }
    expect(sim.objects.count).toBe(0);
    sim.cancelStroke();
    expect(sim.objects.persisted().map((p) => p.id)).toEqual([chair.id]);
  });
});

describe('rocks can be cleared', () => {
  it('a vacuum tap picks up exactly the rock under it', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const o = setRow(sim);
    hold(sim, 20, 3, 'vacuum'); // over the rock
    expect(sim.objects.persisted().map((p) => p.id).sort()).toEqual(
      [o.chair.id, o.star.id, o.shell.id, o.wood.id, o.stray.id, o.far.id].sort(),
    );
  });

  it('sweeping a rock gives the terrain floor back underneath it', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const floorBefore = sim.bottom.slice();
    sim.placeObject({ kind: 'rock', item: 'rock', x: 12, y, angle: 0, size: 0.5, variant: 1 });
    // the rock raised the non-erodible floor under its footprint
    expect(sim.bottom.some((b, k) => b > floorBefore[k])).toBe(true);
    hold(sim, 12, 3, 'vacuum');
    expect(sim.objects.count).toBe(0);
    // ... and taking it off gives the floor back exactly; the dig floor itself is untouched
    expect(sim.bottom).toEqual(floorBefore);
  });

  it('undo puts a vacuumed rock back with the sand exactly as it was; redo takes it off again', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const rock = sim.placeObject({ kind: 'rock', item: 'rock', x: 12, y, angle: 0, size: 0.5, variant: 1 });
    const before = sim.sand.slice();
    hold(sim, 12, 3, 'vacuum');
    expect(sim.objects.count).toBe(0);
    const lifted = sim.sand.slice();
    // the lift dropped the sand under the rock back to where it sat
    expect(sandDiff(sim, before, 12, 1)).toBeGreaterThan(0.05);
    sim.undoStroke(false);
    expect(sim.objects.persisted().map((p) => p.id)).toEqual([rock.id]);
    // no sand dome where the rock was lifted from: undo counts the lift once
    expect(sandDiff(sim, before, 12, 1)).toBeLessThan(1e-4);
    // and the rock sits at the height it was placed at, not floating on the lifted sand
    expect(sim.objects.states()[0].z).toBeCloseTo(rock.base!, 6);
    sim.redoStroke(false);
    expect(sim.objects.count).toBe(0);
    expect(sandDiff(sim, lifted, 12, 1)).toBeLessThan(1e-4);
  });

  it('cancelling a stroke (second finger) puts a swept rock back exactly', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const rock = sim.placeObject({ kind: 'rock', item: 'rock', x: 12, y, angle: 0, size: 0.5, variant: 1 });
    const before = sim.sand.slice();
    sim.beginStroke(8, y, 0.5, 'vacuum');
    for (let s = 0; s <= 20; s++) {
      sim.moveStroke(8 + s * 0.2, y, 0.5);
      sim.step(DT);
    }
    expect(sim.objects.count).toBe(0);
    sim.cancelStroke();
    expect(sim.objects.persisted().map((p) => p.id)).toEqual([rock.id]);
    expect(sandDiff(sim, before, 12, 1)).toBeLessThan(1e-4);
    expect(sim.objects.states()[0].z).toBeCloseTo(rock.base!, 6);
  });

  it('undo puts a dozer-swept rock back, and the sand under it is not doubled', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const rock = sim.placeObject({ kind: 'rock', item: 'rock', x: 12, y, angle: 0, size: 0.5, variant: 1 });
    sim.stamp('dig', 10, y, 0.6, 0.4);
    sim.stamp('pile', 14, y, 0.6, 0.5);
    const dug = sim.sand.slice();
    drive(sim, 8, 16, 2, 'dozer');
    expect(sim.objects.count).toBe(0);
    sim.undoStroke(false);
    expect(sim.objects.persisted().map((p) => p.id)).toEqual([rock.id]);
    // the dug hole and the pile are back, and the rock sits in the sand as placed
    expect(sandDiff(sim, dug, 12, 2)).toBeLessThan(1e-4);
    expect(sim.objects.states()[0].z).toBeCloseTo(rock.base!, 6);
  });
});

describe('item tool places only', () => {
  it('placing an item on top of one already there keeps both (no pickup)', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const first = sim.placeObject({ kind: 'deckchair', item: 'deckchair', x: 12, y, angle: 0, size: 1, variant: 1 });
    // the item tool now only places: tapping the same spot sets the new item down
    const second = sim.placeObject({ kind: 'starfish', item: 'starfish', x: 12, y, angle: 0, size: 0.15, variant: 1 });
    expect(sim.objects.persisted().map((p) => p.id).sort()).toEqual([first.id, second.id].sort());
    // and removing one still needs an explicit remove (the vacuum), not a place tap
    expect(sim.objects.count).toBe(2);
  });
});

describe('objects.within', () => {
  it('finds everything in the radius, and nothing outside it', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const o = setRow(sim);
    const near = sim.objects.within(12, y, 0.5).map((p) => p.id);
    expect(near).toContain(o.star.id);
    expect(near).not.toContain(o.chair.id);
    expect(near).not.toContain(o.far.id);
    expect(sim.objects.within(26, y, 0.5).map((p) => p.id)).toEqual([o.far.id]);
  });
});
