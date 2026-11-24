import { describe, expect, it } from 'vitest';

import { WORLD_SIZE_X } from '../src/config';
import { boundaryStep, shoreLayout } from '../src/render/shoreSpacing';

// a slab spans [centre - 16, centre + 16]; the edge-to-edge gap between two
// neighbours is their centre distance minus one slab width
const edgeGap = (a: number, b: number) => Math.abs(b - a) - WORLD_SIZE_X;

describe('shore spacing', () => {
  it('linked neighbours touch edge to edge, with no gap', () => {
    const pos = shoreLayout([
      { index: 0 },
      { index: 1, linked: true },
    ]);
    expect(pos.get(0)).toBe(0);
    expect(pos.get(1)).toBe(WORLD_SIZE_X);
    expect(edgeGap(pos.get(0)!, pos.get(1)!)).toBeCloseTo(0, 9);
    expect(boundaryStep(true)).toBe(WORLD_SIZE_X);
  });

  it('unlinked beaches keep the diorama gap', () => {
    const pos = shoreLayout([
      { index: 0 },
      { index: 1, linked: false },
      { index: -1, linked: false },
    ]);
    expect(edgeGap(pos.get(0)!, pos.get(1)!)).toBeCloseTo(1.6, 9);
    expect(edgeGap(pos.get(0)!, pos.get(-1)!)).toBeCloseTo(1.6, 9);
    expect(boundaryStep(false)).toBe(WORLD_SIZE_X + 1.6);
  });

  it('a linked stretch stays contiguous while the next stretch keeps its gap', () => {
    // Rose (0) — Riley (1, linked) — then an unlinked beach further left (2)
    const pos = shoreLayout([
      { index: 0 },
      { index: 1, linked: true },
      { index: 2, linked: false },
      { index: -1, linked: false },
    ]);
    expect(edgeGap(pos.get(0)!, pos.get(1)!)).toBeCloseTo(0, 9);
    expect(edgeGap(pos.get(1)!, pos.get(2)!)).toBeCloseTo(1.6, 9);
    expect(edgeGap(pos.get(0)!, pos.get(-1)!)).toBeCloseTo(1.6, 9);
    expect(pos.get(2)).toBe(WORLD_SIZE_X + WORLD_SIZE_X + 1.6);
  });

  it('a whole linked stretch is one contiguous run, on either side', () => {
    const pos = shoreLayout([
      { index: 0 },
      { index: 1, linked: true },
      { index: 2, linked: true },
      { index: -1, linked: true },
      { index: -2, linked: true },
    ]);
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [0, -1],
      [-1, -2],
    ] as const) {
      expect(edgeGap(pos.get(a)!, pos.get(b)!)).toBeCloseTo(0, 9);
    }
    expect(pos.get(2)).toBe(2 * WORLD_SIZE_X);
    expect(pos.get(-2)).toBe(-2 * WORLD_SIZE_X);
  });

  it('a hole in the run falls back to the unlinked step instead of collapsing', () => {
    const pos = shoreLayout([
      { index: 0 },
      { index: 2, linked: true },
    ]);
    expect(pos.get(2)).toBe(2 * (WORLD_SIZE_X + 1.6));
  });

  it('never overlaps two slabs', () => {
    const entries = [
      { index: 0 },
      { index: 1, linked: true },
      { index: 2, linked: false },
      { index: 3, linked: true },
      { index: -1, linked: true },
      { index: -2, linked: false },
    ];
    const pos = shoreLayout(entries);
    const centres = [...pos.values()].sort((a, b) => a - b);
    for (let i = 1; i < centres.length; i++) {
      expect(centres[i] - centres[i - 1]).toBeGreaterThanOrEqual(WORLD_SIZE_X);
    }
  });
});
