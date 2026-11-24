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

/** Height (m, sea level 0) of the untouched beach: src/sim/profile.ts restHeight. */
export function restHeight(x: number, y: number, seed = 1): number {
  const P = PROFILE;
  const wobble =
    P.cuspAmp * Math.sin((2 * Math.PI * x) / P.cuspLength + 0.7) * 0.6 + (noise1(x / 9, seed) - 0.5) * P.cuspAmp * 1.6;
  const s = y - (P.shoreline + wobble);
  let h: number;
  if (s < 0) {
    const c = 2;
    const A = P.offshoreDepth / (Math.pow(P.shoreline + c, 2 / 3) - Math.pow(c, 2 / 3));
    h = -A * (Math.pow(-s + c, 2 / 3) - Math.pow(c, 2 / 3));
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
}
export interface SavedSand {
  nx: number;
  ny: number;
  /** sand minus the untouched beach, metres, row j (offshore first) by column i */
  delta: Float32Array;
  things: Thing[];
}

const MAX_BYTES = 768 * 1024;
const MAX_CELLS = 400 * 400;
const MAX_THINGS = 2000;

/** BCH1 / BCH2 (src/sim/sandCodec.ts) → heights and things. Throws on anything malformed. */
export function decodeSavedBeach(bytes: Uint8Array): SavedSand {
  if (bytes.byteLength > MAX_BYTES || bytes.byteLength < 8) throw new Error('not a saved beach');
  const magic = Buffer.from(bytes.subarray(0, 4)).toString('latin1');
  if (magic !== 'BCH1' && magic !== 'BCH2') throw new Error('not a saved beach');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nx = dv.getUint16(4, true);
  const ny = dv.getUint16(6, true);
  if (nx < 8 || ny < 8 || nx * ny > MAX_CELLS) throw new Error('bad grid size');
  let sand = bytes.subarray(8);
  let objs: Uint8Array | null = null;
  if (magic === 'BCH2') {
    if (bytes.byteLength < 12) throw new Error('not a saved beach');
    const len = dv.getUint32(8, true);
    if (12 + len > bytes.byteLength) throw new Error('corrupt saved beach');
    sand = bytes.subarray(12, 12 + len);
    objs = bytes.subarray(12 + len);
  }
  const raw = inflateSync(sand, { maxOutputLength: nx * ny * 2 + 16 });
  if (raw.byteLength !== nx * ny * 2) throw new Error('corrupt saved beach');
  const delta = new Float32Array(nx * ny);
  const rv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let k = 0; k < delta.length; k++) delta[k] = rv.getInt16(k * 2, true) / 1000;
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
      });
    }
  }
  return { nx, ny, delta, things };
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
  for (let j = -1; j <= ny; j++) {
    for (let i = -1; i <= nx; i++) {
      const x = (i + 0.5) * dx;
      const y = (j + 0.5) * dy;
      const inside = i >= 0 && j >= 0 && i < nx && j < ny;
      const d = inside && sand ? sand.delta[j * nx + i] : 0;
      hgt[(j + 1) * gx + (i + 1)] = restHeight(x, y) + d;
      dug[(j + 1) * gx + (i + 1)] = d;
    }
  }
  const sample = (f: Float32Array, x: number, y: number) => {
    const fx = Math.min(gx - 1.001, Math.max(0, x / dx + 0.5));
    const fy = Math.min(gy - 1.001, Math.max(0, y / dy + 0.5));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const a = f[j * gx + i];
    const b = f[j * gx + i + 1];
    const c = f[(j + 1) * gx + i];
    const e = f[(j + 1) * gx + i + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (e - c) * tx) * ty;
  };
  const scale = H / (VIEW_Y1 - VIEW_Y0); // px per metre
  const cx = W / 2;
  // facing the sea, left is +x: the picture is mirrored alongshore
  const toWorldX = (px: number) => WORLD / 2 - (px + 0.5 - cx) / scale;
  const toWorldY = (py: number) => VIEW_Y0 + (py + 0.5) / scale;
  const out = new Uint8Array(W * H * 3);
  // light from the top left of the picture (offshore, +x)
  const L = norm3([-0.55, -0.55, 0.63]);
  const e = 0.6 * Math.min(dx, dy);
  for (let py = 0; py < H; py++) {
    const y = toWorldY(py);
    for (let px = 0; px < W; px++) {
      const x = toWorldX(px);
      // outside the beach (or past the shore): the untouched shore, faded
      const off = x < 0 ? -x : x > WORLD ? x - WORLD : 0;
      const h = off ? restHeight(x, y) : sample(hgt, x, y);
      let col: RGB;
      if (h < 0) {
        const depth = -h;
        col = lerp3(look.waterShallow, look.waterDeep, smoothstep(0.02, 1.1, depth));
        // the sand shows through the shallows
        col = lerp3(look.sandWet, col, smoothstep(0, 0.12, depth) * 0.75 + 0.25);
        // long, gentle swell lines
        const wave = Math.sin((y - PROFILE.shoreline) * 2.2 + Math.sin(x * 0.35) * 0.9 + noise1(x * 0.6, 3) * 2);
        col = lerp3(col, look.foam, Math.max(0, wave - 0.82) * 0.9 * smoothstep(0.15, 0.6, depth));
        // lace at the waterline
        col = lerp3(col, look.foam, (1 - smoothstep(0, 0.035, depth)) * 0.75);
      } else {
        const hx = off ? (restHeight(x + e, y) - restHeight(x - e, y)) / (2 * e) : (sample(hgt, x + e, y) - sample(hgt, x - e, y)) / (2 * e);
        const hy = off ? (restHeight(x, y + e) - restHeight(x, y - e)) / (2 * e) : (sample(hgt, x, y + e) - sample(hgt, x, y - e)) / (2 * e);
        // picture axes: px grows toward -x, py toward +y; exaggerate relief
        const n = norm3([hx * 1.6, -hy * 1.6, 1]);
        const lambert = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
        const flat = L[2];
        col = lerp3(look.sandWet, look.sandDry, smoothstep(0.04, 0.32, h));
        const d = off ? 0 : sample(dug, x, y);
        if (d < -0.04) col = lerp3(col, look.sandDeep, smoothstep(0.04, 0.3, -d) * 0.6);
        if (d > 0.06) col = lerp3(col, lighten(look.sandDry, 0.15), smoothstep(0.06, 0.4, d) * 0.4);
        const shade = Math.max(0.62, 1 + 0.3 * (lambert - flat) / (1 - flat + 1e-6));
        col = [col[0] * shade, col[1] * shade, col[2] * shade];
      }
      // the shore carries on past the beach, faded into the haze
      const edge = Math.max(-x, x - WORLD);
      if (edge > -0.6) col = lerp3(col, look.fog, 0.5 * smoothstep(-0.6, 5, edge));
      const k = (py * W + px) * 3;
      out[k] = to8(col[0]);
      out[k + 1] = to8(col[1]);
      out[k + 2] = to8(col[2]);
    }
  }
  if (sand) drawThings(out, W, H, sand.things, look, (x, y) => [cx - (x - WORLD / 2) * scale, (y - VIEW_Y0) * scale], scale);
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
// palette (src/palette.ts); tests/beachImage.test.ts keeps them in step.
export const SHELLS = ['#f7ead8', '#efe4d2', '#e8d9c0', '#f5e1cf', '#e6cfa8', '#f2e3c2', '#dfc49a', '#efe0c0'].map(C);
const GLASS = ['#9fd8c1', '#8cc7de', '#b7e0a8', '#d3eef0'].map(C);
const FLAGS = ['#e2574c', '#f2b134', '#4a90d9', '#55b27a'].map(C);

/** Prize items draw in their own colours (a copy of src/palette.ts ITEM_LOOKS). */
export const ITEM_COLORS: Record<string, string[]> = {
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
      case 'conch':
        parts.push([circle(px, py, m(Math.max(0.1, t.size * 0.5), 3), 10), itemColor(t.item, v) ?? SHELLS[v % SHELLS.length]]);
        break;
      case 'sanddollar':
        parts.push([circle(px, py, m(Math.max(0.08, t.size * 0.5), 2), 12), itemColor(t.item, v) ?? C('#eee6d4')]);
        break;
      case 'nautilus':
        parts.push([circle(px, py, m(Math.max(0.1, t.size * 0.5), 2.2), 12), itemColor(t.item, v) ?? C('#f1e2cc')]);
        break;
      case 'seaglass':
        parts.push([circle(px, py, m(0.07, 1.6), 6), itemColor(t.item, v) ?? GLASS[v % GLASS.length]]);
        break;
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
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGB pixels → PNG (each row "Up"-filtered, which suits smooth sand). */
export function encodePng(rgb: Uint8Array, W: number, H: number): Buffer {
  const stride = W * 3;
  const raw = Buffer.alloc((stride + 1) * H);
  for (let y = 0; y < H; y++) {
    const o = y * (stride + 1);
    raw[o] = y === 0 ? 0 : 2;
    for (let i = 0; i < stride; i++) {
      const v = rgb[y * stride + i];
      raw[o + 1 + i] = y === 0 ? v : (v - rgb[(y - 1) * stride + i]) & 0xff;
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
