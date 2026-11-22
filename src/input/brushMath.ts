import { BRUSH, CAMERA } from '../config';

/** World metres per CSS pixel for an orthographic view of half-height `halfH`. */
export function worldPerPx(halfH: number, viewportHeightPx: number): number {
  return (2 * halfH) / Math.max(1, viewportHeightPx);
}

/** The brush is a constant size on screen, so its size on the sand follows zoom. */
export function brushWorldRadius(halfH: number, viewportHeightPx: number, screenRadiusPx = BRUSH.screenRadiusPx): number {
  return screenRadiusPx * worldPerPx(halfH, viewportHeightPx);
}

/**
 * Zoom limits (ortho half-height). Zooming in goes down to
 * CAMERA.minHalfHeight (close enough to look at a shell); zooming out stops
 * when the whole diorama fits (or the brush would exceed ~2.2 m).
 */
export function zoomLimits(viewportHeightPx: number, cellSize: number, fitHalfH: number): { min: number; max: number } {
  const perRadius = Math.max(1, viewportHeightPx) / (2 * BRUSH.screenRadiusPx);
  const brushMin = BRUSH.minCells * cellSize * perRadius;
  const min = Math.min(CAMERA.minHalfHeight, brushMin);
  const max = Math.max(brushMin * 1.5, Math.min(Math.max(CAMERA.maxHalfHeight, fitHalfH), 2.2 * perRadius));
  return { min, max };
}

/** Brush radius on the sand: constant on screen, but never under BRUSH.minCells cells. */
export function brushRadiusOnSand(halfH: number, viewportHeightPx: number, cellSize: number): number {
  return Math.max(BRUSH.minCells * cellSize, brushWorldRadius(halfH, viewportHeightPx));
}
