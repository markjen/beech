import { SHORE_LIGHT } from '../config';
import { mixPalette } from '../palette';
import type { LiveState } from './live';

type V3 = [number, number, number];

/** A beach's centre along the shore (world X) and the real place whose sky it has. */
export interface ShorePlace {
  x: number;
  location: string;
}

/** The two places either side of the view and how far across from `a` to `b` the light is (0..1). */
export interface ShoreLightMix {
  a: string;
  b: string;
  t: number;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Which places light the view at world-X `x`: the beaches whose centres
 * bracket it. Each beach keeps its own light around its centre, and the light
 * crosses over in the middle of the gap (SHORE_LIGHT.blendSpan of it).
 * Past either end of the shore, the end beach's light. Null with no places.
 */
export function shoreLightMix(x: number, places: readonly ShorePlace[]): ShoreLightMix | null {
  if (!places.length) return null;
  const sorted = [...places].sort((p, q) => p.x - q.x);
  if (x <= sorted[0].x) return { a: sorted[0].location, b: sorted[0].location, t: 0 };
  const lastP = sorted[sorted.length - 1];
  if (x >= lastP.x) return { a: lastP.location, b: lastP.location, t: 0 };
  let i = 0;
  while (sorted[i + 1].x <= x) i++;
  const p = sorted[i];
  const q = sorted[i + 1];
  if (p.location === q.location || q.x - p.x < 1e-6) return { a: p.location, b: p.location, t: 0 };
  const along = (x - p.x) / (q.x - p.x);
  const span = Math.max(1e-3, Math.min(1, SHORE_LIGHT.blendSpan));
  const k = Math.max(0, Math.min(1, (along - (1 - span) / 2) / span));
  if (k <= 0) return { a: p.location, b: p.location, t: 0 };
  if (k >= 1) return { a: q.location, b: q.location, t: 0 };
  return { a: p.location, b: q.location, t: smooth(k) };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Blend two unit vectors (normalized lerp); falls back to `a` if they cancel. */
function mixDir(a: V3, b: V3, t: number): V3 {
  const v: V3 = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-4) return t < 0.5 ? a : b;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * The light partway between two places: palette, sun, moon and night all
 * blended. The rest (local time, tide) is the nearer place's.
 */
export function mixLive(a: LiveState, b: LiveState, t: number): LiveState {
  if (t <= 0 || a === b) return a;
  if (t >= 1) return b;
  const near = t < 0.5 ? a : b;
  const palette = mixPalette(a.palette, b.palette, t);
  palette.sunDir = mixDir(a.palette.sunDir, b.palette.sunDir, t);
  return {
    ...near,
    palette,
    sky: {
      sun: { dir: mixDir(a.sky.sun.dir, b.sky.sun.dir, t), elevation: lerp(a.sky.sun.elevation, b.sky.sun.elevation, t) },
      moon: {
        ...near.sky.moon,
        dir: mixDir(a.sky.moon.dir, b.sky.moon.dir, t),
        elevation: lerp(a.sky.moon.elevation, b.sky.moon.elevation, t),
      },
      night: lerp(a.sky.night, b.sky.night, t),
    },
  };
}
