// Pictures of saved beaches, drawn on the server: the link-preview card
// (og:image, 1200×630) and the thumbnails on beechshore.com.
//
// A top-down map of the sand with the sea at the top, the way you see it
// standing on the beach looking out (so a beach's left neighbor is on the
// picture's left). Height comes from the untouched beach (a copy of
// src/sim/profile.ts) plus the saved sand; anything below sea level is
// water. Things on the beach are drawn as small flat shapes with a shadow.
// No fonts and no canvas: plain pixels, encoded as PNG with node:zlib.
//
// The profile constants, the day palette and the real beaches' tints are
// copies of the app's (src/config.ts, src/palette.ts,
// src/world/locations.ts). tests/beachImage.test.ts keeps them in step.

import { colorOf, SECTION, sectionGeometry } from './generated/sections.js';
import { deflateSync, inflateSync } from 'node:zlib';

// ---------------------------------------------------------------- the beach shape (copy of the app's)

export const WORLD = 32; // m, square
const EXTRA_SEA = 8;
export const PROFILE = {
  shoreline: 8.5 + EXTRA_SEA,
  offshoreDepth: 2.36,
  swashSlope: 1 / 12,
  bermHeight: 0.62,
  backHeight: 0.85,
  cuspAmp: 0.45,
  cuspLength: 7.5,
};

export function hash2(x: number, y: number, seed = 1): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function noise1(x: number, seed = 1): number {
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

const REST_C = 2;
const REST_C_POW = Math.pow(REST_C, 2 / 3);
const REST_A = PROFILE.offshoreDepth / (Math.pow(PROFILE.shoreline + REST_C, 2 / 3) - REST_C_POW);

function wobbleAt(x: number, seed = 1): number {
  const P = PROFILE;
  return P.cuspAmp * Math.sin((2 * Math.PI * x) / P.cuspLength + 0.7) * 0.6 + (noise1(x / 9, seed) - 0.5) * P.cuspAmp * 1.6;
}

function restHeightW(x: number, y: number, wobble: number, seed = 1): number {
  const P = PROFILE;
  const s = y - (P.shoreline + wobble);
  let h: number;
  if (s < 0) {
    h = -REST_A * (Math.pow(-s + REST_C, 2 / 3) - REST_C_POW);
  } else {
    const swash = s * P.swashSlope;
    const bermStart = P.bermHeight / P.swashSlope;
    if (s < bermStart) {
      h = swash;
    } else {
      const t = s - bermStart;
      const crest = P.bermHeight + 0.08 * Math.sin(Math.min(1, t / 2.5) * Math.PI * 0.5);
      h = crest + (P.backHeight - P.bermHeight) * smoothstep(2.5, 14, t);
    }
    const k = smoothstep(bermStart - 1.5, bermStart + 1.5, s);
    h = h * (0.75 + 0.25 * k) + Math.min(swash, P.bermHeight + 0.05) * (0.25 - 0.25 * k);
  }
  const ripple = (hash2(Math.floor(x * 3), Math.floor(y * 3), seed + 7) - 0.5) * 0.004;
  return h + ripple * smoothstep(0, 3, s);
}

/** Height (m, sea level 0) of the untouched beach: src/sim/profile.ts restHeight. */
export function restHeight(x: number, y: number, seed = 1): number {
  return restHeightW(x, y, wobbleAt(x, seed), seed);
}

// ---------------------------------------------------------------- colours (copies of the app's)

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
/** the app's "day" palette (src/palette.ts) */
export const DAY = {
  sandDry: '#f6e3c3',
  sandWet: '#cdb08e',
  sandDeep: '#e0c49d',
  rock: '#8a97a8',
  waterShallow: '#8ff0de',
  waterDeep: '#2fa4bb',
  foam: '#ffffff',
  fog: '#f7ead9',
};

export interface Place {
  id: string;
  name: string;
  place: string;
  sand: string;
  sandMix: number;
  water: string;
  waterMix: number;
}
/** the real beaches (src/world/locations.ts): names and tints */
export const PLACES: Place[] = [
  { id: 'bondi', name: 'Bondi Beach', place: 'Sydney', sand: '#f2d9a8', sandMix: 0.5, water: '#2aa7c0', waterMix: 0.3 },
  { id: 'waikiki', name: 'Waikīkī', place: 'Honolulu', sand: '#f6e6c6', sandMix: 0.5, water: '#22c4c9', waterMix: 0.45 },
  { id: 'santamonica', name: 'Santa Monica', place: 'Los Angeles', sand: '#e8d2a6', sandMix: 0.45, water: '#3b8fa6', waterMix: 0.35 },
  { id: 'southbeach', name: 'South Beach', place: 'Miami', sand: '#f7ecd6', sandMix: 0.55, water: '#36d0c4', waterMix: 0.45 },
  { id: 'copacabana', name: 'Copacabana', place: 'Rio de Janeiro', sand: '#f4e4c4', sandMix: 0.5, water: '#2f9fb0', waterMix: 0.35 },
  { id: 'brighton', name: 'Brighton Beach', place: 'England', sand: '#b9a890', sandMix: 0.6, water: '#5f8f8e', waterMix: 0.5 },
  { id: 'biarritz', name: 'Grande Plage', place: 'Biarritz', sand: '#e9cfa0', sandMix: 0.45, water: '#2f7f9c', waterMix: 0.35 },
  { id: 'campsbay', name: 'Camps Bay', place: 'Cape Town', sand: '#f8f1e2', sandMix: 0.6, water: '#2b8f9e', waterMix: 0.4 },
  { id: 'patong', name: 'Patong Beach', place: 'Phuket', sand: '#f1dfbd', sandMix: 0.45, water: '#2fb3b0', waterMix: 0.4 },
  { id: 'kuta', name: 'Kuta Beach', place: 'Bali', sand: '#e2c896', sandMix: 0.45, water: '#2a9fb6', waterMix: 0.35 },
  { id: 'nice', name: 'Promenade des Anglais', place: 'Nice', sand: '#c9bfae', sandMix: 0.6, water: '#1f8fc0', waterMix: 0.5 },
  { id: 'kamakura', name: 'Yuigahama', place: 'Kamakura', sand: '#9c8a78', sandMix: 0.55, water: '#3b8597', waterMix: 0.35 },
  { id: 'piha', name: 'Piha', place: 'Auckland', sand: '#4f4a49', sandMix: 0.7, water: '#2f7d88', waterMix: 0.35 },
  { id: 'whitehaven', name: 'Whitehaven Beach', place: 'Whitsundays', sand: '#fbfaf5', sandMix: 0.7, water: '#2fc6d0', waterMix: 0.5 },
  { id: 'surfers', name: 'Surfers Paradise', place: 'Gold Coast', sand: '#f3dfb6', sandMix: 0.5, water: '#2a9fbe', waterMix: 0.35 },
  { id: 'cable', name: 'Cable Beach', place: 'Broome', sand: '#f3dcb3', sandMix: 0.5, water: '#3bb3b3', waterMix: 0.45 },
  { id: 'railay', name: 'Railay West', place: 'Krabi', sand: '#f3e6c8', sandMix: 0.5, water: '#33b8b0', waterMix: 0.45 },
  { id: 'haeundae', name: 'Haeundae', place: 'Busan', sand: '#d9c7a4', sandMix: 0.5, water: '#3a8fa6', waterMix: 0.35 },
  { id: 'anse', name: "Anse Source d'Argent", place: 'La Digue', sand: '#f7efe0', sandMix: 0.6, water: '#3dd0c8', waterMix: 0.5 },
  { id: 'nungwi', name: 'Nungwi', place: 'Zanzibar', sand: '#faf3e3', sandMix: 0.6, water: '#36c9c4', waterMix: 0.5 },
  { id: 'sylt', name: 'Westerland', place: 'Sylt', sand: '#e8dcc0', sandMix: 0.55, water: '#5f8a8c', waterMix: 0.5 },
  { id: 'scheveningen', name: 'Scheveningen', place: 'The Hague', sand: '#e3d4b4', sandMix: 0.5, water: '#5e8584', waterMix: 0.5 },
  { id: 'fistral', name: 'Fistral Beach', place: 'Newquay', sand: '#e6d3a9', sandMix: 0.5, water: '#3d8696', waterMix: 0.4 },
  { id: 'nazare', name: 'Praia da Nazaré', place: 'Portugal', sand: '#e9d6ae', sandMix: 0.5, water: '#2f7f96', waterMix: 0.35 },
  { id: 'marinha', name: 'Praia da Marinha', place: 'Algarve', sand: '#e7c58f', sandMix: 0.55, water: '#2aa6b8', waterMix: 0.45 },
  { id: 'barceloneta', name: 'Barceloneta', place: 'Barcelona', sand: '#dcc59a', sandMix: 0.5, water: '#2f95b8', waterMix: 0.4 },
  { id: 'zlatnirat', name: 'Zlatni Rat', place: 'Brač', sand: '#ddd6c8', sandMix: 0.6, water: '#1d9fc8', waterMix: 0.55 },
  { id: 'tofino', name: 'Long Beach', place: 'Tofino', sand: '#cbbb9c', sandMix: 0.5, water: '#3f7a84', waterMix: 0.4 },
  { id: 'cannon', name: 'Cannon Beach', place: 'Oregon', sand: '#c9b89a', sandMix: 0.5, water: '#4a7f8a', waterMix: 0.4 },
  { id: 'huntington', name: 'Huntington Beach', place: 'California', sand: '#e4cfa3', sandMix: 0.45, water: '#3a8ea4', waterMix: 0.35 },
  { id: 'capecod', name: 'Coast Guard Beach', place: 'Cape Cod', sand: '#e2d1ad', sandMix: 0.5, water: '#3e7f8e', waterMix: 0.4 },
  { id: 'cancun', name: 'Playa Delfines', place: 'Cancún', sand: '#faf5e8', sandMix: 0.6, water: '#33d0c8', waterMix: 0.55 },
  { id: 'zicatela', name: 'Zicatela', place: 'Puerto Escondido', sand: '#e0c595', sandMix: 0.5, water: '#2b8fab', waterMix: 0.35 },
  { id: 'vinadelmar', name: 'Viña del Mar', place: 'Chile', sand: '#c9b693', sandMix: 0.5, water: '#3a7f90', waterMix: 0.35 },
];
export const placeById = (id: string | null | undefined): Place | undefined => PLACES.find((p) => p.id === id);

const lerp3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const darken = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const lighten = (a: RGB, k: number): RGB => [a[0] + (1 - a[0]) * k, a[1] + (1 - a[1]) * k, a[2] + (1 - a[2]) * k];

interface Look {
  sandDry: RGB;
  sandWet: RGB;
  sandDeep: RGB;
  waterShallow: RGB;
  waterDeep: RGB;
  foam: RGB;
  fog: RGB;
  rock: RGB;
}
/** the day palette tinted for a real beach, as src/world/live.ts does it */
export function lookFor(location: string | null | undefined): Look {
  const p = placeById(location);
  const base: Look = {
    sandDry: hex(DAY.sandDry),
    sandWet: hex(DAY.sandWet),
    sandDeep: hex(DAY.sandDeep),
    waterShallow: hex(DAY.waterShallow),
    waterDeep: hex(DAY.waterDeep),
    foam: hex(DAY.foam),
    fog: hex(DAY.fog),
    rock: hex(DAY.rock),
  };
  if (!p) return base;
  const sand = hex(p.sand);
  const water = hex(p.water);
  return {
    ...base,
    sandDry: lerp3(base.sandDry, sand, p.sandMix),
    sandWet: lerp3(base.sandWet, darken(sand, 0.78), p.sandMix),
    sandDeep: lerp3(base.sandDeep, darken(sand, 0.9), p.sandMix),
    waterShallow: lerp3(base.waterShallow, lighten(water, 0.4), p.waterMix),
    waterDeep: lerp3(base.waterDeep, water, p.waterMix),
  };
}

// ---------------------------------------------------------------- reading a saved beach

export interface Thing {
  kind: string;
  item: string;
  x: number;
  y: number;
  angle: number;
  size: number;
  variant: number;
  base?: number;
}
export interface SavedSand {
  nx: number;
  ny: number;
  /** sand minus the untouched beach, metres, row j (offshore first) by column i */
  delta: Float32Array;
  things: Thing[];
  /** sand piled on top of rocks (m), when any rock is buried (BCH3) */
  cover?: Float32Array;
}

const MAX_BYTES = 768 * 1024;
const MAX_CELLS = 400 * 800;
const MAX_THINGS = 2000;

/** BCH1 / BCH2 / BCH3 (src/sim/sandCodec.ts) → heights and things. Throws on anything malformed. */
export function decodeSavedBeach(bytes: Uint8Array): SavedSand {
  if (bytes.byteLength > MAX_BYTES || bytes.byteLength < 8) throw new Error('not a saved beach');
  const magic = Buffer.from(bytes.subarray(0, 4)).toString('latin1');
  if (magic !== 'BCH1' && magic !== 'BCH2' && magic !== 'BCH3') throw new Error('not a saved beach');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nx = dv.getUint16(4, true);
  const ny = dv.getUint16(6, true);
  if (nx < 8 || ny < 8 || nx * ny > MAX_CELLS) throw new Error('bad grid size');
  let sand = bytes.subarray(8);
  let objs: Uint8Array | null = null;
  let coverBytes: Uint8Array | null = null;
  if (magic === 'BCH2') {
    if (bytes.byteLength < 12) throw new Error('not a saved beach');
    const len = dv.getUint32(8, true);
    if (12 + len > bytes.byteLength) throw new Error('corrupt saved beach');
    sand = bytes.subarray(12, 12 + len);
    objs = bytes.subarray(12 + len);
  } else if (magic === 'BCH3') {
    if (bytes.byteLength < 16) throw new Error('not a saved beach');
    const sandLen = dv.getUint32(8, true);
    const objsLen = dv.getUint32(12, true);
    if (16 + sandLen + objsLen > bytes.byteLength) throw new Error('corrupt saved beach');
    sand = bytes.subarray(16, 16 + sandLen);
    objs = bytes.subarray(16 + sandLen, 16 + sandLen + objsLen);
    coverBytes = bytes.subarray(16 + sandLen + objsLen);
  }
  const raw = inflateSync(sand, { maxOutputLength: nx * ny * 2 + 16 });
  if (raw.byteLength !== nx * ny * 2) throw new Error('corrupt saved beach');
  const delta = new Float32Array(nx * ny);
  const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let k = 0; k < delta.length; k++) delta[k] = rv.getInt16(k * 2, true) / 1000;
  let cover: Float32Array | undefined;
  if (coverBytes) {
    const rawCov = inflateSync(coverBytes, { maxOutputLength: nx * ny * 2 + 16 });
    if (rawCov.byteLength !== nx * ny * 2) throw new Error('corrupt saved beach');
    const cov = new Float32Array(nx * ny);
    const cv = new DataView(rawCov.buffer, rawCov.byteOffset, rawCov.byteLength);
    let any = false;
    for (let k = 0; k < cov.length; k++) {
      const v = cv.getInt16(k * 2, true);
      if (v > 0) {
        cov[k] = v / 1000;
        any = true;
      }
    }
    if (any) cover = cov;
  }
  const things: Thing[] = [];
  if (objs && objs.byteLength) {
    let list: unknown = [];
    try {
      list = JSON.parse(inflateSync(objs, { maxOutputLength: 512 * 1024 }).toString('utf8'));
    } catch {
      list = [];
    }
    const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
    for (const o of Array.isArray(list) ? list.slice(0, MAX_THINGS) : []) {
      if (!o || typeof o !== 'object') continue;
      const p = o as Record<string, unknown>;
      if (typeof p.kind !== 'string' || typeof p.item !== 'string') continue;
      if (!num(p.x, 0, 64) || !num(p.y, 0, 96)) continue;
      things.push({
        kind: p.kind,
        item: p.item,
        x: p.x as number,
        y: p.y as number,
        angle: num(p.angle, -1e4, 1e4) ? (p.angle as number) : 0,
        size: num(p.size, 0.05, 4) ? (p.size as number) : 0.3,
        variant: num(p.variant, 0, 1e6) ? (p.variant as number) : 0,
        ...(p.kind === 'rock' && num(p.base, -10, 10) ? { base: p.base as number } : {}),
      });
    }
  }
  // the pictures show the beach itself: sand rows inland (a deeper grid) are left out
  if (ny > nx) {
    const sq = (f: Float32Array) => f.slice(0, nx * nx);
    const keep = things.filter((t) => t.y <= WORLD);
    return { nx, ny: nx, delta: sq(delta), things: keep, ...(cover ? { cover: sq(cover) } : {}) };
  }
  return { nx, ny, delta, things, ...(cover ? { cover } : {}) };
}

// ---------------------------------------------------------------- drawing

export interface ImageOptions {
  width: number;
  height: number;
  location?: string | null;
  /** the beach shows a pier (docs/PIERS.md) */
  pier?: boolean;
  /**
   * its inland rows, front row first (docs/INLAND_SECTIONS.md): drawn under
   * the beach at the same scale, so the picture is taller than `height` by
   * rowsHeight(height, rows.length)
   */
  sections?: string[];
}

/** How many pixels `rows` inland rows add under a top-down picture `height` tall (same metres per pixel as the beach). */
export function rowsHeight(height: number, rows: number): number {
  return rows > 0 ? Math.round((rows * SECTION.depth * height) / (VIEW_Y1 - VIEW_Y0)) : 0;
}

/** A top-down picture's full height: the beach, then its rows. */
export const pictureHeight = (opts: ImageOptions): number => opts.height + rowsHeight(opts.height, opts.sections?.length ?? 0);

/**
 * The inland rows from above, into rows `top`.. of `out` (W wide): each
 * row's boxes (the app's own shapes, server/src/generated/sections.ts) as
 * their footprints, lowest first so what stands taller covers what's under
 * it, lighter the higher they reach. The ends are finished (joins with
 * neighbors show in the game).
 */
function drawRowsTop(out: Uint8Array, W: number, top: number, bottom: number, scaleX: number, scaleY: number, cx: number, rows: string[]): void {
  const boxes: { x0: number; x1: number; y0: number; y1: number; h: number; c: [number, number, number] }[] = [];
  rows.forEach((type, i) => {
    for (const [key, g] of sectionGeometry(type, false, false, 1) as Map<string, { P: number[] }>) {
      const c = colorOf(key) as [number, number, number];
      for (let b = 0; b + 24 <= g.P.length; b += 24) {
        let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity, yMax = -Infinity;
        for (let v = b; v < b + 24; v += 3) {
          xMin = Math.min(xMin, g.P[v]); xMax = Math.max(xMax, g.P[v]);
          yMax = Math.max(yMax, g.P[v + 1]);
          zMin = Math.min(zMin, g.P[v + 2]); zMax = Math.max(zMax, g.P[v + 2]);
        }
        // facing the sea, +x is on the left (as the beach is drawn)
        boxes.push({
          x0: cx - xMax * scaleX, x1: cx - xMin * scaleX,
          y0: top + (i * SECTION.depth + zMin) * scaleY, y1: top + (i * SECTION.depth + zMax) * scaleY,
          h: yMax, c,
        });
      }
    }
  });
  boxes.sort((a, b) => a.h - b.h);
  for (const bx of boxes) {
    const lift = Math.max(0, Math.min(1, (bx.h - SECTION.ground) / 4));
    const shade = 0.88 + 0.24 * lift;
    const r = to8(bx.c[0] * shade), g = to8(bx.c[1] * shade), b = to8(bx.c[2] * shade);
    const xa = Math.max(0, Math.floor(bx.x0)), xb = Math.min(W, Math.ceil(bx.x1));
    const ya = Math.max(top, Math.floor(bx.y0)), yb = Math.min(bottom, Math.ceil(bx.y1));
    for (let y = ya; y < yb; y++) {
      let k = (y * W + xa) * 3;
      for (let x = xa; x < xb; x++) {
        out[k++] = r;
        out[k++] = g;
        out[k++] = b;
      }
    }
  }
  // a thin shadow line where the sand meets the first row
  for (let x = 0; x < W; x++) {
    const k = (top * W + x) * 3;
    out[k] = Math.round(out[k] * 0.8); out[k + 1] = Math.round(out[k + 1] * 0.8); out[k + 2] = Math.round(out[k + 2] * 0.8);
  }
}

/** A saved beach's sand deltas with buried-rock cover lifted over the rocks (BCH3), as the pictures use them. Returns a copy; the input is untouched. */
export function effectiveDelta(sand: SavedSand): Float32Array {
  const nx = sand.nx;
  const ny = sand.ny;
  const dx = WORLD / nx;
  const dy = WORLD / ny;
  const effDelta = sand.delta.slice();
  if (!sand.cover) return effDelta;
  const cover = sand.cover;
  const terrain = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      terrain[k] = restHeight((i + 0.5) * dx, (j + 0.5) * dy) + effDelta[k] - cover[k];
    }
  }
  const topMax = new Float32Array(nx * ny).fill(-Infinity);
  for (const t of sand.things) {
    if (t.kind !== 'rock') continue;
    const rx = t.size * 0.88;
    const frac = t.variant * 0.618 - Math.floor(t.variant * 0.618);
    const ry = t.size * (0.7 + 0.3 * frac) * 0.88;
    const Hr = t.size * 0.8 * 0.75;
    const c = Math.cos(t.angle);
    const s = Math.sin(t.angle);
    const ci = Math.min(nx - 1, Math.max(0, Math.floor(t.x / dx)));
    const cj = Math.min(ny - 1, Math.max(0, Math.floor(t.y / dy)));
    const base = t.base ?? terrain[cj * nx + ci];
    const r = Math.ceil(rx / Math.min(dx, dy)) + 1;
    for (let j = Math.max(0, cj - r); j <= Math.min(ny - 1, cj + r); j++) {
      for (let i = Math.max(0, ci - r); i <= Math.min(nx - 1, ci + r); i++) {
        const px = (i + 0.5) * dx - t.x;
        const py = (j + 0.5) * dy - t.y;
        const u = (px * c + py * s) / rx;
        const v = (-px * s + py * c) / ry;
        const q = u * u + v * v;
        if (q >= 1) continue;
        const top = base + Hr * Math.sqrt(1 - q);
        const k = j * nx + i;
        if (top > topMax[k]) topMax[k] = top;
      }
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (cover[k] > 0 && topMax[k] > -Infinity) {
        const lifted = topMax[k] + cover[k] - restHeight((i + 0.5) * dx, (j + 0.5) * dy);
        if (lifted > effDelta[k]) effDelta[k] = lifted;
      }
    }
  }
  return effDelta;
}

/** cross-shore window drawn: from a little out to sea to the back of the beach */
const VIEW_Y0 = 11.5;
const VIEW_Y1 = WORLD;

/**
 * Draw a saved beach (or the untouched beach, `sand` null) as RGB pixels.
 * The picture always shows the whole depth of the beach, edge to edge:
 * the card is exactly the beach, sea at the top and sand to the sides.
 * Alongshore the card spans the beach's 32 m exactly (no continuation
 * shore flanking it); cross-shore it spans VIEW_Y0..VIEW_Y1, so the two
 * scales differ a little (the card is wider than the beach is deep).
 */
export function renderBeach(sand: SavedSand | null, opts: ImageOptions): Uint8Array {
  const { width: W, height: H } = opts;
  const look = lookFor(opts.location);
  const nx = sand?.nx ?? 256;
  const ny = sand?.ny ?? 256;
  const dx = WORLD / nx;
  const dy = WORLD / ny;
  // heights on the grid, with a one-cell margin of untouched beach so
  // sampling past the edge carries on into the shore
  const gx = nx + 2;
  const gy = ny + 2;
  const hgt = new Float32Array(gx * gy);
  const dug = new Float32Array(gx * gy);
  const effDelta = sand ? effectiveDelta(sand) : null;
  const gridWob = new Float64Array(gx);
  for (let i = -1; i <= nx; i++) gridWob[i + 1] = wobbleAt((i + 0.5) * dx);
  for (let j = -1; j <= ny; j++) {
    const y = (j + 0.5) * dy;
    const row = (j + 1) * gx;
    const insideY = j >= 0 && j < ny;
    const dRow = j * nx;
    for (let i = -1; i <= nx; i++) {
      const x = (i + 0.5) * dx;
      const d = insideY && i >= 0 && i < nx && effDelta ? effDelta[dRow + i] : 0;
      const k = row + (i + 1);
      hgt[k] = restHeightW(x, y, gridWob[i + 1]) + d;
      dug[k] = d;
    }
  }
  const invDx = 1 / dx;
  const invDy = 1 / dy;
  const maxGx = gx - 1.001;
  const maxGy = gy - 1.001;
  const sample = (f: Float32Array, x: number, y: number) => {
    let fx = x * invDx + 0.5;
    if (fx < 0) fx = 0;
    else if (fx > maxGx) fx = maxGx;
    let fy = y * invDy + 0.5;
    if (fy < 0) fy = 0;
    else if (fy > maxGy) fy = maxGy;
    const i = fx | 0;
    const j = fy | 0;
    const tx = fx - i;
    const ty = fy - j;
    const k = j * gx + i;
    const a = f[k];
    const c = f[k + gx];
    return (a + (f[k + 1] - a) * tx) * (1 - ty) + (c + (f[k + gx + 1] - c) * tx) * ty;
  };
  const scaleX = W / WORLD; // px per metre, alongshore: exactly the beach
  const scaleY = H / (VIEW_Y1 - VIEW_Y0); // px per metre, cross-shore
  const cx = W / 2;
  const invScaleX = 1 / scaleX;
  const invScaleY = 1 / scaleY;
  const out = new Uint8Array(W * pictureHeight(opts) * 3);
  // light from the top left of the picture (offshore, +x)
  const L = norm3([-0.55, -0.55, 0.63]);
  const L0 = L[0];
  const L1 = L[1];
  const L2 = L[2];
  const shadeScale = 0.3 / (1 - L2 + 1e-6);
  const e = 0.6 * Math.min(dx, dy);
  const inv2e = 1 / (2 * e);

  // Unpack palette colours once to avoid per-pixel array allocations
  const ws0 = look.waterShallow[0], ws1 = look.waterShallow[1], ws2 = look.waterShallow[2];
  const wd0 = look.waterDeep[0], wd1 = look.waterDeep[1], wd2 = look.waterDeep[2];
  const sw0 = look.sandWet[0], sw1 = look.sandWet[1], sw2 = look.sandWet[2];
  const sd0 = look.sandDry[0], sd1 = look.sandDry[1], sd2 = look.sandDry[2];
  const sp0 = look.sandDeep[0], sp1 = look.sandDeep[1], sp2 = look.sandDeep[2];
  const sl = lighten(look.sandDry, 0.15);
  const sl0 = sl[0], sl1 = sl[1], sl2 = sl[2];
  const fm0 = look.foam[0], fm1 = look.foam[1], fm2 = look.foam[2];

  // Precompute per-column values and bilinear x indices (independent of py)
  const colWave = new Float64Array(W);
  const colI = new Int32Array(W);
  const colTx = new Float64Array(W);
  const colIp = new Int32Array(W);
  const colTxp = new Float64Array(W);
  const colIm = new Int32Array(W);
  const colTxm = new Float64Array(W);
  for (let px = 0; px < W; px++) {
    // facing the sea, left is +x: the picture is mirrored alongshore, and
    // the card is exactly the beach edge to edge (no continuation shore)
    const x = WORLD / 2 - (px + 0.5 - cx) * invScaleX;
    colWave[px] = Math.sin(x * 0.35) * 0.9 + noise1(x * 0.6, 3) * 2;
    let fx = x * invDx + 0.5;
    if (fx < 0) fx = 0; else if (fx > maxGx) fx = maxGx;
    colI[px] = fx | 0;
    colTx[px] = fx - (fx | 0);
    let fxp = (x + e) * invDx + 0.5;
    if (fxp < 0) fxp = 0; else if (fxp > maxGx) fxp = maxGx;
    colIp[px] = fxp | 0;
    colTxp[px] = fxp - (fxp | 0);
    let fxm = (x - e) * invDx + 0.5;
    if (fxm < 0) fxm = 0; else if (fxm > maxGx) fxm = maxGx;
    colIm[px] = fxm | 0;
    colTxm[px] = fxm - (fxm | 0);
  }

  let kOut = 0;
  for (let py = 0; py < H; py++) {
    const y = VIEW_Y0 + (py + 0.5) * invScaleY;
    const waveY = (y - PROFILE.shoreline) * 2.2;
    let fy = y * invDy + 0.5;
    if (fy < 0) fy = 0; else if (fy > maxGy) fy = maxGy;
    const j0 = fy | 0;
    const ty0 = fy - j0;
    const ity0 = 1 - ty0;
    const r0 = j0 * gx;

    let fyp = (y + e) * invDy + 0.5;
    if (fyp < 0) fyp = 0; else if (fyp > maxGy) fyp = maxGy;
    const jp = fyp | 0;
    const typ = fyp - jp;
    const ityp = 1 - typ;
    const rp = jp * gx;

    let fym = (y - e) * invDy + 0.5;
    if (fym < 0) fym = 0; else if (fym > maxGy) fym = maxGy;
    const jm = fym | 0;
    const tym = fym - jm;
    const itym = 1 - tym;
    const rm = jm * gx;

    for (let px = 0; px < W; px++) {
      let h: number;
      {
        const k = r0 + colI[px];
        const tx = colTx[px];
        const a = hgt[k];
        const c = hgt[k + gx];
        h = (a + (hgt[k + 1] - a) * tx) * ity0 + (c + (hgt[k + gx + 1] - c) * tx) * ty0;
      }
      let r: number;
      let g: number;
      let b: number;
      if (h < 0) {
        const depth = -h;
        const t1 = smoothstep(0.02, 1.1, depth);
        r = ws0 + (wd0 - ws0) * t1;
        g = ws1 + (wd1 - ws1) * t1;
        b = ws2 + (wd2 - ws2) * t1;
        // the sand shows through the shallows
        const t2 = smoothstep(0, 0.12, depth) * 0.75 + 0.25;
        r = sw0 + (r - sw0) * t2;
        g = sw1 + (g - sw1) * t2;
        b = sw2 + (b - sw2) * t2;
        // long, gentle swell lines
        if (depth > 0.15) {
          const wave = Math.sin(waveY + colWave[px]);
          if (wave > 0.82) {
            const t3 = (wave - 0.82) * 0.9 * smoothstep(0.15, 0.6, depth);
            r += (fm0 - r) * t3;
            g += (fm1 - g) * t3;
            b += (fm2 - b) * t3;
          }
        }
        // lace at the waterline
        if (depth < 0.035) {
          const t4 = (1 - smoothstep(0, 0.035, depth)) * 0.75;
          r += (fm0 - r) * t4;
          g += (fm1 - g) * t4;
          b += (fm2 - b) * t4;
        }
      } else {
        let hx: number;
        let hy: number;
        {
          const kp = r0 + colIp[px];
          const txp = colTxp[px];
          const hp = (hgt[kp] + (hgt[kp + 1] - hgt[kp]) * txp) * ity0 + (hgt[kp + gx] + (hgt[kp + gx + 1] - hgt[kp + gx]) * txp) * ty0;
          const km = r0 + colIm[px];
          const txm = colTxm[px];
          const hm = (hgt[km] + (hgt[km + 1] - hgt[km]) * txm) * ity0 + (hgt[km + gx] + (hgt[km + gx + 1] - hgt[km + gx]) * txm) * ty0;
          hx = (hp - hm) * inv2e;

          const i0 = colI[px];
          const tx = colTx[px];
          const kyp = rp + i0;
          const hyp = (hgt[kyp] + (hgt[kyp + 1] - hgt[kyp]) * tx) * ityp + (hgt[kyp + gx] + (hgt[kyp + gx + 1] - hgt[kyp + gx]) * tx) * typ;
          const kym = rm + i0;
          const hym = (hgt[kym] + (hgt[kym + 1] - hgt[kym]) * tx) * itym + (hgt[kym + gx] + (hgt[kym + gx + 1] - hgt[kym + gx]) * tx) * tym;
          hy = (hyp - hym) * inv2e;
        }
        // picture axes: px grows toward -x, py toward +y; exaggerate relief
        const nx1 = hx * 1.6;
        const ny1 = -hy * 1.6;
        const invLen = 1 / Math.sqrt(nx1 * nx1 + ny1 * ny1 + 1);
        const dot = (nx1 * L0 + ny1 * L1 + L2) * invLen;
        const lambert = dot > 0 ? dot : 0;
        const ts = smoothstep(0.04, 0.32, h);
        r = sw0 + (sd0 - sw0) * ts;
        g = sw1 + (sd1 - sw1) * ts;
        b = sw2 + (sd2 - sw2) * ts;
        {
          const k = r0 + colI[px];
          const tx = colTx[px];
          const d = (dug[k] + (dug[k + 1] - dug[k]) * tx) * ity0 + (dug[k + gx] + (dug[k + gx + 1] - dug[k + gx]) * tx) * ty0;
          if (d < -0.04) {
            const td = smoothstep(0.04, 0.3, -d) * 0.6;
            r += (sp0 - r) * td;
            g += (sp1 - g) * td;
            b += (sp2 - b) * td;
          } else if (d > 0.06) {
            const tl = smoothstep(0.06, 0.4, d) * 0.4;
            r += (sl0 - r) * tl;
            g += (sl1 - g) * tl;
            b += (sl2 - b) * tl;
          }
        }
        let shade = 1 + (lambert - L2) * shadeScale;
        if (shade < 0.62) shade = 0.62;
        r *= shade;
        g *= shade;
        b *= shade;
      }
      out[kOut++] = r <= 0 ? 0 : r >= 1 ? 255 : Math.round(r * 255);
      out[kOut++] = g <= 0 ? 0 : g >= 1 ? 255 : Math.round(g * 255);
      out[kOut++] = b <= 0 ? 0 : b >= 1 ? 255 : Math.round(b * 255);
    }
  }
  if (sand) {
    const visible = sand.cover
      ? sand.things.filter((t) => !(t.kind === 'rock' && t.base !== undefined && sample(hgt, t.x, t.y) > t.base + t.size * 0.8))
      : sand.things;
    drawThings(out, W, H, visible, look, (x, y) => [cx - (x - WORLD / 2) * scaleX, (y - VIEW_Y0) * scaleY], scaleY);
  }
  if (opts.pier) drawPierTop(out, W, H, (x, y) => [cx - (x - WORLD / 2) * scaleX, (y - VIEW_Y0) * scaleY], scaleY);
  if (opts.sections?.length) drawRowsTop(out, W, H, pictureHeight(opts), scaleX, scaleY, cx, opts.sections);
  return out;
}

const to8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
function norm3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// ---------------------------------------------------------------- things on the beach

type Pt = [number, number];

function blend(img: Uint8Array, W: number, H: number, px: number, py: number, c: RGB, a: number) {
  if (px < 0 || py < 0 || px >= W || py >= H || a <= 0) return;
  const k = (py * W + px) * 3;
  img[k] = Math.round(img[k] + (to8(c[0]) - img[k]) * a);
  img[k + 1] = Math.round(img[k + 1] + (to8(c[1]) - img[k + 1]) * a);
  img[k + 2] = Math.round(img[k + 2] + (to8(c[2]) - img[k + 2]) * a);
}

/** Fill a polygon (even-odd), with 4× vertical supersampling for soft edges. */
function fillPoly(img: Uint8Array, W: number, H: number, pts: Pt[], c: RGB, alpha = 1) {
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const [x, y] of pts) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  const x0 = Math.max(0, Math.floor(minX));
  const x1 = Math.min(W - 1, Math.ceil(maxX));
  if (y0 > y1 || x0 > x1) return;
  const cover = new Float32Array(x1 - x0 + 2);
  const SUB = 4;
  for (let py = y0; py <= y1; py++) {
    cover.fill(0);
    for (let s = 0; s < SUB; s++) {
      const sy = py + (s + 0.5) / SUB;
      const xs: number[] = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[j];
        if (ay > sy !== by > sy) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(x0, xs[k]);
        const b = Math.min(x1 + 1, xs[k + 1]);
        for (let px = Math.floor(a); px < b; px++) {
          const l = Math.max(a, px);
          const r = Math.min(b, px + 1);
          if (r > l) cover[px - x0] += (r - l) / SUB;
        }
      }
    }
    for (let px = x0; px <= x1; px++) blend(img, W, H, px, py, c, Math.min(1, cover[px - x0]) * alpha);
  }
}

const circle = (cx: number, cy: number, r: number, n = 20): Pt[] =>
  Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r] as Pt);
const rect = (cx: number, cy: number, hw: number, hh: number, a: number): Pt[] => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as Pt[]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
};
const star = (cx: number, cy: number, r: number, a: number): Pt[] =>
  Array.from({ length: 10 }, (_, i) => {
    const rr = i % 2 ? r * 0.42 : r;
    const t = a + (i / 10) * Math.PI * 2;
    return [cx + Math.cos(t) * rr, cy + Math.sin(t) * rr] as Pt;
  });
const ellipse = (cx: number, cy: number, rx: number, ry: number, a: number): Pt[] =>
  Array.from({ length: 12 }, (_, i) => {
    const t = (i / 12) * Math.PI * 2;
    const ex = Math.cos(t) * rx;
    const ey = Math.sin(t) * ry;
    return [cx + ex * Math.cos(a) - ey * Math.sin(a), cy + ex * Math.sin(a) + ey * Math.cos(a)] as Pt;
  });

const C = (h: string) => hex(h);
// Free shells are warm cream, tan and peach — no pink anywhere (pink is
// reserved for the pink shell, a prize). A copy of the app's free shell
// palette (src/palette.ts); tests/specialItems.test.ts keeps them in step.
export const SHELLS = ['#f7ead8', '#efe4d2', '#e8d9c0', '#f5e1cf', '#e6cfa8', '#f2e3c2', '#dfc49a', '#efe0c0'].map(C);
const GLASS = ['#9fd8c1', '#8cc7de', '#b7e0a8', '#d3eef0'].map(C);
const FLAGS = ['#e2574c', '#f2b134', '#4a90d9', '#55b27a'].map(C);
const TRASH = ['#e63329', '#1f8fff', '#22b573', '#ffcf00'].map(C);
const WEED = ['#4a5d23', '#3d4a1f', '#5d6b2a', '#6b5e2f'].map(C);
const BALL_PANELS = ['#e8443a', '#2f8fd0', '#f5c542'].map(C);
const SANDAL_SOLES = ['#2f8f7a', '#e86a5a'].map(C);
const SANDAL_STRAPS = ['#f08a4b', '#2f4a6b'].map(C);
const BUCKET_RIMS = ['#d8473b', '#2f8fd0'].map(C);
const BUCKET_INSIDE = ['#8a2f28', '#1f5a8a'].map(C);
const CORAL = ['#c73e2e', '#a82e28', '#d95a3a'].map(C);
const NUT = ['#6b4a2f', '#7d5a38'].map(C);
// footprints pressed into the sand: darker than dry sand (a copy of
// src/palette.ts PROP_COLORS.footprints)
const PRINTS = ['#b08d68', '#a5825f', '#c09a72'].map(C);

/** Prize items draw in their own colours (a copy of src/palette.ts ITEM_LOOKS). */
export const ITEM_COLORS: Record<string, string[]> = {
  // a spotted cowrie (a copy of src/palette.ts ITEM_LOOKS)
  cowrie: ['#5d3a1a', '#8a5a2b', '#c98f4e'],
  'pink-shell': ['#f27ba7', '#ef5d8f', '#f8a8c4', '#e8437a'],
  'blue-seaglass': ['#2f7fc9', '#1f6fb8', '#4aa3e0', '#185a9e'],
  pebble: ['#5a5f6b', '#6e7683', '#3f4650', '#7d838e'],
  'spiral-conch': ['#e86a4a', '#f08a4b', '#d94f30', '#f2a65a'],
  'gold-sanddollar': ['#d4a017', '#e8b923', '#f5c542', '#b8860b'],
  'sunset-starfish': ['#ff7e3d', '#e84a7a', '#b84a8f', '#ffb347'],
  'green-bottle': ['#0f7a4d', '#15965f', '#0a5c38', '#1fae6e'],
  nautilus: ['#e8d5c4', '#d9a06b', '#c97e5a'],
};
/** A prize item's colour for this variant, or null for its kind's colour. */
const itemColor = (item: string, v: number): RGB | null => {
  const cs = ITEM_COLORS[item];
  return cs ? C(cs[v % cs.length]) : null;
};

function drawThings(img: Uint8Array, W: number, H: number, things: Thing[], look: Look, at: (x: number, y: number) => Pt, s: number) {
  // big things first, so small ones on top stay visible
  const order = [...things].sort((a, b) => footprint(b) - footprint(a));
  const sh = Math.max(1.5, s * 0.07); // shadow offset
  const shadow: RGB = [0.18, 0.14, 0.1];
  for (const t of order) {
    const [px, py] = at(t.x, t.y);
    if (px < -60 || py < -60 || px > W + 60 || py > H + 60) continue;
    const a = -t.angle; // mirrored alongshore
    const m = (r: number, min: number) => Math.max(min, r * s);
    const v = Math.abs(Math.floor(t.variant));
    const vendingVariant = Math.max(0, v - 1);
    const parts: [Pt[], RGB][] = [];
    switch (t.kind) {
      case 'rock': {
        const r = m(t.size, 2.5);
        const n = 9;
        const pts = Array.from({ length: n }, (_, i) => {
          const q = 0.78 + hash2(v, i, 5) * 0.32;
          const th = (i / n) * Math.PI * 2 + a;
          return [px + Math.cos(th) * r * q, py + Math.sin(th) * r * q * 0.9] as Pt;
        });
        const pebble = itemColor(t.item, v);
        const base = pebble ?? lerp3(look.rock, [0.55, 0.5, 0.45], hash2(v, 1, 9) * 0.5);
        parts.push([pts, base]);
        parts.push([circle(px - r * 0.25, py - r * 0.25, r * 0.4, 10), pebble ? lighten(base, 0.25) : lighten(look.rock, 0.25)]);
        break;
      }
      case 'driftwood':
        parts.push([rect(px, py, m(t.size / 2, 4), m(0.07 + t.size * 0.02, 1.3), a), C('#a08566')]);
        break;
      case 'shell':
      case 'conch': {
        const r = m(Math.max(0.1, t.size * 0.5), 3);
        parts.push([circle(px, py, r, 10), itemColor(t.item, v) ?? SHELLS[v % SHELLS.length]]);
        if (t.item === 'cowrie') {
          const spot = itemColor(t.item, v + 1)!;
          for (let k = 0; k < 5; k++) {
            const angle = a + (k / 5) * Math.PI * 2;
            parts.push([circle(px + Math.cos(angle) * r * 0.55, py + Math.sin(angle) * r * 0.55, r * 0.17, 6), spot]);
          }
        }
        break;
      }
      case 'sanddollar':
        parts.push([circle(px, py, m(Math.max(0.08, t.size * 0.5), 2), 12), itemColor(t.item, v) ?? C('#eee6d4')]);
        break;
      case 'nautilus':
        parts.push([circle(px, py, m(Math.max(0.1, t.size * 0.5), 2.2), 12), itemColor(t.item, v) ?? C('#f1e2cc')]);
        break;
      case 'seaglass':
        parts.push([circle(px, py, m(0.07, 1.6), 6), itemColor(t.item, v) ?? GLASS[v % GLASS.length]]);
        break;
      case 'trash': {
        // a crumpled bright bottle: a short body with a neck, in vivid plastic colours
        const c = TRASH[v % TRASH.length];
        parts.push([rect(px, py, m(0.13, 2.5), m(0.055, 1.2), a), c]);
        parts.push([rect(px + Math.cos(a) * m(0.15, 2.5), py - Math.sin(a) * m(0.15, 2.5), m(0.05, 1), m(0.04, 0.8), a), lighten(c, 0.3)]);
        break;
      }
      case 'seaweed': {
        // a dark green strand: three thin arms radiating from the middle
        const c = WEED[v % WEED.length];
        for (let k = 0; k < 3; k++) {
          const aa = a + (k / 3) * Math.PI * 2;
          parts.push([rect(px + Math.cos(aa) * m(0.16, 2), py - Math.sin(aa) * m(0.16, 2), m(0.18, 2.5), m(0.035, 0.8), aa), c]);
        }
        break;
      }
      case 'footprints': {
        // a trail of prints pressed into the sand, alternating left and
        // right along the trail, darker than the sand around them
        const c = PRINTS[v % PRINTS.length];
        const steps = 5 + (v % 3);
        const stride = m((t.size * 0.85) / (steps - 1), 1.5);
        const len = m(t.size * 0.17, 1.5);
        const wid = m(t.size * 0.075, 0.8);
        const lat = m(t.size * 0.055, 0.8);
        for (let k = 0; k < steps; k++) {
          const side = k % 2 === 0 ? -1 : 1;
          const along = (k - (steps - 1) / 2) * stride;
          const cx = px + Math.cos(a) * along - Math.sin(a) * side * lat;
          const cy = py + Math.sin(a) * along + Math.cos(a) * side * lat;
          parts.push([ellipse(cx, cy, len / 2, wid / 2, a + side * 0.18), c]);
        }
        break;
      }
      case 'starfish':
        parts.push([star(px, py, m(Math.max(0.12, t.size * 0.6), 3), a), itemColor(t.item, v) ?? C('#f08a4b')]);
        break;
      case 'coral': {
        // a branching fragment: a few short arms fanning out from the base, brick red
        const c = CORAL[v % CORAL.length];
        const baseR = m(t.size * 0.175, 1);
        const branch = m(t.size * 0.4, 2);
        parts.push([circle(px, py, baseR, 8), c]);
        for (let k = 0; k < 3; k++) {
          const aa = a + (k / 3) * Math.PI * 2 - Math.PI / 2;
          parts.push([rect(px + Math.cos(aa) * branch, py + Math.sin(aa) * branch, branch, m(t.size * 0.1, 0.9), aa), c]);
        }
        break;
      }
      case 'coconut': {
        // a brown nut with its three dark pores
        const r = m(t.size * 0.5, 2.2);
        parts.push([circle(px, py, r, 14), NUT[v % NUT.length]]);
        for (const [ox, oy] of [[-0.3, -0.2], [0.3, -0.25], [0, 0.3]] as Pt[])
          parts.push([circle(px + ox * r, py + oy * r, Math.max(1, r * 0.12), 6), C('#3d2716')]);
        break;
      }
      case 'bottle':
        parts.push([rect(px, py, m(0.18, 3), m(0.06, 1.3), a), itemColor(t.item, v) ?? C('#5fa67a')]);
        break;
      case 'flag':
        parts.push([circle(px, py, m(0.04, 1.2), 6), C('#6b5a48')]);
        parts.push([[[px, py], [px + m(0.5, 7), py - m(0.17, 3)], [px, py - m(0.34, 6)]], FLAGS[v % FLAGS.length]]);
        break;
      case 'deckchair':
        parts.push([rect(px, py, m(0.45, 4.5), m(0.9, 7.5), a), C('#3f7fc4')]);
        parts.push([rect(px, py, m(0.45, 4.5) * 0.45, m(0.9, 7.5), a), C('#ffffff')]);
        break;
      case 'parasol': {
        const r = m(1.5, 10.5);
        for (let i = 0; i < 8; i++) {
          const t0 = (i / 8) * Math.PI * 2 + a;
          const t1 = ((i + 1) / 8) * Math.PI * 2 + a;
          parts.push([[[px, py], [px + Math.cos(t0) * r, py + Math.sin(t0) * r], [px + Math.cos(t1) * r, py + Math.sin(t1) * r]], i % 2 ? C('#ffffff') : C('#e2574c')]);
        }
        break;
      }
      case 'surfboard':
        parts.push([rect(px, py, m(1.5, 10.5), m(0.39, 3.3), a).map((p, i) => (i % 2 ? p : p)) as Pt[], C('#f2c14e')]);
        parts.push([rect(px, py, m(1.5, 10.5), m(0.06, 1.2), a), C('#e2574c')]);
        break;
      case 'sandcastle': {
        const r = m(0.9, 7.5);
        parts.push([rect(px, py, r, r, a), lighten(look.sandDeep, 0.1)]);
        for (const [ox, oy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as Pt[])
          parts.push([circle(px + ox * r, py + oy * r, r * 0.38, 10), lighten(look.sandDry, 0.2)]);
        parts.push([circle(px, py, r * 0.45, 12), lighten(look.sandDry, 0.3)]);
        break;
      }
      case 'beachhut':
        parts.push([rect(px, py, m(1.35, 9), m(1.125, 7.5), a), C('#4a90d9')]);
        parts.push([rect(px, py, m(1.35, 9), m(0.18, 1.5), a), C('#ffffff')]);
        break;
      case 'lighthouse':
        parts.push([circle(px, py, m(0.825, 6.75), 16), C('#ffffff')]);
        parts.push([circle(px, py, m(0.57, 4.5), 16), C('#e2574c')]);
        parts.push([circle(px, py, m(0.24, 2.25), 10), C('#f7d774')]);
        break;
      case 'tikitorch':
        parts.push([circle(px, py, m(0.18, 3), 8), C('#7a5a3a')]);
        parts.push([circle(px, py, m(0.105, 1.8), 8), C('#ffb347')]);
        break;
      case 'palmtree': {
        // seen from above: a fan of green fronds around the trunk
        const r = m(1.5, 10.5);
        for (let i = 0; i < 6; i++) {
          const t0 = (i / 6) * Math.PI * 2 + a;
          const t1 = ((i + 1) / 6) * Math.PI * 2 + a;
          parts.push([[[px, py], [px + Math.cos(t0) * r, py + Math.sin(t0) * r], [px + Math.cos(t1) * r, py + Math.sin(t1) * r]], i % 2 ? C('#4a9e5c') : C('#3f8f4f')]);
        }
        parts.push([circle(px, py, m(0.15, 2.25), 8), C('#6b4a2f')]);
        break;
      }
      case 'lifeguardtower': {
        // a cabin on legs, with the ramp running down toward the sea
        parts.push([rect(px, py, m(1.35, 9), m(1.125, 7.5), a), C('#f2f0e8')]);
        const off = m(1.575, 6.75);
        parts.push([rect(px - Math.sin(a) * off, py + Math.cos(a) * off, m(0.375, 3.75), m(0.825, 6), a), C('#f2f0e8')]);
        parts.push([rect(px, py, m(0.825, 6), m(0.75, 5.25), a), C('#2f4a6b')]);
        break;
      }
      case 'bonfire': {
        // a ring of stones with a flame in the middle
        parts.push([circle(px, py, m(0.63, 5.25), 12), C('#9aa0a8')]);
        parts.push([circle(px, py, m(0.45, 3.75), 10), C('#3d2716')]);
        parts.push([circle(px, py, m(0.21, 2.7), 8), C('#ff8c2e')]);
        break;
      }
      case 'hammock': {
        // two posts and the slung cloth between them
        const off = m(1.275, 9);
        const ox = Math.cos(a) * off;
        const oy = Math.sin(a) * off;
        parts.push([circle(px - ox, py - oy, m(0.105, 1.8), 6), C('#8a6b4a')]);
        parts.push([circle(px + ox, py + oy, m(0.105, 1.8), 6), C('#8a6b4a')]);
        parts.push([rect(px, py, off, m(0.375, 4.5), a), C('#e86a5a')]);
        break;
      }
      case 'towel': {
        // a striped towel lying flat
        const halfLength = m(0.8625, 10.5);
        parts.push([rect(px, py, halfLength, m(0.465, 6), a), C('#2f8f7a')]);
        for (const side of [-1, 1]) {
          const off = side * m(0.3, 3.75);
          parts.push([rect(px - Math.sin(a) * off, py + Math.cos(a) * off, halfLength, m(0.075, 1.8), a), C('#fbf3e4')]);
        }
        break;
      }
      case 'beachball': {
        // a striped ball, seen from above: a white disc with bright wedges
        const r = m(t.size, 2.5);
        const bright = BALL_PANELS[vendingVariant % BALL_PANELS.length];
        parts.push([circle(px, py, r, 16), C('#fbf3e4')]);
        for (let i = 0; i < 6; i += 2) {
          const t0 = a + (i / 6) * Math.PI * 2;
          const t1 = a + ((i + 1) / 6) * Math.PI * 2;
          parts.push([[[px, py], [px + Math.cos(t0) * r, py + Math.sin(t0) * r], [px + Math.cos(t1) * r, py + Math.sin(t1) * r]], bright]);
        }
        break;
      }
      case 'sandals': {
        // a pair of flat soles side by side, each with a strap across it
        const c = SANDAL_SOLES[vendingVariant % SANDAL_SOLES.length];
        const st = SANDAL_STRAPS[vendingVariant % SANDAL_STRAPS.length];
        const off = m(t.size * 0.3, 1.5);
        const ox = Math.sin(a) * off;
        const oy = Math.cos(a) * off;
        for (const sgn of [1, -1]) {
          const cx = px + sgn * ox;
          const cy = py + sgn * oy;
          const halfWidth = m(t.size * 0.24, 1.2);
          const strapOffset = m(t.size * 0.12, 0.5);
          parts.push([rect(cx, cy, m(t.size * 0.5, 2.5), halfWidth, a), c]);
          parts.push([rect(cx + Math.cos(a) * strapOffset, cy + Math.sin(a) * strapOffset, m(t.size * 0.045, 0.8), halfWidth, a), st]);
        }
        break;
      }
      case 'bucket': {
        // a pail, seen from above: a coloured rim with its darker inside
        const r = m(t.size * 0.5, 2.5);
        parts.push([circle(px, py, r, 16), BUCKET_RIMS[vendingVariant % BUCKET_RIMS.length]]);
        parts.push([circle(px, py, r * 0.72, 14), BUCKET_INSIDE[vendingVariant % BUCKET_INSIDE.length]]);
        break;
      }
      default:
        parts.push([circle(px, py, m(0.12, 2), 8), C('#d9c7a8')]);
    }
    // one shadow under the whole thing, then the parts
    for (const [pts] of parts.slice(0, 1)) fillPoly(img, W, H, pts.map(([x, y]) => [x + sh, y + sh] as Pt), shadow, 0.28);
    for (const [pts, c] of parts) fillPoly(img, W, H, pts, c);
  }
}

// ---------------------------------------------------------------- the 3D view (beechshore share snapshot)
//
// An isometric diorama of a beach and the shore either side of it: the
// camera offshore, looking landward, the sea in the foreground and the beach
// rising away — the same angled look as the game. One beach either side,
// from the walk; a linked neighbour sits flush, an unlinked one keeps the
// 1.6 m diorama gap, and where there is no public neighbour the frame ends
// at the centre beach — no faded filler shore on any side. The frame shows
// the centre beach plus a sliver (4 m) of each neighbour, so the beach is
// the subject instead of a thin strip in a void — the neighbours show just
// enough to read that there are beaches next door before they crop off.
//
// Alongshore the picture is mirrored against a literal offshore camera so
// left and right match the top-down card (facing the sea, left is +x, so
// the walk-left neighbour is on the picture's left).

export interface IsoPanel {
  /** null: untouched shore in this slot */
  sand: SavedSand | null;
  location?: string | null;
  /** a real neighbour of the beach before it along the shore */
  linked: boolean;
  /** it shows a pier (docs/PIERS.md) */
  pier?: boolean;
}

/** which side the isometric camera sits on */
export type IsoDir = 'land' | 'ocean';

const ISO_TILT = (20 * Math.PI) / 180;
const ISO_A = Math.cos(ISO_TILT); // screen x per metre of (x + y)
const ISO_B = Math.sin(ISO_TILT); // screen y per metre of (x - y)
const ISO_Z = 2.0; // vertical exaggeration, × scale
const ISO_CELL = 0.5; // m between height samples (0.4 looked the same; 0.5 is ~35% fewer quads)
const ISO_GAP = 1.6; // m of untouched shore past an unlinked neighbour

interface IsoCam {
  s: number;
  A: number;
  B: number;
  C: number;
  ox: number;
  oy: number;
  /** +1: camera offshore looking landward (sea in front); -1: camera inland looking seaward */
  sgn: 1 | -1;
}
/** metres of each neighbour shown either side of the centre beach — a sliver, not a slice: the shared beach is the subject */
const ISO_SHOW = 4;
/** Fit the frame to the centre beach plus a sliver of each neighbour (fx0..fx1 are the strip's ends, 0/32 with no neighbours). The beach is the subject — the frame does not fit the whole 96 m strip, which reads as a thin diagonal in a void. A side with no neighbour ends at the centre beach, with no filler shore past it. */
const isoCam = (W: number, H: number, fx0: number, fx1: number, dir: IsoDir): IsoCam => {
  const vx0 = Math.max(fx0, -ISO_SHOW);
  const vx1 = Math.min(fx1, WORLD + ISO_SHOW);
  const span = vx1 - vx0 + WORLD;
  const mx = 20;
  const myTop = 80;
  const myBot = 16;
  const topH = 1.6; // metres of terrain + billboard allowance above sea level
  const s = Math.min((W - 2 * mx) / (span * ISO_A), (H - myTop - myBot) / (span * ISO_B + topH * ISO_Z));
  const A = ISO_A * s;
  const B = ISO_B * s;
  const C = ISO_Z * s;
  const sgn = dir === 'ocean' ? 1 : -1;
  // centre the ground diamond on the view window; the land view mirrors it alongshore, so a
  // neighbour that is on the left from the sea is on the right from the land
  const ox = (W + sgn * (vx0 + vx1 + WORLD) * A) / 2;
  const oy = myTop + topH * C + (sgn > 0 ? WORLD - vx0 : vx1) * B;
  return { s, A, B, C, ox, oy, sgn };
};
/** world (x alongshore, y offshore→land, h height) → screen, y down */
const isoPt = (cam: IsoCam, x: number, y: number, h: number): Pt => [
  cam.ox - cam.sgn * (x + y) * cam.A,
  cam.oy + cam.sgn * (x - y) * cam.B - h * cam.C,
];

/** screen position of a world point in the iso view (for tests); fx0/fx1 are the strip's ends, 0/32 with no neighbours */
export function isoScreenPoint(W: number, H: number, dir: IsoDir, x: number, y: number, h: number, fx0 = 0, fx1 = WORLD): Pt {
  return isoPt(isoCam(W, H, fx0, fx1, dir), x, y, h);
}

interface Panel {
  delta: Float32Array | null;
  nx: number;
  ny: number;
  dx: number;
  dy: number;
  look: Look;
  start: number;
  things: Thing[];
  pier?: boolean;
}

const deltaAt = (delta: Float32Array, nx: number, ny: number, dx: number, dy: number, x: number, y: number): number => {
  let fx = x / dx - 0.5;
  if (fx < 0) fx = 0;
  else if (fx > nx - 1.001) fx = nx - 1.001;
  let fy = y / dy - 0.5;
  if (fy < 0) fy = 0;
  else if (fy > ny - 1.001) fy = ny - 1.001;
  const i = fx | 0;
  const j = fy | 0;
  const tx = fx - i;
  const ty = fy - j;
  const k = j * nx + i;
  return (delta[k] + (delta[k + 1] - delta[k]) * tx) * (1 - ty) + (delta[k + nx] + (delta[k + nx + 1] - delta[k + nx]) * tx) * ty;
};

const toPanel = (sand: SavedSand | null, location: string | null | undefined, start: number): Panel => {
  const look = lookFor(location);
  if (!sand) return { delta: null, nx: 0, ny: 0, dx: 1, dy: 1, look, start, things: [] };
  const delta = effectiveDelta(sand);
  const dx = WORLD / sand.nx;
  const dy = WORLD / sand.ny;
  // buried rocks stay hidden, as in the top-down picture
  const things = sand.cover
    ? sand.things.filter((t) => {
        if (t.kind !== 'rock' || t.base === undefined) return true;
        const h = restHeight(t.x, t.y) + deltaAt(delta, sand.nx, sand.ny, dx, dy, t.x, t.y);
        return h <= t.base + t.size * 0.8;
      })
    : sand.things;
  return { delta, nx: sand.nx, ny: sand.ny, dx, dy, look, start, things };
};

/** fill a triangle, opaque, no anti-aliasing (the terrain is small quads) */
function fillTri(img: Uint8Array, W: number, H: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number, g: number, b: number) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
  if (minX > maxX || minY > maxY) return;
  const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (d === 0) return;
  for (let py = minY; py <= maxY; py++) {
    const y = py + 0.5;
    for (let px = minX; px <= maxX; px++) {
      const x = px + 0.5;
      const w0 = (bx - x) * (cy - y) - (by - y) * (cx - x);
      const w1 = (cx - x) * (ay - y) - (cy - y) * (ax - x);
      const w2 = (ax - x) * (by - y) - (ay - y) * (bx - x);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
        const k = (py * W + px) * 3;
        img[k] = r;
        img[k + 1] = g;
        img[k + 2] = b;
      }
    }
  }
}

/** fill a convex quad (two triangles), grown a touch so neighbours share no hairline */
function fillQuad(img: Uint8Array, W: number, H: number, pts: Pt[], r: number, g: number, b: number) {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= pts.length;
  cy /= pts.length;
  const q = pts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const l = Math.hypot(dx, dy) || 1;
    return [x + (dx / l) * 0.5, y + (dy / l) * 0.5] as Pt;
  });
  fillTri(img, W, H, q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], r, g, b);
  fillTri(img, W, H, q[0][0], q[0][1], q[2][0], q[2][1], q[3][0], q[3][1], r, g, b);
}

/**
 * Draw a beach and the public beaches either side of it as an isometric
 * diorama, 1200×630 or any size. `ocean` is the view from the sea: the sea
 * in the foreground, the beach rising away, the walk-left neighbour on the
 * picture's left. `land` is the view from the land side, looking out toward
 * the sea: the beach in the foreground, the sea far away, and the neighbours
 * mirrored — the walk-left neighbour is on the picture's right. The frame
 * fits the centre beach plus a sliver of each neighbour; a side with no
 * public neighbour ends at the centre beach, with no filler shore past it.
 */
export function renderIsoBeach(
  center: IsoPanel,
  left: IsoPanel | null,
  right: IsoPanel | null,
  opts: ImageOptions,
  dir: IsoDir,
): Uint8Array {
  const { width: W, height: H } = opts;
  const panels: Panel[] = [{ ...toPanel(center.sand, center.location, 0), pier: center.pier }];
  // facing the sea, left is world +x (the game, and the top-down card)
  if (left) panels.push({ ...toPanel(left.sand, left.location, left.linked ? WORLD : WORLD + ISO_GAP), pier: left.pier });
  if (right) panels.push({ ...toPanel(right.sand, right.location, right.linked ? -WORLD : -(WORLD + ISO_GAP)), pier: right.pier });
  const fx0 = Math.min(...panels.map((p) => p.start));
  const fx1 = Math.max(...panels.map((p) => p.start + WORLD));
  const cam = isoCam(W, H, fx0, fx1, dir);
  const out = new Uint8Array(W * H * 3);
  // billboards are drawn at the ground scale, so things read at the same
  // size relative to the beach whatever the frame fits (13 px/m at least,
  // so they still read on a small picture)
  const bs = Math.min(24, Math.max(13, cam.s));

  // sky: pale blue up top, warm haze at the horizon
  const skyTop = hex('#cfe6ee');
  const skyBot = hex('#f7ead9');
  for (let py = 0; py < H; py++) {
    const t = py / Math.max(1, H - 1);
    const r = Math.round((skyTop[0] + (skyBot[0] - skyTop[0]) * t) * 255);
    const g = Math.round((skyTop[1] + (skyBot[1] - skyTop[1]) * t) * 255);
    const b = Math.round((skyTop[2] + (skyBot[2] - skyTop[2]) * t) * 255);
    let k = py * W * 3;
    for (let px = 0; px < W; px++) {
      out[k++] = r;
      out[k++] = g;
      out[k++] = b;
    }
  }

  const sampleAt = (x: number, y: number): { h: number; d: number; look: Look } => {
    for (const p of panels) {
      if (x >= p.start && x < p.start + WORLD) {
        const lx = x - p.start;
        const d = p.delta ? deltaAt(p.delta, p.nx, p.ny, p.dx, p.dy, lx, y) : 0;
        return { h: restHeight(lx, y) + d, d, look: p.look };
      }
    }
    return { h: restHeight(x, y), d: 0, look: panels[0].look };
  };

  // heights on the grid, over exactly the beaches present
  const cols = Math.round((fx1 - fx0) / ISO_CELL);
  const rows = Math.round(WORLD / ISO_CELL);
  const hn = new Float32Array((cols + 1) * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    const y = j * ISO_CELL;
    const row = j * (cols + 1);
    for (let i = 0; i <= cols; i++) hn[row + i] = sampleAt(fx0 + i * ISO_CELL, y).h;
  }
  // light from the upper left of the picture
  const L = norm3([0.5, 0.35, 0.79]);
  const shadeScale = 0.3 / (1 - L[2] + 1e-6);

  // things, bucketed by cell so they paint in the same back-to-front order
  interface Placed {
    t: Thing;
    bx: number;
    by: number;
    look: Look;
  }
  const byCell: Placed[][] = Array.from({ length: cols * rows }, () => []);
  for (const p of panels) {
    for (const t of p.things) {
      const gx = p.start + t.x;
      const ground = sampleAt(gx, t.y).h;
      const [bx, by] = isoPt(cam, gx, t.y, ground);
      const i = Math.min(cols - 1, Math.max(0, Math.floor((gx - fx0) / ISO_CELL)));
      const j = Math.min(rows - 1, Math.max(0, Math.floor(t.y / ISO_CELL)));
      byCell[j * cols + i].push({ t, bx, by, look: p.look });
    }
  }

  // piers, cut into the same cells so they paint in the same order
  const piers = new Map<number, { piece: PierPiece; shift: number }[]>();
  for (const p of panels) {
    if (!p.pier) continue;
    for (const [k, list] of pierPieces(p.start, fx0, cols, rows, (x, y) => sampleAt(x, y).h)) {
      const at = piers.get(k) ?? [];
      for (const piece of list) at.push({ piece, shift: p.start });
      piers.set(k, at);
    }
  }

  // painter's order: far rows first, then across the row. From the sea the
  // far side is the land (high y) and the row runs low x to high x; from
  // the land it is the other way round (low y, high x to low x).
  const jFirst = dir === 'ocean' ? rows - 1 : 0;
  const jLast = dir === 'ocean' ? -1 : rows;
  const jStep = dir === 'ocean' ? -1 : 1;
  const iFirst = dir === 'ocean' ? 0 : cols - 1;
  const iLast = dir === 'ocean' ? cols : -1;
  const iStep = dir === 'ocean' ? 1 : -1;
  for (let j = jFirst; j !== jLast; j += jStep) {
    const y0 = j * ISO_CELL;
    const y1 = y0 + ISO_CELL;
    for (let i = iFirst; i !== iLast; i += iStep) {
      const x0 = fx0 + i * ISO_CELL;
      const x1 = x0 + ISO_CELL;
      const k00 = j * (cols + 1) + i;
      const h00 = hn[k00];
      const h10 = hn[k00 + 1];
      const h11 = hn[k00 + cols + 2];
      const h01 = hn[k00 + cols + 1];
      const hc = (h00 + h10 + h11 + h01) / 4;
      const xc = x0 + ISO_CELL / 2;
      const yc = y0 + ISO_CELL / 2;
      const mid = sampleAt(xc, yc);
      const look = mid.look;
      let r: number;
      let g: number;
      let b: number;
      let pts: Pt[];
      if (hc < -0.02) {
        // open water: a flat surface at sea level, coloured by depth
        const depth = -hc;
        const t1 = smoothstep(0.02, 1.1, depth);
        r = look.waterShallow[0] + (look.waterDeep[0] - look.waterShallow[0]) * t1;
        g = look.waterShallow[1] + (look.waterDeep[1] - look.waterShallow[1]) * t1;
        b = look.waterShallow[2] + (look.waterDeep[2] - look.waterShallow[2]) * t1;
        const t2 = smoothstep(0, 0.12, depth) * 0.75 + 0.25;
        r = look.sandWet[0] + (r - look.sandWet[0]) * t2;
        g = look.sandWet[1] + (g - look.sandWet[1]) * t2;
        b = look.sandWet[2] + (b - look.sandWet[2]) * t2;
        if (depth > 0.15) {
          const wave = Math.sin((yc - PROFILE.shoreline) * 2.2 + Math.sin(xc * 0.35) * 0.9 + noise1(xc * 0.6, 3) * 2);
          if (wave > 0.75) {
            // stronger than the flat card's swell lines: in the diorama the
            // sea is compressed, so the card's 0.16 blend barely shows
            const t3 = (wave - 0.75) * 1.4 * smoothstep(0.15, 0.6, depth);
            r += (look.foam[0] - r) * t3;
            g += (look.foam[1] - g) * t3;
            b += (look.foam[2] - b) * t3;
          }
        }
        if (depth < 0.035) {
          const t4 = (1 - smoothstep(0, 0.035, depth)) * 0.75;
          r += (look.foam[0] - r) * t4;
          g += (look.foam[1] - g) * t4;
          b += (look.foam[2] - b) * t4;
        }
        pts = [isoPt(cam, x0, y0, 0), isoPt(cam, x1, y0, 0), isoPt(cam, x1, y1, 0), isoPt(cam, x0, y1, 0)];
      } else {
        // sand: wet near the water, dry up the beach, dug and piled tinted
        const ts = smoothstep(0.04, 0.32, hc);
        r = look.sandWet[0] + (look.sandDry[0] - look.sandWet[0]) * ts;
        g = look.sandWet[1] + (look.sandDry[1] - look.sandWet[1]) * ts;
        b = look.sandWet[2] + (look.sandDry[2] - look.sandWet[2]) * ts;
        const d = mid.d;
        if (d < -0.04) {
          const td = smoothstep(0.04, 0.3, -d) * 0.6;
          r += (look.sandDeep[0] - r) * td;
          g += (look.sandDeep[1] - g) * td;
          b += (look.sandDeep[2] - b) * td;
        } else if (d > 0.06) {
          const sl = lighten(look.sandDry, 0.15);
          const tl = smoothstep(0.06, 0.4, d) * 0.4;
          r += (sl[0] - r) * tl;
          g += (sl[1] - g) * tl;
          b += (sl[2] - b) * tl;
        }
        // shade from the slope, like the top-down picture
        const gx = ((h10 + h11) / 2 - (h00 + h01) / 2) / ISO_CELL;
        const gy = ((h01 + h11) / 2 - (h00 + h10) / 2) / ISO_CELL;
        const n = norm3([-gx * 2.2, -gy * 2.2, 1]);
        const lambert = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
        let shade = 1 + (lambert - L[2]) * shadeScale;
        if (shade < 0.62) shade = 0.62;
        r *= shade;
        g *= shade;
        b *= shade;
        if (hc < 0.08) {
          const t4 = (1 - smoothstep(0, 0.08, hc)) * 0.6;
          r += (look.foam[0] - r) * t4;
          g += (look.foam[1] - g) * t4;
          b += (look.foam[2] - b) * t4;
        }
        // sand grain: a slow, smooth mottle, so sand reads as sand even
        // where the location tint is dark (Piha's black sand rendered as
        // one flat slab before this — the rest profile's bands were the
        // only variation). Smooth on purpose: a per-cell speckle read as
        // a checkerboard of square blocks at this zoom. Additive, so it
        // shows on dark sand too.
        const grain = ((noise1(xc * 1.8, 5) - 0.5) + (noise1(yc * 1.8, 6) - 0.5)) * 0.1;
        r += grain;
        g += grain;
        b += grain;
        pts = [isoPt(cam, x0, y0, h00), isoPt(cam, x1, y0, h10), isoPt(cam, x1, y1, h11), isoPt(cam, x0, y1, h01)];
      }
      fillQuad(out, W, H, pts, to8(r), to8(g), to8(b));
      for (const pl of byCell[j * cols + i]) drawIsoThing(out, W, H, pl, bs);
      const pp = piers.get(j * cols + i);
      if (pp) for (const { piece, shift } of pp) drawPierPiece(out, W, H, cam, piece, shift);
    }
  }
  return out;
}

/** px per metre for billboards — the ground scale, passed in so things stay in proportion to the beach whatever the frame fits (13 px/m at least, so they still read on a small picture) */
const ISO_SHADOW: RGB = [0.18, 0.14, 0.1];
const ellipsePts = (cx: number, cy: number, rx: number, ry: number, n = 16): Pt[] =>
  Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry] as Pt);

/**
 * One thing on the beach, drawn as a vertical billboard standing on the
 * sand (tall things) or a small flat mark on the ground (shells, rocks and
 * the rest). Same colours as the top-down picture.
 */
function drawIsoThing(img: Uint8Array, W: number, H: number, pl: { t: Thing; bx: number; by: number; look: Look }, bs: number) {
  const { t, bx, by, look } = pl;
  const v = Math.abs(Math.floor(t.variant));
  const vendingVariant = Math.max(0, v - 1);
  const color = itemColor(t.item, v);
  const shadow = (w: number) => fillPoly(img, W, H, ellipsePts(bx + 2, by + 1, w * 0.55, w * 0.26), ISO_SHADOW, 0.25);
  // [height factor, width factor, minimum height px] for tall things
  // (all 12 paid shop centrepieces render at 1.5× scale to match SHOP_SCALE)
  const tall: Record<string, [number, number, number]> = {
    lighthouse: [3.3, 0.75, 30],
    parasol: [1.5, 2.7, 18],
    palmtree: [3.6, 2.25, 30],
    sandcastle: [1.65, 1.95, 18],
    beachhut: [2.1, 2.1, 21],
    lifeguardtower: [3.0, 1.8, 27],
    deckchair: [1.2, 1.95, 14],
    flag: [2.0, 0.5, 14],
    tikitorch: [2.7, 0.525, 18],
    bonfire: [1.35, 1.65, 15],
    hammock: [1.5, 3.0, 15],
  };
  const spec = tall[t.kind];
  if (!spec) {
    // flat on the ground: a small mark in the thing's own colour
    let c: RGB;
    switch (t.kind) {
      case 'rock':
        c = color ?? lerp3(look.rock, [0.55, 0.5, 0.45], hash2(v, 1, 9) * 0.5);
        break;
      case 'shell':
      case 'conch':
        c = color ?? SHELLS[v % SHELLS.length];
        break;
      case 'sanddollar':
        c = color ?? C('#eee6d4');
        break;
      case 'nautilus':
        c = color ?? C('#f1e2cc');
        break;
      case 'seaglass':
        c = color ?? GLASS[v % GLASS.length];
        break;
      case 'starfish':
        c = color ?? C('#f08a4b');
        break;
      case 'trash':
        c = TRASH[v % TRASH.length];
        break;
      case 'seaweed':
        c = WEED[v % WEED.length];
        break;
      case 'coral':
        c = CORAL[v % CORAL.length];
        break;
      case 'coconut':
        c = NUT[v % NUT.length];
        break;
      case 'bottle':
        c = color ?? C('#5fa67a');
        break;
      case 'driftwood':
        c = C('#a08566');
        break;
      case 'towel':
        c = C('#2f8f7a');
        break;
      case 'sandals':
        c = SANDAL_SOLES[vendingVariant % SANDAL_SOLES.length];
        break;
      case 'bucket':
        c = BUCKET_RIMS[vendingVariant % BUCKET_RIMS.length];
        break;
      case 'beachball':
        c = C('#fbf3e4');
        break;
      case 'surfboard':
        c = C('#f2c14e');
        break;
      default:
        c = C('#d9c7a8');
    }
    const flatScale = t.kind === 'towel' || t.kind === 'surfboard' ? 1.5 : 1;
    const rx = Math.max(2.5, t.size * flatScale * bs * 0.5);
    const ry = rx * 0.45;
    if (t.kind === 'starfish') {
      fillPoly(img, W, H, star(bx, by, rx, -t.angle), c);
    } else {
      fillPoly(img, W, H, ellipsePts(bx, by, rx, ry), c);
    }
    return;
  }
  const [kf, wf, minH] = spec;
  const h = Math.min(72, Math.max(minH, t.size * bs * kf));
  const w = Math.min(64, Math.max(6, t.size * bs * wf));
  const top = by - h;
  shadow(w);
  const R = (x: number, y: number, hw: number, hh: number): Pt[] => [
    [x - hw, y - hh],
    [x + hw, y - hh],
    [x + hw, y + hh],
    [x - hw, y + hh],
  ];
  switch (t.kind) {
    case 'lighthouse':
      fillPoly(img, W, H, R(bx, top + h / 2, w / 2, h / 2), C('#ffffff'));
      fillPoly(img, W, H, R(bx, top + h * 0.55, w / 2, h * 0.16), C('#e2574c'));
      fillPoly(img, W, H, circle(bx, top + 1, Math.max(1.5, w * 0.18), 8), C('#f7d774'));
      break;
    case 'parasol': {
      const poleH = h * 0.55;
      fillPoly(img, W, H, R(bx, by - poleH / 2, 1, poleH / 2), C('#8a6b4a'));
      const cy = by - poleH;
      const r = w / 2;
      fillPoly(img, W, H, [[bx - r, cy], [bx, cy - r * 0.55], [bx + r, cy]], C('#e2574c'));
      fillPoly(img, W, H, [[bx - r * 0.33, cy], [bx, cy - r * 0.55], [bx + r * 0.33, cy]], C('#ffffff'));
      break;
    }
    case 'palmtree': {
      fillPoly(img, W, H, R(bx, by - h * 0.35, 1.5, h * 0.35), C('#6b4a2f'));
      const tx = bx;
      const ty = by - h * 0.7;
      for (let k = 0; k < 4; k++) {
        const a = -Math.PI / 2 + (k - 1.5) * 0.55;
        const ex = tx + Math.cos(a) * w * 0.75;
        const ey = ty + Math.sin(a) * w * 0.45;
        fillPoly(img, W, H, [[tx, ty], [ex, ey], [tx + Math.cos(a + 0.5) * w * 0.4, ty + Math.sin(a + 0.5) * w * 0.3]], k % 2 ? C('#4a9e5c') : C('#3f8f4f'));
      }
      break;
    }
    case 'sandcastle':
      fillPoly(img, W, H, R(bx, top + h / 2, w / 2, h / 2), lighten(look.sandDeep, 0.1));
      for (const sgn of [-1, 1]) fillPoly(img, W, H, circle(bx + sgn * w * 0.32, top + 1, Math.max(1.5, w * 0.16), 8), lighten(look.sandDry, 0.2));
      fillPoly(img, W, H, circle(bx, top + h * 0.45, Math.max(1.5, w * 0.2), 8), lighten(look.sandDry, 0.3));
      break;
    case 'beachhut':
      fillPoly(img, W, H, R(bx, top + h / 2, w / 2, h / 2), C('#4a90d9'));
      fillPoly(img, W, H, R(bx, top + h * 0.3, w / 2, h * 0.08), C('#ffffff'));
      break;
    case 'lifeguardtower':
      fillPoly(img, W, H, R(bx - w * 0.3, by - h * 0.2, 1, h * 0.2), C('#f2f0e8'));
      fillPoly(img, W, H, R(bx + w * 0.3, by - h * 0.2, 1, h * 0.2), C('#f2f0e8'));
      fillPoly(img, W, H, R(bx, top + h * 0.3, w / 2, h * 0.3), C('#f2f0e8'));
      fillPoly(img, W, H, R(bx, top + h * 0.3, w * 0.3, h * 0.18), C('#2f4a6b'));
      break;
    case 'deckchair':
      fillPoly(img, W, H, rect(bx, by - h * 0.4, w / 2, h * 0.4, 0.5), C('#3f7fc4'));
      fillPoly(img, W, H, rect(bx, by - h * 0.4, w / 2, h * 0.12, 0.5), C('#ffffff'));
      break;
    case 'flag':
      fillPoly(img, W, H, R(bx, by - h / 2, 1, h / 2), C('#6b5a48'));
      fillPoly(img, W, H, [[bx, top], [bx + w, top + h * 0.2], [bx, top + h * 0.4]], FLAGS[v % FLAGS.length]);
      break;
    case 'tikitorch':
      fillPoly(img, W, H, R(bx, by - h / 2, 1, h / 2), C('#7a5a3a'));
      fillPoly(img, W, H, circle(bx, top + 2, Math.max(1.5, w * 0.22), 8), C('#ffb347'));
      break;
    case 'bonfire':
      fillPoly(img, W, H, ellipsePts(bx, by - 1, w * 0.5, w * 0.2), C('#9aa0a8'));
      fillPoly(img, W, H, [[bx - w * 0.22, by - h * 0.3], [bx, by - h], [bx + w * 0.22, by - h * 0.3]], C('#ff8c2e'));
      break;
    case 'hammock': {
      const px = w / 2;
      fillPoly(img, W, H, circle(bx - px, by - h * 0.75, 1.5, 6), C('#8a6b4a'));
      fillPoly(img, W, H, circle(bx + px, by - h * 0.75, 1.5, 6), C('#8a6b4a'));
      fillPoly(img, W, H, [[bx - px, by - h * 0.75], [bx + px, by - h * 0.75], [bx + px * 0.7, by - h * 0.2], [bx - px * 0.7, by - h * 0.2]], C('#e86a5a'));
      break;
    }
  }
}

/** One beach's saved bytes (or null: untouched) plus its neighbours → an isometric PNG. */
export function beachIsoPng(
  center: { bytes: Uint8Array | null; location?: string | null; pier?: boolean },
  left: { bytes: Uint8Array | null; location?: string | null; linked: boolean; pier?: boolean } | null,
  right: { bytes: Uint8Array | null; location?: string | null; linked: boolean; pier?: boolean } | null,
  opts: ImageOptions,
  dir: IsoDir,
): Buffer {
  const dec = (b: { bytes: Uint8Array | null; location?: string | null; linked?: boolean; pier?: boolean } | null): IsoPanel | null => {
    if (!b) return null;
    let sand: SavedSand | null = null;
    if (b.bytes) {
      try {
        sand = decodeSavedBeach(b.bytes);
      } catch {
        sand = null;
      }
    }
    return { sand, location: b.location, linked: b.linked ?? false, pier: b.pier };
  };
  const c = dec(center);
  return encodePng(renderIsoBeach(c ?? { sand: null, linked: false }, dec(left), dec(right), opts, dir), opts.width, opts.height);
}

function footprint(t: Thing): number {
  switch (t.kind) {
    case 'parasol':
    case 'beachhut':
    case 'surfboard':
      return 4;
    case 'palmtree':
    case 'lifeguardtower':
      return 4;
    case 'sandcastle':
    case 'lighthouse':
    case 'deckchair':
      return 2;
    case 'bonfire':
    case 'hammock':
      return 2;
    case 'towel':
      return 1;
    case 'rock':
    case 'driftwood':
    case 'sanddollar':
      return t.size;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGB pixels → PNG (each row "Up"-filtered, which suits smooth sand). */
export function encodePng(rgb: Uint8Array, W: number, H: number): Buffer {
  const stride = W * 3;
  const raw = Buffer.allocUnsafe((stride + 1) * H);
  if (H > 0) {
    raw[0] = 0;
    raw.set(rgb.subarray(0, stride), 1);
    for (let y = 1; y < H; y++) {
      const o = y * (stride + 1);
      const cur = y * stride;
      const prev = cur - stride;
      raw[o] = 2;
      for (let i = 0; i < stride; i++) {
        raw[o + 1 + i] = (rgb[cur + i] - rgb[prev + i]) & 0xff;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** A saved beach's bytes (or null: untouched) → PNG. */
export function beachPng(bytes: Uint8Array | null, opts: ImageOptions): Buffer {
  let sand: SavedSand | null = null;
  if (bytes) {
    try {
      sand = decodeSavedBeach(bytes);
    } catch {
      sand = null; // a broken save still gets a picture of the beach
    }
  }
  return encodePng(renderBeach(sand, opts), opts.width, pictureHeight(opts));
}

// ---------------------------------------------------------------- the pier (docs/PIERS.md)
// A copy of the app's PIER (src/config.ts) and its colours (src/palette.ts);
// tests/beachImage.test.ts keeps them in step. Drawn on a beach whose pier
// shows (the `pier` flag in shore data): from above on the card and the
// thumbnail, and as boxes in the isometric views.

export const PIER = {
  landY: 22,
  rampTopY: 18,
  endY: 3,
  platformY: 6.5,
  width: 2.5,
  platformWidth: 4,
  deckHeight: 1.65,
  footHeight: 0.43,
  deckThickness: 0.14,
  pilingStep: 3,
  pilingDepth: -2.7,
  pilingSize: 0.22,
  railHeight: 0.9,
};
export const PIER_COLORS = { deck: '#a8927a', piling: '#6f6052', rail: '#c9b89f' };

/**
 * One box of the pier, in a beach's own frame: x alongshore (0..32), y
 * from the offshore edge, heights above still water. Top and bottom may
 * slope along y (the ramp): t0/b0 at y0, t1/b1 at y1. `layer` orders the
 * boxes that share a spot: pilings, then the deck, then the rails.
 */
export interface PierBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  b0: number;
  b1: number;
  t0: number;
  t1: number;
  color: RGB;
  layer: number;
}

/** The pier as boxes, centred on the beach (pure; the pictures draw these). */
export function pierBoxes(): PierBox[] {
  const p = PIER;
  const deck = hex(PIER_COLORS.deck);
  const piling = hex(PIER_COLORS.piling);
  const rail = hex(PIER_COLORS.rail);
  const mid = WORLD / 2;
  const top = p.deckHeight;
  const under = top - p.deckThickness;
  const out: PierBox[] = [];
  const flat = (x0: number, x1: number, y0: number, y1: number, b: number, t: number, color: RGB, layer: number) =>
    out.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1), b0: b, b1: b, t0: t, t1: t, color, layer });
  const hw = p.width / 2;
  const pw = p.platformWidth / 2;
  // pilings first: the pictures clip them at the water or the sand
  const pile = (x: number, y: number) => {
    const s = p.pilingSize / 2;
    flat(x - s, x + s, y - s, y + s, p.pilingDepth, under, piling, 0);
  };
  for (let y = p.rampTopY; y > p.platformY; y -= p.pilingStep) {
    pile(mid - hw + 0.15, y);
    pile(mid + hw - 0.15, y);
  }
  for (const y of [p.platformY - 0.2, p.endY + 0.2]) {
    pile(mid - pw + 0.15, y);
    pile(mid + pw - 0.15, y);
  }
  // the deck, the end platform, and the ramp down to the sand
  flat(mid - hw, mid + hw, p.platformY, p.rampTopY, under, top, deck, 1);
  flat(mid - pw, mid + pw, p.endY, p.platformY, under, top, deck, 1);
  out.push({ x0: mid - hw, x1: mid + hw, y0: p.rampTopY, y1: p.landY, b0: under, b1: p.footHeight - p.deckThickness, t0: top, t1: p.footHeight, color: deck, layer: 1 });
  // rails along both sides and round the end (a little thicker than the
  // app's, so they still read at a few pixels per metre)
  const rt = top + p.railHeight;
  const rw = 0.12;
  for (const s of [-1, 1]) {
    const x = mid + s * (hw - 0.06);
    flat(x - rw / 2, x + rw / 2, p.platformY, p.rampTopY, rt - rw, rt, rail, 2);
    for (let y = p.rampTopY; y > p.platformY; y -= p.pilingStep / 2) flat(x - rw / 2, x + rw / 2, y - rw / 2, y + rw / 2, top, rt, rail, 2);
    out.push({ x0: x - rw / 2, x1: x + rw / 2, y0: p.rampTopY, y1: p.landY, b0: rt - rw, b1: p.footHeight + p.railHeight - rw, t0: rt, t1: p.footHeight + p.railHeight, color: rail, layer: 2 });
    const px = mid + s * (pw - 0.06);
    flat(px - rw / 2, px + rw / 2, p.endY, p.platformY, rt - rw, rt, rail, 2);
    for (const y of [p.platformY, (p.platformY + p.endY) / 2, p.endY + rw / 2]) flat(px - rw / 2, px + rw / 2, y - rw / 2, y + rw / 2, top, rt, rail, 2);
    flat(mid + s * hw, mid + s * pw, p.platformY - rw / 2, p.platformY + rw / 2, rt - rw, rt, rail, 2);
  }
  flat(mid - pw, mid + pw, p.endY, p.endY + rw, rt - rw, rt, rail, 2);
  return out;
}

/** The pier seen from above (the card and the thumbnail): its shadow, then the deck, then the rails. */
function drawPierTop(img: Uint8Array, W: number, H: number, at: (x: number, y: number) => Pt, s: number) {
  const boxes = pierBoxes().filter((b) => b.layer > 0);
  // light from the top left of the picture: shadows fall down and to the right
  const lift = (h: number): Pt => [h * s * 0.5, h * s * 0.55];
  const quad = (b: PierBox, h0: number, h1: number, off: boolean): Pt[] => {
    const [a0, c0] = off ? lift(h0) : [0, 0];
    const [a1, c1] = off ? lift(h1) : [0, 0];
    const p = (x: number, y: number, a: number, c: number): Pt => {
      const [px, py] = at(x, y);
      return [px + a, py + c];
    };
    return [p(b.x0, b.y0, a0, c0), p(b.x1, b.y0, a0, c0), p(b.x1, b.y1, a1, c1), p(b.x0, b.y1, a1, c1)];
  };
  // (the deck's shadow only: the rails' thin ones read as stray lines at this size)
  for (const b of boxes) if (b.layer === 1) fillPoly(img, W, H, quad(b, b.t0, b.t1, true), ISO_SHADOW, 0.28);
  for (const b of boxes.sort((a, c) => a.layer - c.layer)) {
    // the ramp's slope reads a shade darker than the flat deck
    const c = b.t0 !== b.t1 && b.layer === 1 ? lighten(b.color, -0.08) : b.color;
    fillPoly(img, W, H, quad(b, 0, 0, false), c, 1);
  }
  // planks across the deck
  const plank = lighten(hex(PIER_COLORS.deck), -0.12);
  for (const b of boxes.filter((x) => x.layer === 1)) {
    for (let y = b.y0 + 0.6; y < b.y1 - 0.1; y += 0.6) {
      const [ax, ay] = at(b.x0 + 0.05, y);
      const [bx] = at(b.x1 - 0.05, y);
      fillPoly(img, W, H, [[ax, ay - 0.35], [bx, ay - 0.35], [bx, ay + 0.35], [ax, ay + 0.35]], plank, 0.55);
    }
  }
}

/**
 * The pier's boxes cut into the isometric grid's cells, so each piece
 * paints with its cell, back to front. Only the outer faces of each box are
 * kept (the cuts don't show), pilings stop at the water or the sand, and
 * `x0` shifts the pier onto its beach in the strip.
 */
interface PierPiece {
  box: PierBox;
  xa: number;
  xb: number;
  ya: number;
  yb: number;
  /** the bottom here (a piling: where it meets the water or the sand) */
  floor: number | null;
}
function pierPieces(start: number, fx0: number, cols: number, rows: number, ground: (x: number, y: number) => number): Map<number, PierPiece[]> {
  const out = new Map<number, PierPiece[]>();
  for (const box of pierBoxes()) {
    const gx0 = start + box.x0;
    const gx1 = start + box.x1;
    const i0 = Math.max(0, Math.floor((gx0 - fx0) / ISO_CELL));
    const i1 = Math.min(cols - 1, Math.floor((gx1 - fx0 - 1e-9) / ISO_CELL));
    const j0 = Math.max(0, Math.floor(box.y0 / ISO_CELL));
    const j1 = Math.min(rows - 1, Math.floor((box.y1 - 1e-9) / ISO_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const xa = Math.max(gx0, fx0 + i * ISO_CELL);
        const xb = Math.min(gx1, fx0 + (i + 1) * ISO_CELL);
        const ya = Math.max(box.y0, j * ISO_CELL);
        const yb = Math.min(box.y1, (j + 1) * ISO_CELL);
        if (xb <= xa || yb <= ya) continue;
        const floor = box.layer === 0 ? Math.max(0, ground((xa + xb) / 2, (ya + yb) / 2)) : null;
        const k = j * cols + i;
        const list = out.get(k) ?? [];
        list.push({ box, xa, xb, ya, yb, floor });
        out.set(k, list);
      }
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.box.layer - b.box.layer);
  return out;
}

/** Paint one piece of the pier: the faces turned toward the camera, then its top. */
function drawPierPiece(img: Uint8Array, W: number, H: number, cam: IsoCam, pc: PierPiece, shift: number) {
  const { box: b, xa, xb, ya, yb } = pc;
  const along = (y: number, a: number, c: number) => (b.y1 === b.y0 ? a : a + ((y - b.y0) / (b.y1 - b.y0)) * (c - a));
  const ta = along(ya, b.t0, b.t1);
  const tb = along(yb, b.t0, b.t1);
  const ba = pc.floor ?? along(ya, b.b0, b.b1);
  const bb = pc.floor ?? along(yb, b.b0, b.b1);
  if (ta <= ba && tb <= bb) return; // a piling wholly under the sand
  const P = (x: number, y: number, h: number) => isoPt(cam, x, y, h);
  const face = (pts: Pt[], k: number) => {
    const c = b.color;
    fillQuad(img, W, H, pts, to8(c[0] * k), to8(c[1] * k), to8(c[2] * k));
  };
  // toward the camera: from the sea, -y and +x; from the land, +y and -x
  const ocean = cam.sgn > 0;
  const gx0 = b.x0 + shift;
  const gx1 = b.x1 + shift;
  const yEdge = ocean ? b.y0 : b.y1;
  const yFace = ocean ? ya : yb;
  if (yFace === yEdge) {
    const t = ocean ? ta : tb;
    const f = ocean ? ba : bb;
    face([P(xa, yFace, f), P(xb, yFace, f), P(xb, yFace, t), P(xa, yFace, t)], 0.84);
  }
  const xFace = ocean ? xb : xa;
  if (Math.abs(xFace - (ocean ? gx1 : gx0)) < 1e-6) face([P(xFace, ya, ba), P(xFace, yb, bb), P(xFace, yb, tb), P(xFace, ya, ta)], 0.7);
  face([P(xa, ya, ta), P(xb, ya, ta), P(xb, yb, tb), P(xa, yb, tb)], 1);
}
