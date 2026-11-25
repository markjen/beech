import { describe, expect, it } from 'vitest';

import { WORLD_SIZE_X } from '../src/config';
import {
  SEAM_BLEND_METRES,
  blendSeamSample,
  boundaryLinked,
  boundaryStep,
  indicesOverlapping,
  nearestShoreIndex,
  neighborWaveEta,
  seamWeight,
  shoreLayout,
  shoreRowOrder,
  stickyWindow,
  UNLINKED_STEP,
  visibleShoreSpan,
  windowBeachCenters,
} from '../src/render/shoreSpacing';
import { makeSwell, swellAt } from '../src/sim/waves';

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

  it('boundaryLinked reads the entry further from index 0 on both sides', () => {
    const flags = new Map<number, boolean>([
      [-2, false],
      [-1, true],
      [1, true],
      [2, false],
    ]);
    const linked = (i: number) => flags.get(i) === true;
    expect(boundaryLinked(-2, linked)).toBe(false); // (-2, -1) governed by -2
    expect(boundaryLinked(-1, linked)).toBe(true); // (-1, 0) governed by -1
    expect(boundaryLinked(0, linked)).toBe(true); // (0, +1) governed by +1
    expect(boundaryLinked(1, linked)).toBe(false); // (+1, +2) governed by +2
  });
});

describe('the settings panel shore list', () => {
  it('lists the panel rows nearest first, left then right at each step out', () => {
    expect(shoreRowOrder(2, 2)).toEqual([1, -1, 2, -2]);
    expect(shoreRowOrder(0, 3)).toEqual([-1, -2, -3]);
    expect(shoreRowOrder(3, 0)).toEqual([1, 2, 3]);
    expect(shoreRowOrder(0, 0)).toEqual([]);
  });
});

describe('seam blending and neighbor waves', () => {
  it('seamWeight is 0.5 at the boundary and smoothly reaches 0 at SEAM_BLEND_METRES', () => {
    expect(seamWeight(0)).toBeCloseTo(0.5, 9);
    expect(seamWeight(SEAM_BLEND_METRES / 2)).toBeCloseTo(0.25, 9);
    expect(seamWeight(SEAM_BLEND_METRES)).toBeCloseTo(0, 9);
    expect(seamWeight(SEAM_BLEND_METRES + 1)).toBe(0);
  });

  it('blendSeamSample is exact-symmetric at the seam and leaves interior unchanged', () => {
    const a = { sand: 0.12, depth: 0.18, wet: 0.9, foam: 0.7 };
    const b = { sand: 0.24, depth: 0.06, wet: 0.4, foam: 0.2 };
    const fromA = blendSeamSample(a, a, b, seamWeight(0));
    const fromB = blendSeamSample(b, b, a, seamWeight(0));
    expect(fromA.sand).toBeCloseTo(fromB.sand, 9);
    expect(fromA.depth).toBeCloseTo(fromB.depth, 9);
    expect(fromA.wet).toBeCloseTo(fromB.wet, 9);
    expect(fromA.foam).toBeCloseTo(fromB.foam, 9);
    expect(fromA.sand).toBeCloseTo(0.18, 9);
    expect(fromA.depth).toBeCloseTo(0.12, 9);
    // outside the blend zone (w = 0), the interior is untouched
    expect(blendSeamSample(a, a, b, 0)).toEqual(a);
  });

  it('blendSeamSample never spills water onto a tall dry sand feature inland', () => {
    const edgeA = { sand: 0.05, depth: 0, wet: 0.5, foam: 0 };
    const edgeB = { sand: -0.05, depth: 0.15, wet: 1, foam: 0.4 };
    const tallDryA = { sand: 0.45, depth: 0, wet: 0, foam: 0 };
    const res = blendSeamSample(tallDryA, edgeA, edgeB, seamWeight(0.5));
    expect(res.depth).toBe(0);
  });

  it('neighborWaveEta matches the offshore ocean swell identically at z = zEdge and propagates shoreward', () => {
    const swell = makeSwell(3);
    const tide = 0.08;
    const t = 42.5;
    for (const wx of [-32, -16, 0, 16, 32]) {
      expect(neighborWaveEta(0, wx, t, tide, swell, 1)).toBeCloseTo(tide + swellAt(t, swell, 1, wx), 9);
    }
    // waves off -> flat tide everywhere
    expect(neighborWaveEta(12, 16, t, tide, swell, 0)).toBeCloseTo(tide, 9);
    // shoreward lag: surface at u = 8m differs from u = 0m as crests travel in
    let maxDiff = 0;
    for (let s = 0; s < 12; s += 0.5) {
      maxDiff = Math.max(maxDiff, Math.abs(neighborWaveEta(8, 16, s, tide, swell, 1) - neighborWaveEta(0, 16, s, tide, swell, 1)));
    }
    expect(maxDiff).toBeGreaterThan(0.05);
  });
});

describe('drawn window follows the view', () => {
  // a view rotated 45°: a diamond on the ground, 100 m corner to corner
  const diamond = [
    { x: 0, z: 50 },
    { x: 50, z: 0 },
    { x: 0, z: -50 },
    { x: -50, z: 0 },
  ];

  it('measures the stretch of a band the footprint covers', () => {
    expect(visibleShoreSpan(diamond, -1, 1)).toEqual([-50, 50]);
    // a band away from the middle is narrower: |x| <= 50 - |z|
    const [lo, hi] = visibleShoreSpan(diamond, 30, 40)!;
    expect(lo).toBeCloseTo(-20);
    expect(hi).toBeCloseTo(20);
    expect(visibleShoreSpan(diamond, 60, 70)).toBeNull();
  });

  it('a band wholly inside an axis-aligned view spans the view', () => {
    const box = [
      { x: -70, z: 40 },
      { x: 70, z: 40 },
      { x: 70, z: -40 },
      { x: -70, z: -40 },
    ];
    expect(visibleShoreSpan(box, -16, 16)).toEqual([-70, 70]);
  });

  it('finds every beach overlapping the stretch, edges included', () => {
    const xFor = (i: number) => i * UNLINKED_STEP;
    // ±70 m reaches into the slabs centred at ±67.2 m and ±100.8 m (edge at 84.8)
    expect(indicesOverlapping(-70, 70, -10, 10, xFor)).toEqual([-2, 2]);
    expect(indicesOverlapping(-90, 90, -10, 10, xFor)).toEqual([-3, 3]);
    // clamped to what's loaded
    expect(indicesOverlapping(-90, 90, -1, 10, xFor)).toEqual([-1, 3]);
    expect(indicesOverlapping(500, 600, -3, 3, xFor)).toBeNull();
    // a narrow phone view still covers the beach under it
    expect(indicesOverlapping(-5, 5, -10, 10, xFor)).toEqual([0, 0]);
  });

  it('grows at once but only shrinks once a beach is well out of view', () => {
    // first draw: just what's needed
    expect(stickyWindow(null, [-2, 2], [-3, 3])).toEqual([-2, 2]);
    // pan right: the new beach comes in now, the old left one stays while it's near
    expect(stickyWindow([-2, 2], [-1, 3], [-2, 4])).toEqual([-2, 3]);
    // pan back: nothing to rebuild
    expect(stickyWindow([-2, 3], [-2, 2], [-3, 3])).toEqual([-2, 3]);
    // panned on: the far one is let go
    expect(stickyWindow([-2, 3], [0, 4], [-1, 5])).toEqual([0, 4]);
    // jumped far away: start over
    expect(stickyWindow([-2, 2], [20, 22], [19, 23])).toEqual([20, 22]);
  });
});
