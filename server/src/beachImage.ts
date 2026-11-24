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
const MAX_CELLS = 400 * 400;
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
      if (!num(p.x, 0, 64) || !num(p.y, 0, 64)) continue;
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
  return { nx, ny, delta, things, ...(cover ? { cover } : {}) };
}

// ---------------------------------------------------------------- drawing

export interface ImageOptions {
  width: number;
  height: number;
  location?: string | null;
}

/** cross-shore window drawn: from a little out to sea to the back of the beach */
const VIEW_Y0 = 11.5;
const VIEW_Y1 = WORLD;

/**
 * Draw a saved beach (or the untouched beach, `sand` null) as RGB pixels.
 * The picture always shows the whole depth of the beach; wider pictures
 * show the shore carrying on either side, a little faded.
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
  const effDelta = sand ? sand.delta.slice() : null;
  if (sand?.cover && effDelta) {
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
  }
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
  const scale = H / (VIEW_Y1 - VIEW_Y0); // px per metre
  const cx = W / 2;
  const invScale = 1 / scale;
  const out = new Uint8Array(W * H * 3);
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
  const fg0 = look.fog[0], fg1 = look.fog[1], fg2 = look.fog[2];

  // Precompute per-column values and bilinear x indices (independent of py)
  const colX = new Float64Array(W);
  const colOff = new Uint8Array(W);
  const colWave = new Float64Array(W);
  const colFog = new Float64Array(W);
  const colWob = new Float64Array(W);
  const colWobP = new Float64Array(W);
  const colWobM = new Float64Array(W);
  const colI = new Int32Array(W);
  const colTx = new Float64Array(W);
  const colIp = new Int32Array(W);
  const colTxp = new Float64Array(W);
  const colIm = new Int32Array(W);
  const colTxm = new Float64Array(W);
  for (let px = 0; px < W; px++) {
    // facing the sea, left is +x: the picture is mirrored alongshore
    const x = WORLD / 2 - (px + 0.5 - cx) * invScale;
    colX[px] = x;
    const isOff = x < 0 || x > WORLD ? 1 : 0;
    colOff[px] = isOff;
    colWave[px] = Math.sin(x * 0.35) * 0.9 + noise1(x * 0.6, 3) * 2;
    const edge = Math.max(-x, x - WORLD);
    colFog[px] = edge > -0.6 ? 0.5 * smoothstep(-0.6, 5, edge) : 0;
    if (isOff) {
      colWob[px] = wobbleAt(x);
      colWobP[px] = wobbleAt(x + e);
      colWobM[px] = wobbleAt(x - e);
    } else {
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
  }

  let kOut = 0;
  for (let py = 0; py < H; py++) {
    const y = VIEW_Y0 + (py + 0.5) * invScale;
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
      const off = colOff[px];
      let h: number;
      if (off) {
        h = restHeightW(colX[px], y, colWob[px]);
      } else {
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
        if (off) {
          const x = colX[px];
          const w = colWob[px];
          hx = (restHeightW(x + e, y, colWobP[px]) - restHeightW(x - e, y, colWobM[px])) * inv2e;
          hy = (restHeightW(x, y + e, w) - restHeightW(x, y - e, w)) * inv2e;
        } else {
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
        if (!off) {
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
      // the shore carries on past the beach, faded into the haze
      const fogT = colFog[px];
      if (fogT > 0) {
        r += (fg0 - r) * fogT;
        g += (fg1 - g) * fogT;
        b += (fg2 - b) * fogT;
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
    drawThings(out, W, H, visible, look, (x, y) => [cx - (x - WORLD / 2) * scale, (y - VIEW_Y0) * scale], scale);
  }
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

const C = (h: string) => hex(h);
// Free shells are warm cream, tan and peach — no pink anywhere (pink is
// reserved for the pink shell, a prize). A copy of the app's free shell
// palette (src/palette.ts); tests/specialItems.test.ts keeps them in step.
export const SHELLS = ['#f7ead8', '#efe4d2', '#e8d9c0', '#f5e1cf', '#e6cfa8', '#f2e3c2', '#dfc49a', '#efe0c0'].map(C);
const GLASS = ['#9fd8c1', '#8cc7de', '#b7e0a8', '#d3eef0'].map(C);
const FLAGS = ['#e2574c', '#f2b134', '#4a90d9', '#55b27a'].map(C);
const TRASH = ['#e63329', '#1f8fff', '#22b573', '#ffcf00'].map(C);
const WEED = ['#4a5d23', '#3d4a1f', '#5d6b2a', '#6b5e2f'].map(C);

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
      case 'starfish':
        parts.push([star(px, py, m(Math.max(0.12, t.size * 0.6), 3), a), itemColor(t.item, v) ?? C('#f08a4b')]);
        break;
      case 'bottle':
        parts.push([rect(px, py, m(0.18, 3), m(0.06, 1.3), a), itemColor(t.item, v) ?? C('#5fa67a')]);
        break;
      case 'flag':
        parts.push([circle(px, py, m(0.04, 1.2), 6), C('#6b5a48')]);
        parts.push([[[px, py], [px + m(0.5, 7), py - m(0.17, 3)], [px, py - m(0.34, 6)]], FLAGS[v % FLAGS.length]]);
        break;
      case 'deckchair':
        parts.push([rect(px, py, m(0.3, 3), m(0.6, 5), a), C('#3f7fc4')]);
        parts.push([rect(px, py, m(0.3, 3) * 0.45, m(0.6, 5), a), C('#ffffff')]);
        break;
      case 'parasol': {
        const r = m(1, 7);
        for (let i = 0; i < 8; i++) {
          const t0 = (i / 8) * Math.PI * 2 + a;
          const t1 = ((i + 1) / 8) * Math.PI * 2 + a;
          parts.push([[[px, py], [px + Math.cos(t0) * r, py + Math.sin(t0) * r], [px + Math.cos(t1) * r, py + Math.sin(t1) * r]], i % 2 ? C('#ffffff') : C('#e2574c')]);
        }
        break;
      }
      case 'surfboard':
        parts.push([rect(px, py, m(1, 7), m(0.26, 2.2), a).map((p, i) => (i % 2 ? p : p)) as Pt[], C('#f2c14e')]);
        parts.push([rect(px, py, m(1, 7), m(0.04, 0.8), a), C('#e2574c')]);
        break;
      case 'sandcastle': {
        const r = m(0.6, 5);
        parts.push([rect(px, py, r, r, a), lighten(look.sandDeep, 0.1)]);
        for (const [ox, oy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as Pt[])
          parts.push([circle(px + ox * r, py + oy * r, r * 0.38, 10), lighten(look.sandDry, 0.2)]);
        parts.push([circle(px, py, r * 0.45, 12), lighten(look.sandDry, 0.3)]);
        break;
      }
      case 'beachhut':
        parts.push([rect(px, py, m(0.9, 6), m(0.75, 5), a), C('#4a90d9')]);
        parts.push([rect(px, py, m(0.9, 6), m(0.12, 1), a), C('#ffffff')]);
        break;
      case 'lighthouse':
        parts.push([circle(px, py, m(0.55, 4.5), 16), C('#ffffff')]);
        parts.push([circle(px, py, m(0.38, 3), 16), C('#e2574c')]);
        parts.push([circle(px, py, m(0.16, 1.5), 10), C('#f7d774')]);
        break;
      case 'tikitorch':
        parts.push([circle(px, py, m(0.12, 2), 8), C('#7a5a3a')]);
        parts.push([circle(px, py, m(0.07, 1.2), 8), C('#ffb347')]);
        break;
      default:
        parts.push([circle(px, py, m(0.12, 2), 8), C('#d9c7a8')]);
    }
    // one shadow under the whole thing, then the parts
    for (const [pts] of parts.slice(0, 1)) fillPoly(img, W, H, pts.map(([x, y]) => [x + sh, y + sh] as Pt), shadow, 0.28);
    for (const [pts, c] of parts) fillPoly(img, W, H, pts, c);
  }
}

function footprint(t: Thing): number {
  switch (t.kind) {
    case 'parasol':
    case 'beachhut':
    case 'surfboard':
      return 4;
    case 'sandcastle':
    case 'lighthouse':
    case 'deckchair':
      return 2;
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
  return encodePng(renderBeach(sand, opts), opts.width, opts.height);
}
