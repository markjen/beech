import { describe, expect, it } from 'vitest';
import { BeachSim } from '../src/sim/beachSim';
import { BRUSH, GRID_TIERS, PROFILE } from '../src/config';

/**
 * Bulldozer rates: one-pass flattening at any drag speed, and faster
 * dig/build. The item-sweep side of the old bulldozer (dozer scooping items
 * back into the bag, undo/redo/cancel of swept items) now lives in the
 * clearing tool — see tests/clearing.test.ts.
 */
const grid = GRID_TIERS.low;
const DT = 1 / 30;
const y = PROFILE.shoreline + 10; // dry beach
const FLAGS = { waves: false, erosion: false, healing: false, seep: false };

/** mean |sand - rest| over a strip of the beach, like the bulldozer test in sim.test.ts */
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

function centre(sim: BeachSim, x: number): number {
  return sim.sand[Math.floor(y / sim.dx) * sim.nx + Math.floor(x / sim.dx)];
}

/** Drive a stroke from x0 to x1 at `speed` m/s, one sim tick per move. */
function drive(sim: BeachSim, x0: number, x1: number, speed: number, mode: 'dig' | 'pile' | 'flatten' | 'dozer'): void {
  sim.beginStroke(x0, y, 0.5, mode);
  const ticks = Math.ceil(Math.abs(x1 - x0) / speed / DT);
  for (let s = 0; s <= ticks; s++) {
    sim.moveStroke(x0 + Math.min(Math.abs(x1 - x0), s * speed * DT) * Math.sign(x1 - x0), y, 0.5);
    sim.step(DT);
  }
  sim.endStroke();
}

describe('drag to flatten', () => {
  it('one pass flattens a dug hole and a pile, even on a fast swipe', () => {
    for (const speed of [2, 10, 20]) {
      const sim = new BeachSim(grid, 1, FLAGS);
      sim.stamp('dig', 10, y, 0.6, 0.4);
      sim.stamp('pile', 14, y, 0.6, 0.5);
      sim.stamp('dig', 17, y, 0.6, 0.4);
      expect(offPath(sim, 8, 20)).toBeGreaterThan(0.03);
      drive(sim, 8, 20, speed, 'flatten');
      expect(offPath(sim, 8, 20)).toBeLessThan(0.004);
    }
  });

  it('dozer over a rock sweeps it up and flattens the sand it was sitting on', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    sim.stamp('dig', 12, y, 0.6, 0.4);
    expect(offPath(sim, 8, 16)).toBeGreaterThan(0.01);
    // the rock sits in the hole (its floor partly fills it back in)
    sim.placeObject({ kind: 'rock', item: 'rock', x: 12, y, angle: 0, size: 0.5, variant: 1 });
    drive(sim, 8, 16, 2, 'dozer');
    expect(sim.objects.count).toBe(0);
    // the rock is back in the bag, and the hole it sat in is filled — the
    // blade flattens the sand the rock's floor had been holding up
    expect(offPath(sim, 8, 16)).toBeLessThan(0.004);
  });
});

describe('faster digging and building', () => {
  it('holding still digs 0.4 m in under a second (was ~1.4 s)', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const start = centre(sim, 12);
    sim.beginStroke(12, y, 0.5, 'dig');
    for (let s = 0; s < 30; s++) sim.step(DT);
    sim.endStroke();
    expect(start - centre(sim, 12)).toBeGreaterThan(0.35);
  });

  it('holding still builds 0.3 m in a second (was ~0.25 m)', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const start = centre(sim, 12);
    sim.beginStroke(12, y, 0.5, 'pile');
    for (let s = 0; s < 30; s++) sim.step(DT);
    sim.endStroke();
    expect(centre(sim, 12) - start).toBeGreaterThan(0.3);
  });

  it('dragging digs a real trench: one 1 m/s pass takes 0.05 m off the centre', () => {
    const sim = new BeachSim(grid, 1, FLAGS);
    const start = centre(sim, 12);
    drive(sim, 8, 16, 1, 'dig');
    expect(start - centre(sim, 12)).toBeGreaterThan(0.05);
  });

  it('the tuned rates are the faster ones', () => {
    expect(BRUSH.rateStart).toBeGreaterThanOrEqual(0.5);
    expect(BRUSH.rateHeld).toBeGreaterThanOrEqual(1.0);
    expect(BRUSH.holdRamp).toBeLessThanOrEqual(0.6);
    expect(BRUSH.flattenRate).toBeGreaterThanOrEqual(300);
  });
});
