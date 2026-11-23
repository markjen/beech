import { describe, expect, it } from 'vitest';
import { BeachSim, CLEARING_MODES, isClearingMode, type BrushMode } from '../src/sim/beachSim';
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
  it('are exactly flatten, dozer, and vacuum', () => {
    expect(CLEARING_MODES).toEqual(['flatten', 'dozer', 'vacuum']);
    for (const m of ['flatten', 'dozer', 'vacuum']) expect(isClearingMode(m)).toBe(true);
    for (const m of ['look', 'dig', 'pile', 'smooth', 'place']) expect(isClearingMode(m)).toBe(false);
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
    // everything in the path is gone except the rock; the far chair is untouched
    expect(sim.objects.persisted().map((p) => p.id).sort()).toEqual([o.rock.id, o.far.id].sort());
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
    expect(left.map((p) => p.id).sort()).toEqual([o.rock.id, o.far.id].sort());
    // the bag counts what's placed: nothing vacuumed is placed any more, so it's back in hand
    expect(left.some((p) => p.item === 'deckchair' && p.id === o.chair.id)).toBe(false);
    expect(left.some((p) => p.item === 'starfish')).toBe(false);
  });

  it('rocks stay, and a wild stray is swept away but never credited', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const o = setRow(sim);
    drive(sim, 8, 22, 2, 'vacuum');
    // the rock is still on the beach; the stray is gone (it was never in the bag)
    expect(sim.objects.persisted().some((p) => p.id === o.rock.id)).toBe(true);
    expect(sim.objects.persisted().some((p) => p.id === o.stray.id)).toBe(false);
  });

  it('one undo puts vacuumed items back; redo takes them off again', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const o = setRow(sim);
    drive(sim, 8, 22, 2, 'vacuum');
    expect(sim.objects.count).toBe(2);
    sim.undoStroke(false);
    expect(sim.objects.persisted().map((p) => p.id).sort()).toEqual(
      [o.chair.id, o.star.id, o.shell.id, o.wood.id, o.stray.id, o.rock.id, o.far.id].sort(),
    );
    sim.redoStroke(false);
    expect(sim.objects.persisted().map((p) => p.id).sort()).toEqual([o.rock.id, o.far.id].sort());
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
