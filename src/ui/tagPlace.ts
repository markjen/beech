/** A rectangle on screen, as getBoundingClientRect gives it. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where a neighbor's name tag goes: centred above (x, y), its beach's
 * projected top, but kept on screen and off the HUD in `keepOut` (the place
 * card, the tool column). A tag overlapping one is pushed out the shorter
 * way. Returns the tag's top-left corner.
 */
export function placeTag(
  x: number,
  y: number,
  w: number,
  h: number,
  screenW: number,
  screenH: number,
  keepOut: readonly ScreenRect[],
  margin = 8,
): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  let left = clamp(x - w / 2, margin, Math.max(margin, screenW - margin - w));
  let top = clamp(y - h, margin, Math.max(margin, screenH - margin - h));
  for (const r of keepOut) {
    const overlaps = left < r.right + margin && left + w > r.left - margin && top < r.bottom + margin && top + h > r.top - margin;
    if (!overlaps) continue;
    // the cheapest way out: below, above, left of or right of the rectangle
    const moves = [
      { left, top: r.bottom + margin },
      { left, top: r.top - margin - h },
      { left: r.left - margin - w, top },
      { left: r.right + margin, top },
    ].filter((m) => m.left >= margin && m.left + w <= screenW - margin && m.top >= margin && m.top + h <= screenH - margin);
    if (!moves.length) continue;
    moves.sort((a, b) => Math.abs(a.left - left) + Math.abs(a.top - top) - (Math.abs(b.left - left) + Math.abs(b.top - top)));
    ({ left, top } = moves[0]);
  }
  return { left, top };
}
