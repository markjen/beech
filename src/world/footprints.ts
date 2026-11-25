// Footprints, dragged: laying a trail of prints along a drag path.
//
// A footprints item is one trail of 5-7 prints (src/render/objects.ts
// footprintsMesh), 0.85 m long at size 1, its prints alternating left and
// right along the trail. Dragging with footprints in hand lays one trail
// after another along the pointer's path, each running in the direction of
// travel, so the whole drag reads as one walk. Pure geometry, no DOM —
// the sim only sees the placements, and the main thread drives this.
//
// The joins matter: the last print of one trail and the first print of the
// next must be one stride apart, on opposite sides, or the walk stutters.
// A trail's prints sit at -L/2 + k*stride (stride = L/(prints-1)), so the
// next trail's centre goes one stride past the last print: spacing =
// L * prints/(prints-1). And a trail turned half-way round starts with
// its last print, so flipping the trail by PI swaps which side it starts
// on — but only a 6-print trail (variant 1) starts on the left after the
// turn, so a flipped trail is always variant 1.

import { FOOTPRINT_TRAIL_M, FOOTPRINTS_PER_STROKE_MAX } from '../config';

/** A point on the sand, in sim metres (x alongshore, y cross-shore). */
export interface SandPoint {
  x: number;
  y: number;
}

/** Which side of the direction of travel a print sits on. */
export type PrintSide = -1 | 1;

/** Prints in one trail of this variant (mirrors footprintsMesh). */
export function footprintPrints(variant: number): number {
  return 5 + (variant % 3);
}

/**
 * Which side the far end of a trail sits on, along its direction of travel:
 * the trail's last print. An unflipped trail ends on the side its print
 * count dictates; a trail turned half-way round ends with its first print,
 * on the right.
 */
export function footprintFarSide(variant: number, flipped: boolean): PrintSide {
  if (flipped) return -1;
  return footprintPrints(variant) % 2 === 1 ? -1 : 1;
}

/**
 * The angle and variant for the next trail along `dirAngle`, keeping the
 * prints alternating left and right across the join with the previous
 * trail, whose far end sat on `prevFarSide`. When the previous trail ended
 * on the right, this one must start on the left, so it is turned half-way
 * round — and only a 6-print trail starts on the left after the turn, so
 * the variant is forced to 1. When the previous trail ended on the left,
 * an unflipped trail starts on the right, as it should.
 */
export function footprintOrient(
  dirAngle: number,
  prevFarSide: PrintSide,
  variant: number,
): { angle: number; variant: number; flipped: boolean } {
  if (prevFarSide === -1) {
    return { angle: dirAngle + Math.PI, variant: 1, flipped: true };
  }
  return { angle: dirAngle, variant, flipped: false };
}

/**
 * One stride of the walk: the trail plus the gap to the next trail's first
 * print, so prints stay one stride apart across the join.
 */
export function footprintSpacing(size: number, variant: number): number {
  const prints = footprintPrints(variant);
  return FOOTPRINT_TRAIL_M * size * prints / (prints - 1);
}

/** A drag stroke with the footprints tool, so far. */
export interface FootprintStroke {
  /** centre of the last trail laid down */
  anchor: SandPoint;
  /** side the last trail's far end sits on, along its direction */
  farSide: PrintSide;
  /** trails laid down so far in this stroke (the tap counts as one) */
  count: number;
}

/** One trail to lay down. */
export interface FootprintPlacement extends SandPoint {
  angle: number;
  size: number;
  variant: number;
}

/**
 * Advance a footprints drag stroke toward `to`: lay trail segments from
 * the anchor while the pointer is a stride ahead of it, each running along
 * the drag direction with its prints alternating across the joins, and
 * return them with the updated stroke. `roll` supplies each new trail's
 * size and variant (the size slider's roll); a roll is spent working out
 * whether the pointer has travelled a stride yet, which is harmless.
 * Stops at `maxCount` trails in the stroke.
 */
export function footprintDrag(
  stroke: FootprintStroke,
  to: SandPoint,
  size01: number,
  roll: (size01: number) => { size: number; variant: number },
  maxCount: number = FOOTPRINTS_PER_STROKE_MAX,
): { placements: FootprintPlacement[]; stroke: FootprintStroke } {
  const placements: FootprintPlacement[] = [];
  let { anchor, farSide, count } = stroke;
  while (count < maxCount) {
    const dx = to.x - anchor.x;
    const dy = to.y - anchor.y;
    const dist = Math.hypot(dx, dy);
    const { size, variant: rolled } = roll(size01);
    const dir = Math.atan2(dy, dx);
    const orient = footprintOrient(dir, farSide, rolled);
    const spacing = footprintSpacing(size, orient.variant);
    if (dist < spacing) break;
    const nx = anchor.x + Math.cos(dir) * spacing;
    const ny = anchor.y + Math.sin(dir) * spacing;
    placements.push({ x: nx, y: ny, angle: orient.angle, size, variant: orient.variant });
    anchor = { x: nx, y: ny };
    farSide = footprintFarSide(orient.variant, orient.flipped);
    count++;
  }
  return { placements, stroke: { anchor, farSide, count } };
}
