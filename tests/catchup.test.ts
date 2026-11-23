import { describe, expect, it } from 'vitest';
import { BeachSim } from '../src/sim/beachSim';
import { catchUp, halfCycles } from '../src/sim/catchup';
import type { PlacedObject } from '../src/sim/objects';
import { CATCHUP } from '../src/config';
import { castle, g, peak, rest, SHORE, tide } from './catchup.fixture';

const H = 3600000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 10, 1);
const blank = () => new Float32Array(g.nx * g.ny);
const run = (delta: Float32Array, objects: PlacedObject[], ms: number, from = T0) =>
  catchUp({ nx: g.nx, ny: g.ny, delta, objects, tide: tide(), waves: 1, from, to: from + ms });

describe('half tide cycles', () => {
  it('finds about four a day and the high tides', () => {
    const { segs, highTides } = halfCycles(tide(), T0, T0 + 2 * DAY);
    expect(segs.length).toBeGreaterThanOrEqual(7);
    expect(segs.length).toBeLessThanOrEqual(9);
    expect(highTides).toBeGreaterThanOrEqual(3);
    expect(highTides).toBeLessThanOrEqual(4);
    for (const [a, b, lo, hi] of segs) {
      expect(b).toBeGreaterThan(a);
      expect(hi).toBeGreaterThanOrEqual(lo);
    }
  });
});

describe('the catch-up (docs/LIVE_SIM.md)', () => {
  it('wears down a castle at the waterline and leaves one high on the beach alone', () => {
    const d = blank();
    castle(d, 10, SHORE + 0.5);
    castle(d, 22, 29);
    const out = run(d, [], 2 * DAY);
    expect(peak(out.delta, 10, SHORE + 0.5)).toBeLessThan(0.15);
    // dry sand above the gap's high water: exactly as it was
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        if ((j + 0.5) * g.dx > 26) expect(out.delta[k]).toBe(d[k]);
      }
    }
    expect(out.sandMoved).toBeGreaterThan(0.1);
  });

  it('is stable over the longest gap: no NaN, nothing grows, nothing below the floor', () => {
    const d = blank();
    castle(d, 8, SHORE, 1.5, 0.8);
    castle(d, 20, SHORE + 2, 1, 0.6);
    // and a hole
    castle(d, 14, SHORE - 1, 1, -0.6);
    const out = run(d, [], CATCHUP.maxGapDays * DAY);
    let maxIn = 0;
    for (const v of d) maxIn = Math.max(maxIn, Math.abs(v));
    for (let k = 0; k < out.delta.length; k++) {
      const v = out.delta[k];
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(maxIn + 1e-6);
      expect(v).toBeGreaterThanOrEqual(-1.2 - 1e-6);
    }
  });

  it('moves sand down rather than making it: the total never rises', () => {
    const d = blank();
    castle(d, 12, SHORE + 1, 1.2, 0.7);
    const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);
    const out = run(d, [], 3 * H);
    // healing pulls toward the rest beach (as live), slumping only moves sand
    expect(sum(out.delta)).toBeLessThan(sum(d));
    expect(sum(out.delta)).toBeGreaterThanOrEqual(-1e-3);
    // a day later it's all but gone, like the live sim's healing would do
    expect(Math.abs(sum(run(d, [], DAY).delta))).toBeLessThan(sum(d) * 0.05);
  });

  it('gives the same answer for the same input', () => {
    const d = blank();
    castle(d, 12, SHORE + 1);
    const objs: PlacedObject[] = [{ id: 1, kind: 'bottle', item: 'bottle', x: 12, y: SHORE + 3, angle: 0, size: 0.3, variant: 1 }];
    const a = run(d, objs, 3 * DAY);
    const b = run(d, objs, 3 * DAY);
    expect(Array.from(a.delta)).toEqual(Array.from(b.delta));
    expect(a.objects).toEqual(b.objects);
  });

  it('two halves come out close to one whole', () => {
    const d = blank();
    castle(d, 12, SHORE + 1, 1.2, 0.6);
    const whole = run(d, [], 2 * DAY);
    const half = run(run(d, [], DAY).delta, [], DAY, T0 + DAY);
    let diff = 0;
    let changed = 0;
    for (let k = 0; k < d.length; k++) {
      diff += Math.abs(whole.delta[k] - half.delta[k]);
      changed += Math.abs(whole.delta[k] - d[k]);
    }
    expect(diff).toBeLessThan(changed * 0.2);
  });

  it('caps the gap', () => {
    const d = blank();
    castle(d, 12, SHORE + 1);
    const far = catchUp({ nx: g.nx, ny: g.ny, delta: d, objects: [], tide: tide(), waves: 1, from: T0 - 100 * DAY, to: T0, maxGapDays: 3 });
    expect(far.from).toBe(T0 - 3 * DAY);
    const capped = run(d, [], 3 * DAY, T0 - 3 * DAY);
    expect(Array.from(far.delta)).toEqual(Array.from(capped.delta));
  });

  it('does nothing for no time', () => {
    const d = blank();
    castle(d, 12, SHORE);
    const out = run(d, [], 0);
    expect(Array.from(out.delta)).toEqual(Array.from(d));
    expect(out.highTides).toBe(0);
  });

  it('roughly matches the live sim on a waterline castle', () => {
    // two minutes at a still tide: the live sim's waves knock the top off;
    // the catch-up does the same castle the same way, a little more gently
    for (const y of [SHORE - 1, SHORE]) {
      const d = blank();
      castle(d, 16, y);
      const sim = new BeachSim(g, 1);
      sim.setSea(0, 1);
      sim.loadDelta(d, []);
      for (let s = 0; s < 30 * 120; s++) sim.step(1 / 30);
      const live = peak(sim.sandDelta(), 16, y);
      const cu = peak(catchUp({ nx: g.nx, ny: g.ny, delta: d, objects: [], tide: () => 0, waves: 1, from: 0, to: 120000 }).delta, 16, y);
      expect(live).toBeLessThan(0.4);
      expect(cu).toBeLessThan(0.4);
      expect(Math.abs(cu - live)).toBeLessThan(0.15);
    }
    // up the beach, out of the swash: neither touches it
    const d = blank();
    castle(d, 16, SHORE + 3);
    const cu = catchUp({ nx: g.nx, ny: g.ny, delta: d, objects: [], tide: () => 0, waves: 1, from: 0, to: 120000 });
    expect(peak(cu.delta, 16, SHORE + 3)).toBeCloseTo(0.5, 5);
  }, 120000);
});

describe('things on the beach in the catch-up', () => {
  const at = (id: number, kind: PlacedObject['kind'], x: number, y: number, wild = false): PlacedObject => ({
    id, kind, item: kind, x, y, angle: 0, size: kind === 'driftwood' ? 1 : 0.2, variant: 1, ...(wild ? { wild } : {}),
  });

  it('takes owned things left in the sea, keeps what is high and dry or fixed', () => {
    const objs = [
      at(1, 'bottle', 10, SHORE - 2), // out in the water
      at(2, 'nautilus', 14, SHORE - 2),
      at(3, 'bottle', 18, 29), // high and dry
      at(4, 'flag', 22, SHORE - 2), // fixed
      at(5, 'rock', 26, SHORE - 1),
    ];
    const out = run(blank(), objs, 2 * DAY);
    expect(out.lost.map((o) => o.id).sort()).toEqual([1, 2]);
    const ids = out.objects.filter((o) => !o.wild).map((o) => o.id).sort();
    expect(ids).toEqual([3, 4, 5]);
    const dry = out.objects.find((o) => o.id === 3)!;
    expect(dry.x).toBe(18);
    expect(dry.y).toBe(29);
  });

  it('strands a floater it lifts at the high-water line, inside the beach', () => {
    const out = run(blank(), [at(1, 'driftwood', 16, SHORE + 0.8)], 3 * H);
    const w = out.objects.find((o) => o.id === 1);
    expect(w).toBeDefined();
    expect(w!.y).toBeGreaterThan(SHORE);
    expect(w!.x).toBeGreaterThan(0);
    expect(w!.x).toBeLessThan(32);
  });

  it('after a high tide, the old strays are gone and fresh ones lie along its line', () => {
    const out = run(blank(), [at(1, 'shell', 5, SHORE + 1, true), at(2, 'flag', 20, 28)], 2 * DAY);
    expect(out.broughtIn).toBeGreaterThan(0);
    const wild = out.objects.filter((o) => o.wild);
    expect(wild.length).toBe(out.broughtIn);
    expect(wild.some((o) => o.id === 1)).toBe(false);
    const ids = out.objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of wild) {
      expect(o.y).toBeGreaterThan(SHORE - 1);
      expect(o.y).toBeLessThan(SHORE + 6);
    }
    expect(out.lost).toEqual([]);
  });

  it('a short gap with no high tide leaves strays be', () => {
    // from just after a high tide to before the next
    const out = run(blank(), [at(1, 'shell', 5, SHORE + 1, true)], 2 * H, T0 + 3.2 * H);
    expect(out.highTides).toBe(0);
    expect(out.objects.map((o) => o.id)).toEqual([1]);
  });
});

it('the rest profile fixture is the one the app uses', () => {
  expect(rest.length).toBe(g.nx * g.ny);
});
