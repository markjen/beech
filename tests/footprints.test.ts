import { describe, expect, it } from 'vitest';
import { BeachSim } from '../src/sim/beachSim';
import { GRID_TIERS, PROFILE, SIM_HZ } from '../src/config';
import {
  footprintDrag,
  footprintFarSide,
  footprintOrient,
  footprintPrints,
  footprintSpacing,
  type FootprintStroke,
  type PrintSide,
} from '../src/world/footprints';

const g = GRID_TIERS.low;

/** A roll that always lays the same trail (size 1, variant 2: 7 prints). */
const steadyRoll = () => ({ size: 1, variant: 2 });

describe('footprint geometry', () => {
  it('a trail has 5-7 prints by variant', () => {
    expect(footprintPrints(1)).toBe(6);
    expect(footprintPrints(2)).toBe(7);
    expect(footprintPrints(3)).toBe(5);
  });

  it('one stride is the trail plus the gap to the next first print', () => {
    // variant 1: 6 prints, stride 0.85/5, so spacing is 0.85 + 0.17
    expect(footprintSpacing(1, 1)).toBeCloseTo(1.02, 10);
    // variant 2: 7 prints, stride 0.85/6
    expect(footprintSpacing(1, 2)).toBeCloseTo(0.85 * 7 / 6, 10);
    // spacing scales with the size slider
    expect(footprintSpacing(0.5, 1)).toBeCloseTo(0.51, 10);
  });

  it('the far side follows the print count, and a flipped trail swaps the side of its original first print', () => {
    expect(footprintFarSide(2, false)).toBe(-1); // 7 prints, last is print 6, side -1
    expect(footprintFarSide(1, false)).toBe(1); // 6 prints, last is print 5, side +1
    expect(footprintFarSide(3, false)).toBe(-1); // 5 prints, last is print 4, side -1
    expect(footprintFarSide(2, true)).toBe(1);
    expect(footprintFarSide(1, true)).toBe(1);
  });

  it('orientation keeps the prints alternating across the join', () => {
    expect(footprintOrient(0, 1, 2)).toEqual({ angle: 0, variant: 2, flipped: false });
    expect(footprintOrient(0, -1, 1)).toEqual({ angle: Math.PI, variant: 2, flipped: true });
    expect(footprintOrient(Math.PI / 2, -1, 3)).toEqual({ angle: Math.PI / 2 + Math.PI, variant: 3, flipped: true });
  });
});

describe('footprintDrag', () => {
  const stroke: FootprintStroke = { anchor: { x: 0, y: 0 }, farSide: -1, size: 1, count: 1 };

  it('lays trails along a straight drag, one stride apart', () => {
    const { placements, stroke: next } = footprintDrag(stroke, { x: 5, y: 0 }, 0.35, steadyRoll);
    const spacing = footprintSpacing(1, 2);
    expect(placements).toHaveLength(5);
    expect(placements.map((p) => p.x)).toEqual([1, 2, 3, 4, 5].map((n) => expect.closeTo(n * spacing, 10)));
    expect(placements.every((p) => Math.abs(p.y) < 1e-9)).toBe(true);
    expect(placements.map((p) => p.angle)).toEqual([Math.PI, 0, Math.PI, 0, Math.PI]);
    expect(next.anchor.x).toBeCloseTo(5 * spacing, 10);
    expect(next.anchor.y).toBe(0);
    expect(next.count).toBe(6);
    expect(next.farSide).toBe(1);
  });

  it('lays nothing when the pointer has not travelled a stride', () => {
    const { placements, stroke: next } = footprintDrag(stroke, { x: 0.5, y: 0 }, 0.35, steadyRoll);
    expect(placements).toHaveLength(0);
    expect(next).toEqual(stroke);
  });

  it('follows the pointer round a bend', () => {
    const first = footprintDrag(stroke, { x: 3, y: 0 }, 0.35, steadyRoll);
    expect(first.placements.length).toBeGreaterThan(0);
    const second = footprintDrag(first.stroke, { x: 3, y: 3 }, 0.35, steadyRoll);
    expect(second.placements.length).toBeGreaterThan(0);
    // each new trail runs along the direction it was laid in (an angle and
    // the same angle half a turn round are the same line, so compare mod PI)
    let prev = first.stroke.anchor;
    for (const p of second.placements) {
      const dir = Math.atan2(3 - prev.y, 3 - prev.x);
      const norm = (a: number) => ((a % Math.PI) + Math.PI) % Math.PI;
      expect(norm(p.angle)).toBeCloseTo(norm(dir), 10);
      expect(p.y).toBeGreaterThan(prev.y);
      expect(p.x).toBeGreaterThanOrEqual(prev.x);
      prev = { x: p.x, y: p.y };
    }
  });

  it('stops at the per-stroke cap', () => {
    const { placements } = footprintDrag(stroke, { x: 500, y: 0 }, 0.35, steadyRoll, 3);
    expect(placements).toHaveLength(2); // count starts at 1 (the tap), cap is 3
  });

  it('the prints of a whole walk alternate left/right at one stride apart', () => {
    // the tap: one trail at the origin, variant 2, running along +x
    const tapVariant = 2;
    const tapPrints = footprintPrints(tapVariant);
    const tapStride = 0.85 / (tapPrints - 1);
    const prints: { along: number; side: PrintSide }[] = [];
    for (let k = 0; k < tapPrints; k++) {
      prints.push({ along: -0.425 + k * tapStride, side: k % 2 === 0 ? -1 : 1 });
    }
    let prevFar: PrintSide = footprintFarSide(tapVariant, false);
    const walk = footprintDrag(
      { anchor: { x: 0, y: 0 }, farSide: prevFar, size: 1, count: 1 },
      { x: 10, y: 0 },
      0.35,
      // cycle the variants so the walk mixes 5-, 6- and 7-print trails
      (() => {
        const vs = [2, 1, 3];
        let i = 0;
        return () => ({ size: 1, variant: vs[i++ % vs.length] });
      })(),
    );
    expect(walk.placements.length).toBeGreaterThan(5);
    for (const p of walk.placements) {
      const dir = 0; // straight along +x
      const diff = Math.atan2(Math.sin(p.angle - dir), Math.cos(p.angle - dir));
      const flipped = Math.abs(Math.abs(diff) - Math.PI) < 1e-9;
      const n = footprintPrints(p.variant);
      const stride = 0.85 / (n - 1);
      for (let k = 0; k < n; k++) {
        const local = -0.425 + k * stride;
        prints.push({ along: p.x + (flipped ? -local : local), side: (k % 2 === 0) === flipped ? 1 : -1 });
      }
    }
    prints.sort((a, b) => a.along - b.along);
    // every print alternates side with its neighbour, at about one stride
    for (let i = 1; i < prints.length; i++) {
      expect(prints[i].side).not.toBe(prints[i - 1].side);
      const gap = prints[i].along - prints[i - 1].along;
      expect(gap).toBeGreaterThan(0.1);
      expect(gap).toBeLessThan(0.25);
    }
  });
});

const footprints = (x: number, y: number) => ({ kind: 'footprints' as const, item: 'footprints', x, y, angle: 0, size: 1, variant: 1 });

describe('footprint washout', () => {
  it('washes away trails reached by swash and keeps the dry ones from the same stroke', () => {
    const sim = new BeachSim(g, 1, { tide: false });
    const atShore = sim.placeObject(footprints(10, PROFILE.shoreline), 'footprints-1');
    const inland = sim.placeObject(footprints(10, 29), 'footprints-1');
    for (let i = 0; i < 20 * SIM_HZ && sim.objects.persisted().some((o) => o.id === atShore.id); i++) {
      sim.step(1 / SIM_HZ);
    }
    expect(sim.objects.persisted().filter((o) => o.kind === 'footprints')).toEqual([inland]);
    expect(sim.objects.takeWashedFootprints()).toBe(true);
    expect(sim.objects.takeWashedFootprints()).toBe(false);
    expect(sim.objects.takeLost()).toEqual([]);
  });
});

describe('grouped placement undo', () => {
  it('one drag stroke undoes and redoes as one step', () => {
    const sim = new BeachSim(g, 1);
    const base = sim.undo.undoCount;
    sim.placeObject(footprints(10, 20), 'footprints-1');
    sim.placeObject(footprints(11, 20), 'footprints-1');
    sim.placeObject(footprints(12, 20), 'footprints-1');
    expect(sim.objects.persisted()).toHaveLength(3);
    expect(sim.undo.undoCount).toBe(base + 1);
    expect(sim.undoStroke(false)).toBe(true);
    expect(sim.objects.persisted()).toHaveLength(0);
    expect(sim.undo.undoCount).toBe(base);
    expect(sim.redoStroke(false)).toBe(true);
    expect(sim.objects.persisted()).toHaveLength(3);
  });

  it('separate strokes stay separate undo steps', () => {
    const sim = new BeachSim(g, 1);
    sim.placeObject(footprints(10, 20), 'footprints-1');
    sim.placeObject(footprints(11, 20), 'footprints-1');
    sim.placeObject(footprints(12, 20), 'footprints-2');
    expect(sim.undo.undoCount).toBe(2);
    sim.undoStroke(false);
    expect(sim.objects.persisted()).toHaveLength(2);
    sim.undoStroke(false);
    expect(sim.objects.persisted()).toHaveLength(0);
  });

  it('an ungrouped placement stays its own undo step', () => {
    const sim = new BeachSim(g, 1);
    sim.placeObject(footprints(10, 20), 'footprints-1');
    sim.placeObject(footprints(11, 20));
    expect(sim.undo.undoCount).toBe(2);
    sim.undoStroke(false);
    expect(sim.objects.persisted()).toHaveLength(1);
  });

  it('a new stroke after an undo clears the redo stack', () => {
    const sim = new BeachSim(g, 1);
    sim.placeObject(footprints(10, 20), 'footprints-1');
    sim.placeObject(footprints(11, 20), 'footprints-1');
    sim.undoStroke(false);
    expect(sim.undo.redoCount).toBe(1);
    sim.placeObject(footprints(12, 20), 'footprints-2');
    expect(sim.undo.redoCount).toBe(0);
    expect(sim.objects.persisted()).toHaveLength(1);
  });
});
