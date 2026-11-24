import { describe, expect, it } from 'vitest';
import { brushRadiusOnSand, brushWorldRadius, zoomLimits } from '../src/input/brushMath';
import { BRUSH, CAMERA, GRID_TIERS } from '../src/config';

describe('brush math', () => {
  it('keeps the brush the same on screen: world size scales with zoom', () => {
    const r1 = brushWorldRadius(4, 800);
    const r2 = brushWorldRadius(8, 800);
    expect(r2 / r1).toBeCloseTo(2, 6);
    // and equals screenRadiusPx worth of world units
    expect(r1).toBeCloseTo((BRUSH.screenRadiusPx * 8) / 800, 6);
  });

  it('zoom limits keep the brush within sane world sizes', () => {
    const g = GRID_TIERS.medium;
    const fitHalfH = 20;
    for (const h of [390, 800, 1080, 1440]) {
      const { min, max } = zoomLimits(h, g.dx, fitHalfH);
      // zoom in close; the brush on the sand never drops below minCells
      expect(min).toBeLessThanOrEqual(CAMERA.minHalfHeight);
      expect(brushRadiusOnSand(min, h, g.dx)).toBeCloseTo(BRUSH.minCells * g.dx, 6);
      // zoom out far enough to see neighbouring beaches; the brush never exceeds BRUSH.maxRadius
      expect(max).toBeGreaterThanOrEqual(CAMERA.maxHalfHeight);
      expect(max).toBeGreaterThanOrEqual(fitHalfH * CAMERA.maxFitScale);
      expect(brushRadiusOnSand(max, h, g.dx)).toBeLessThanOrEqual(BRUSH.maxRadius + 1e-6);
      expect(brushRadiusOnSand(max, h, g.dx)).toBeCloseTo(Math.min(BRUSH.maxRadius, brushWorldRadius(max, h)), 6);
      expect(max).toBeGreaterThan(min);
    }
  });
});
