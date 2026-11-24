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
 * CAMERA.minHalfHeight (close enough to look at a shell); zooming out goes up
 * to CAMERA.maxHalfHeight (or CAMERA.maxFitScale times the single-beach fit
 * height on narrow screens) so neighbouring beaches along the shore fit in view.
 * Past either brush bound, brushRadiusOnSand clamps the brush size on the sand.
 */
export function zoomLimits(viewportHeightPx: number, cellSize: number, fitHalfH: number): { min: number; max: number } {
  const perRadius = Math.max(1, viewportHeightPx) / (2 * BRUSH.screenRadiusPx);
  const brushMin = BRUSH.minCells * cellSize * perRadius;
  const min = Math.min(CAMERA.minHalfHeight, brushMin);
  const max = Math.max(brushMin * 1.5, CAMERA.maxHalfHeight, fitHalfH * CAMERA.maxFitScale);
  return { min, max };
}

/** Brush radius on the sand: constant on screen, clamped between BRUSH.minCells cells and BRUSH.maxRadius. */
export function brushRadiusOnSand(halfH: number, viewportHeightPx: number, cellSize: number): number {
  return Math.min(BRUSH.maxRadius, Math.max(BRUSH.minCells * cellSize, brushWorldRadius(halfH, viewportHeightPx)));
}
