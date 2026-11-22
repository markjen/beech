import { PROFILE, type GridSpec } from '../config';

/** Deterministic hash noise in [0,1). */
export function hash2(x: number, y: number, seed = 1): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

/** Smooth 1D value noise. */
export function noise1(x: number, seed = 1): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash2(i, 0, seed);
  const b = hash2(i + 1, 0, seed);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Height (m, sea level = 0) of the undisturbed beach at alongshore x (m from
 * the left edge) and cross-shore distance y (m from the offshore edge).
 */
export function restHeight(x: number, y: number, seed = 1): number {
  const P = PROFILE;
  // cusps + low-frequency wobble move the shoreline back and forth
  const wobble =
    P.cuspAmp * Math.sin((2 * Math.PI * x) / P.cuspLength + 0.7) * 0.6 +
    (noise1(x / 9, seed) - 0.5) * P.cuspAmp * 1.6;
  const s = y - (P.shoreline + wobble); // distance landward of the shoreline

  let h: number;
  if (s < 0) {
    // Dean-like equilibrium profile offshore: depth = A * d^(2/3), shifted by
    // c so the slope stays finite at the shoreline.
    const c = 2;
    const A = P.offshoreDepth / (Math.pow(P.shoreline + c, 2 / 3) - Math.pow(c, 2 / 3));
    h = -A * (Math.pow(-s + c, 2 / 3) - Math.pow(c, 2 / 3));
  } else {
    const swash = s * P.swashSlope;
    const bermStart = P.bermHeight / P.swashSlope; // where the swash slope reaches berm height
    if (s < bermStart) {
      h = swash;
    } else {
      // round over the berm then rise gently to the back
      const t = s - bermStart;
      const crest = P.bermHeight + 0.08 * Math.sin(Math.min(1, t / 2.5) * Math.PI * 0.5);
      h = crest + (P.backHeight - P.bermHeight) * smoothstep(2.5, 14, t);
    }
    // soften the swash/berm corner
    const k = smoothstep(bermStart - 1.5, bermStart + 1.5, s);
    h = h * (0.75 + 0.25 * k) + Math.min(swash, P.bermHeight + 0.05) * (0.25 - 0.25 * k);
  }
  // a little texture in the dry sand
  const ripple = (hash2(Math.floor(x * 3), Math.floor(y * 3), seed + 7) - 0.5) * 0.004;
  return h + ripple * smoothstep(0, 3, s);
}

/** Fill a rest-height grid. */
export function buildRestProfile(g: GridSpec, seed = 1): Float32Array {
  const out = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      out[j * g.nx + i] = restHeight((i + 0.5) * g.dx, (j + 0.5) * g.dx, seed);
    }
  }
  return out;
}
