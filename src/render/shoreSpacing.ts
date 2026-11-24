// How beaches sit along the shore in the game: each beach is a WORLD_SIZE_X
// wide slab, and the step from one slab to the next depends on whether the
// two beaches are linked neighbours. Linked neighbours touch edge to edge,
// so their sand runs together with no seam gap; unlinked beaches keep the
// diorama gap, so each still reads as its own little island.
//
// Pure math, no scene: the layout is unit-tested in tests/shoreSpacing.test.ts.

import { WORLD_SIZE_X } from '../config';

/** gap between dioramas, so each beach reads as its own little island */
export const DIORAMA_GAP = 1.6;
/** centre-to-centre step between two beaches that aren't linked */
export const UNLINKED_STEP = WORLD_SIZE_X + DIORAMA_GAP;

/** Centre-to-centre step across one boundary: linked neighbours touch. */
export function boundaryStep(linked: boolean): number {
  return WORLD_SIZE_X + (linked ? 0 : DIORAMA_GAP);
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
