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
 * Zoom limits (ortho half-height). Zooming in stops when the brush would be
 * smaller than BRUSH.minCells grid cells; zooming out stops when the whole
 * diorama fits (or the brush would exceed ~2.2 m).
 */
export function zoomLimits(viewportHeightPx: number, cellSize: number, fitHalfH: number): { min: number; max: number } {
  const perRadius = Math.max(1, viewportHeightPx) / (2 * BRUSH.screenRadiusPx);
  const min = BRUSH.minCells * cellSize * perRadius;
  const max = Math.max(min * 1.5, Math.min(Math.max(CAMERA.maxHalfHeight, fitHalfH), 2.2 * perRadius));
  return { min, max };
}
