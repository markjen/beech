import { describe, expect, it } from 'vitest';

import { WORLD_SIZE_X } from '../src/config';
import { boundaryStep, nearestShoreIndex, shoreLayout, windowBeachCenters } from '../src/render/shoreSpacing';

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

  it('anchors index 0 at 0 even when entries omits index 0 (standing on your own beach)', () => {
    // NeighborView.entries omits index 0 while at home (!visiting); direct
    // linked neighbours at +1 and -1 must still touch index 0 with zero gap.
    const pos = shoreLayout([
      { index: 1, linked: true },
      { index: 2, linked: false },
      { index: -1, linked: true },
    ]);
    expect(pos.get(0)).toBe(0);
    expect(pos.get(1)).toBe(WORLD_SIZE_X);
    expect(pos.get(-1)).toBe(-WORLD_SIZE_X);
    expect(edgeGap(0, pos.get(1)!)).toBeCloseTo(0, 9);
    expect(edgeGap(0, pos.get(-1)!)).toBeCloseTo(0, 9);
    expect(edgeGap(pos.get(1)!, pos.get(2)!)).toBeCloseTo(1.6, 9);
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

  it('nearestShoreIndex returns 0 at home even when index 0 is not in entries', () => {
    const pos = shoreLayout([
      { index: 1, linked: true },
      { index: -1, linked: false },
    ]);
    const keys = [1, -1];
    expect(nearestShoreIndex(0, keys, pos)).toBe(0);
    expect(nearestShoreIndex(15.5, keys, pos)).toBe(0);
    expect(nearestShoreIndex(16.5, keys, pos)).toBe(1);
    expect(nearestShoreIndex(-17, keys, pos)).toBe(-1);
  });

  it('windowBeachCenters includes index 0 at home and stays ordered left to right', () => {
    const pos = shoreLayout([
      { index: 1, linked: true },
      { index: -1, linked: false },
    ]);
    const has = (i: number) => i === 1 || i === -1;
    expect(windowBeachCenters([-1, 1], has, pos)).toEqual([-(WORLD_SIZE_X + 1.6), 0, WORLD_SIZE_X]);
    // when index 0 is outside the window, only the drawn entries are returned
    expect(windowBeachCenters([1, 2], has, pos)).toEqual([WORLD_SIZE_X]);
  });
});
