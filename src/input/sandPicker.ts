import type { Ray } from '@babylonjs/core/Culling/ray';

import type { GridSpec } from '../config';
import { ORIGIN_X, ORIGIN_Z } from '../render/beachRenderer';

/**
 * Ray-casts against the latest sand heightfield so the finger lands on the
 * actual (possibly dug) surface, not a flat plane.
 */
export class SandPicker {
  readonly sand: Float32Array;
  /** water depth per cell (latest frame) */
  readonly water: Float32Array;

  constructor(readonly g: GridSpec, rest: Float32Array) {
    this.sand = rest.slice();
    this.water = new Float32Array(rest.length);
  }

  /** Copy the sand and water channels out of a packed RGBA frame. */
  updateFromFrame(buf: Float32Array): void {
    const s = this.sand;
    const w = this.water;
    const n = s.length;
    const n4 = n & ~3;
    let k = 0;
    let o = 0;
    for (; k < n4; k += 4, o += 16) {
      s[k] = buf[o];
      w[k] = buf[o + 1];
      s[k + 1] = buf[o + 4];
      w[k + 1] = buf[o + 5];
      s[k + 2] = buf[o + 8];
      w[k + 2] = buf[o + 9];
      s[k + 3] = buf[o + 12];
      w[k + 3] = buf[o + 13];
    }
    for (; k < n; k++, o += 4) {
      s[k] = buf[o];
      w[k] = buf[o + 1];
    }
  }

  /** Water depth at world (x, z), nearest cell; 0 outside the grid. */
  waterAt(x: number, z: number): number {
    const { nx, ny, dx } = this.g;
    const i = Math.round((x - ORIGIN_X) / dx - 0.5);
    const j = Math.round((z - ORIGIN_Z) / dx - 0.5);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return 0;
    return this.water[j * nx + i];
  }

  /** World z of the furthest-up-the-beach wet cell in the column at world x (or NaN). */
  runupZ(x: number): number {
    const { nx, ny, dx } = this.g;
    const i = Math.round((x - ORIGIN_X) / dx - 0.5);
    if (i < 0 || i >= nx) return NaN;
    for (let j = ny - 1; j >= 0; j--) {
      if (this.water[j * nx + i] > 0.006) return ORIGIN_Z + (j + 0.5) * dx;
    }
    return NaN;
  }

  /** Bilinear sand height at world (x, z); NaN outside the grid. */
  heightAt(x: number, z: number): number {
    const { nx, ny, dx } = this.g;
    const fi = (x - ORIGIN_X) / dx - 0.5;
    const fj = (z - ORIGIN_Z) / dx - 0.5;
    if (fi < 0 || fj < 0 || fi > nx - 1 || fj > ny - 1) return NaN;
    const i0 = Math.min(nx - 2, Math.floor(fi));
    const j0 = Math.min(ny - 2, Math.floor(fj));
    const tx = fi - i0;
    const tz = fj - j0;
    const k = j0 * nx + i0;
    const s = this.sand;
    return (s[k] * (1 - tx) + s[k + 1] * tx) * (1 - tz) + (s[k + nx] * (1 - tx) + s[k + nx + 1] * tx) * tz;
  }

  /** First hit of the ray with the sand surface, as world {x, z, y}. */
  pick(ray: Ray): { x: number; y: number; z: number } | null {
    return pickHeightfield(ray, this.g.dx, (x, z) => this.heightAt(x, z));
  }
}

/** First hit of a ray with any heightfield `heightAt(x, z)` (returns NaN outside its bounds). */
export function pickHeightfield(
  ray: Ray,
  dx: number,
  heightAt: (x: number, z: number) => number,
): { x: number; y: number; z: number } | null {
  const o = ray.origin;
  const d = ray.direction;
  if (d.y >= -1e-4) return null;
  const yTop = 2.5;
  const yBot = -3;
  const t0 = (yTop - o.y) / d.y;
  const t1 = (yBot - o.y) / d.y;
  const hm = Math.max(0.15, Math.hypot(d.x, d.z));
  const ds = (dx * 0.5) / hm;
  let tPrev = t0;
  let wasInside = false;
  for (let t = t0; t <= t1; t += ds) {
    const x = o.x + d.x * t;
    const y = o.y + d.y * t;
    const z = o.z + d.z * t;
    const h = heightAt(x, z);
    if (Number.isNaN(h)) {
      if (wasInside) break;
      tPrev = t;
      continue;
    }
    wasInside = true;
    if (y <= h) {
      // refine between tPrev and t
      let a = tPrev;
      let b = t;
      for (let it = 0; it < 8; it++) {
        const m = (a + b) / 2;
        const hy = heightAt(o.x + d.x * m, o.z + d.z * m);
        if (!Number.isNaN(hy) && o.y + d.y * m <= hy) b = m;
        else a = m;
      }
      return { x: o.x + d.x * b, y: o.y + d.y * b, z: o.z + d.z * b };
    }
    tPrev = t;
  }
  return null;
}
