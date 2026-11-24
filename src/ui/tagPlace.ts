/** A rectangle on screen, as getBoundingClientRect gives it. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where a neighbor's name tag goes: floating along the side edge of the screen
 * (left edge for beaches on the left/center, right edge for beaches on the
 * right) so it never sits over and blocks viewing of the beach. Vertically it
 * tracks the beach's projected y while staying on-screen and off any HUD or
 * already-placed tags in `keepOut` by shifting vertically along the edge. If
 * the preferred edge has no room, it falls back to the opposite edge.
 */
export function placeTag(
  x: number,
  y: number,
  w: number,
  h: number,
  screenW: number,
  screenH: number,
  keepOut: readonly ScreenRect[],
  margin = 14,
  gap = 8,
): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const minTop = margin;
  const maxTop = Math.max(margin, screenH - margin - h);
  const leftEdge = margin;
  const rightEdge = Math.max(margin, screenW - margin - w);
  const preferRight = x > screenW / 2;
  const edges = preferRight ? [rightEdge, leftEdge] : [leftEdge, rightEdge];
  const idealTop = clamp(y - h / 2, minTop, maxTop);

  const hits = (left: number, top: number) =>
    keepOut.some(
      (r) => left < r.right + gap && left + w > r.left - gap && top < r.bottom + gap && top + h > r.top - gap,
    );

  for (const edgeLeft of edges) {
    if (!hits(edgeLeft, idealTop)) return { left: edgeLeft, top: idealTop };
    const candidates: number[] = [minTop, maxTop];
    for (const r of keepOut) {
      if (edgeLeft < r.right + gap && edgeLeft + w > r.left - gap) {
        candidates.push(r.bottom + gap, r.top - gap - h);
      }
    }
    const valid = candidates
      .filter((t) => t >= minTop && t <= maxTop && !hits(edgeLeft, t))
      .sort((a, b) => Math.abs(a - idealTop) - Math.abs(b - idealTop));
    if (valid.length) return { left: edgeLeft, top: valid[0] };
  }

  return { left: edges[0], top: idealTop };
}
