// How beaches sit along the shore in the game: each beach is a WORLD_SIZE_X
// wide slab, and the step from one slab to the next depends on whether the
// two beaches are linked neighbours. Linked neighbours touch edge to edge,
// so their sand runs together with no seam gap; unlinked beaches keep the
// diorama gap, so each still reads as its own little island.
//
// Pure math, no scene: the layout is unit-tested in tests/shoreSpacing.test.ts.

import { WORLD_SIZE_X } from '../config';
import { swellEnvelope, type Swell } from '../sim/waves';

/** gap between dioramas, so each beach reads as its own little island */
export const DIORAMA_GAP = 1.6;
/** centre-to-centre step between two beaches that aren't linked */
export const UNLINKED_STEP = WORLD_SIZE_X + DIORAMA_GAP;
/** metres inward from a linked boundary over which sand, water and waves blend */
export const SEAM_BLEND_METRES = 1.75;

/** Centre-to-centre step across one boundary: linked neighbours touch. */
export function boundaryStep(linked: boolean): number {
  return WORLD_SIZE_X + (linked ? 0 : DIORAMA_GAP);
}

/**
 * Is the boundary between shore index `lowerIndex` (on -X) and
 * `lowerIndex + 1` (on +X) a linked-neighbour boundary?
 * Each entry's `linked` flag describes its link to the beach nearer index 0.
 */
export function boundaryLinked(lowerIndex: number, isLinked: (index: number) => boolean): boolean {
  return lowerIndex >= 0 ? isLinked(lowerIndex + 1) : isLinked(lowerIndex);
}

/**
 * World-X centres for a run of shore entries. Index 0 (the middle beach —
 * your own when at home, or the one you're visiting) always sits at 0 even
 * when `entries` doesn't include it; each step outward is `boundaryStep` of
 * the entry further from the middle, whose `linked` flag says whether it's a
 * real neighbour of the beach before it along the shore. An entry with no
 * nearer neighbour (a hole in the run) falls back to the unlinked step, so a
 * hole can't collapse the shore.
 */
export function shoreLayout(entries: { index: number; linked?: boolean }[]): Map<number, number> {
  const pos = new Map<number, number>([[0, 0]]);
  const byDistance = [...entries].sort((a, b) => Math.abs(a.index) - Math.abs(b.index) || a.index - b.index);
  for (const e of byDistance) {
    if (e.index === 0) continue;
    const nearer = e.index > 0 ? e.index - 1 : e.index + 1;
    const base = pos.get(nearer);
    if (base === undefined) {
      pos.set(e.index, e.index * UNLINKED_STEP);
      continue;
    }
    const step = boundaryStep(e.linked === true);
    pos.set(e.index, e.index > 0 ? base + step : base - step);
  }
  return pos;
}

/**
 * The shore index whose beach centre is nearest to world-X `x`. Index 0 is
 * always considered at x = 0 (your own beach isn't in `entries` when at home).
 */
export function nearestShoreIndex(x: number, indices: Iterable<number>, pos: ReadonlyMap<number, number>): number {
  let best = 0;
  let bestD = Math.abs(x);
  for (const i of indices) {
    if (i === 0) continue;
    const cx = pos.get(i) ?? i * UNLINKED_STEP;
    const d = Math.abs(cx - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * World-X centres of the drawn beaches in shore window `[lo, hi]`, left to
 * right (ascending X). Always includes index 0 when 0 falls inside the window,
 * even when index 0 is your live beach and absent from `entries`.
 */
export function windowBeachCenters(
  win: readonly [number, number],
  hasEntry: (index: number) => boolean,
  pos: ReadonlyMap<number, number>,
): number[] {
  const out: number[] = [];
  for (let i = win[0]; i <= win[1]; i++) {
    if (i === 0 || hasEntry(i)) out.push(pos.get(i) ?? i * UNLINKED_STEP);
  }
  return out;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/**
 * Blend weight across a linked seam: 0.5 right at the shared boundary
 * (dist = 0), falling smoothly with zero slope at both ends to 0 at
 * `blendMetres` inward. Mirrors the GLSL vertex shader in src/render/shaders.ts.
 */
export function seamWeight(distMetres: number, blendMetres = SEAM_BLEND_METRES): number {
  return 0.5 * (1 - smoothstep(0, blendMetres, Math.max(0, distMetres)));
}

export interface FieldSample {
  sand: number;
  depth: number;
  wet: number;
  foam: number;
}

/**
 * Smoothly reconciles sand height, water depth, wetness and foam across a
 * linked boundary. Mirrors `seamBlend` in src/render/shaders.ts:
 * - At `w = 0.5` (the seam), both sides evaluate to the exact midpoint of
 *   `selfEdge` and `otherEdge`.
 * - At `w = 0` (past the blend zone), returns `self` unchanged.
 * - Positive water-depth spill onto dry sand is gated when `self.sand` rises
 *   well above `selfEdge.sand`, so waves don't float onto tall dry features.
 */
export function blendSeamSample(
  self: FieldSample,
  selfEdge: FieldSample,
  otherEdge: FieldSample,
  w: number,
): FieldSample {
  const sand = self.sand + (otherEdge.sand - selfEdge.sand) * w;
  const dDiff = otherEdge.depth - selfEdge.depth;
  const spillGate = self.depth > 0.003 || dDiff <= 0 ? 1 : smoothstep(0.18, 0, self.sand - selfEdge.sand);
  const depth = Math.max(0, self.depth + dDiff * w * spillGate);
  const wet = clamp01(self.wet + (otherEdge.wet - selfEdge.wet) * w);
  const foam = clamp01(self.foam + (otherEdge.foam - selfEdge.foam) * w);
  return { sand, depth, wet, foam };
}

/**
 * Animated wave surface elevation for a neighbor beach at cross-shore distance
 * `u = max(0, z - zEdge)` and world-X `wx`. Mirrors `evalRaw` in
 * src/render/shaders.ts: matches `tide + swellAt(simTime, swell, ampScale, wx)`
 * at `u = 0` and propagates shoreward at the shallow-water sim's shoaling speed.
 */
export function neighborWaveEta(
  u: number,
  wx: number,
  simTime: number,
  tide: number,
  swell: Swell,
  ampScale = 1,
): number {
  const uu = Math.max(0, u);
  const lag = uu / 3.7 + 0.0042 * uu * uu;
  const shoal = (1 - 0.35 * smoothstep(0, 7, uu)) + 0.25 * smoothstep(10, 16, uu);
  const shoreFade = 1 - smoothstep(19, 23, uu);
  const env = swellEnvelope(simTime, swell);
  let s = 0;
  for (const c of swell) s += c.amp * ampScale * Math.sin(c.omega * (simTime - lag) + c.phase - c.k * wx);
  const hWave = s * env * shoal * shoreFade;
  const swashBoost = Math.max(0, hWave) * 0.25 * smoothstep(13, 17, uu);
  return tide + hWave + swashBoost;
}
