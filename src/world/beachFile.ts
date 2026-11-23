// Beach files (`.beach.json`): the documented, hand-editable beach format.
// The specification is docs/BEACH_FILE.md; this module is its reference
// reader and writer. Pure TypeScript with no DOM, so it runs in the browser,
// Node and Vitest (it uses CompressionStream, like sandCodec.ts).

import { PROFILE, WORLD_SIZE_X, WORLD_SIZE_Z } from '../config';
import type { PlacedObject } from '../sim/objects';
import { MAX_OBJECTS, resampleField, type SavedBeach } from '../sim/sandCodec';
import { itemById } from './items';
import { beachById } from './locations';

export const BEACH_FORMAT = 'beech.beach';
export const BEACH_FILE_VERSION = 1;
/** files larger than this (characters) are refused */
export const MAX_FILE_CHARS = 4 * 1024 * 1024;
export const MAX_SHAPES = 500;
/** the most sand you can pile up (m above the untouched beach) */
export const MAX_RAISE = 3;
const MIN_GRID = 8;
const MAX_GRID = 512;
/** how far objects stay from the beach's edges (m) */
const EDGE = 0.3;
const MAX_NAME = 40;
const MAX_VARIANT = 1_000_000;

export type SandEncoding = 'rows' | 'int16le' | 'deflate-int16le';
export type ShapeMode = 'add' | 'set' | 'max' | 'min';

export type Shape =
  | { type: 'mound'; x: number; y: number; radius: number; height: number; mode?: ShapeMode; edge?: number }
  | { type: 'line'; from: [number, number]; to: [number, number]; width: number; height: number; mode?: ShapeMode; edge?: number }
  | { type: 'rect'; x: number; y: number; width: number; length: number; angle?: number; height: number; mode?: ShapeMode; edge?: number }
  | { type: 'ring'; x: number; y: number; radius: number; width: number; height: number; mode?: ShapeMode; edge?: number };

export interface Issue {
  /** JSON path, e.g. `objects[3].x` ("" for the whole file) */
  path: string;
  message: string;
}

/** A beach read from a file, at the grid size asked for. */
export interface ImportedBeach extends SavedBeach {
  name?: string;
  location?: string;
}

export type ParseResult =
  | { ok: true; beach: ImportedBeach; warnings: Issue[] }
  | { ok: false; errors: Issue[] };

// ------------------------------------------------------------------ base64

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// ------------------------------------------------------------------ helpers

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** The lowest the sand can go (m, relative to the untouched beach). */
export const MIN_DELTA = -PROFILE.digDepthLimit;

class Checker {
  errors: Issue[] = [];
  warnings: Issue[] = [];
  err(path: string, message: string): void {
    this.errors.push({ path, message });
  }
  warn(path: string, message: string): void {
    this.warnings.push({ path, message });
  }
  /** A finite number, clamped to [lo, hi] with a warning; undefined (and an error) if it isn't a number. */
  num(o: Record<string, unknown>, key: string, path: string, lo: number, hi: number, fallback?: number): number | undefined {
    const v = o[key];
    if (v === undefined && fallback !== undefined) return fallback;
    if (!isNum(v)) {
      this.err(`${path}.${key}`, v === undefined ? 'is required' : 'must be a number');
      return undefined;
    }
    if (v < lo || v > hi) {
      this.warn(`${path}.${key}`, `${v} is outside ${lo} to ${hi}; using ${clamp(v, lo, hi)}`);
      return clamp(v, lo, hi);
    }
    return v;
  }
}

// ------------------------------------------------------------------ sand grid

async function readSand(c: Checker, raw: unknown): Promise<{ nx: number; ny: number; mm: Float32Array } | null> {
  if (!isObj(raw)) {
    c.err('sand', 'must be an object');
    return null;
  }
  const { nx, ny, unit, encoding, data } = raw;
  const sizeOk = (v: unknown) => Number.isInteger(v) && (v as number) >= MIN_GRID && (v as number) <= MAX_GRID;
  if (!sizeOk(nx)) c.err('sand.nx', `must be a whole number from ${MIN_GRID} to ${MAX_GRID}`);
  if (!sizeOk(ny)) c.err('sand.ny', `must be a whole number from ${MIN_GRID} to ${MAX_GRID}`);
  if (unit !== 'mm') c.err('sand.unit', 'must be "mm"');
  if (encoding !== 'rows' && encoding !== 'int16le' && encoding !== 'deflate-int16le') {
    c.err('sand.encoding', 'must be "rows", "int16le" or "deflate-int16le"');
  }
  if (c.errors.length) return null;
  const w = nx as number;
  const h = ny as number;
  const mm = new Float32Array(w * h);
  if (encoding === 'rows') {
    if (!Array.isArray(data) || data.length !== h) {
      c.err('sand.data', `must be an array of ${h} rows`);
      return null;
    }
    let clamped = 0;
    for (let j = 0; j < h; j++) {
      const row = data[j];
      if (!Array.isArray(row) || row.length !== w) {
        c.err(`sand.data[${j}]`, `must be an array of ${w} numbers`);
        return null;
      }
      for (let i = 0; i < w; i++) {
        const v = row[i];
        if (!isNum(v)) {
          c.err(`sand.data[${j}][${i}]`, 'must be a number');
          return null;
        }
        const q = Math.round(v);
        if (q > 32767 || q < -32767) clamped++;
        mm[j * w + i] = clamp(q, -32767, 32767);
      }
    }
    if (clamped) c.warn('sand.data', `${clamped} heights were outside -32767 to 32767 mm and were clamped`);
    return { nx: w, ny: h, mm };
  }
  if (typeof data !== 'string') {
    c.err('sand.data', 'must be a base64 string');
    return null;
  }
  let bytes = fromBase64(data);
  if (!bytes) {
    c.err('sand.data', 'is not valid base64');
    return null;
  }
  if (encoding === 'deflate-int16le') {
    try {
      bytes = await pipe(bytes, new DecompressionStream('deflate'));
    } catch {
      c.err('sand.data', 'is not valid deflate (zlib) data');
      return null;
    }
  }
  if (bytes.length !== w * h * 2) {
    c.err('sand.data', `holds ${bytes.length} bytes; ${w} x ${h} heights need ${w * h * 2}`);
    return null;
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let k = 0; k < w * h; k++) mm[k] = dv.getInt16(k * 2, true);
  return { nx: w, ny: h, mm };
}

// ------------------------------------------------------------------ shapes

const MODES = new Set<ShapeMode>(['add', 'set', 'max', 'min']);

function readShape(c: Checker, raw: unknown, path: string): Shape | null {
  if (!isObj(raw)) {
    c.warn(path, 'is not an object; skipped');
    return null;
  }
  const before = c.errors.length;
  const len = (k: string) => c.num(raw, k, path, 0.05, 32);
  const pos = (k: string, hi: number) => c.num(raw, k, path, -WORLD_SIZE_X, hi + WORLD_SIZE_X);
  const height = c.num(raw, 'height', path, -MAX_RAISE, MAX_RAISE);
  let mode: ShapeMode | undefined;
  if (raw.mode !== undefined) {
    if (MODES.has(raw.mode as ShapeMode)) mode = raw.mode as ShapeMode;
    else c.warn(`${path}.mode`, `unknown mode ${JSON.stringify(raw.mode)}; using "add"`);
  }
  const edge = raw.edge === undefined ? undefined : c.num(raw, 'edge', path, 0, 32);
  const common = { height: height as number, ...(mode ? { mode } : {}), ...(edge !== undefined ? { edge } : {}) };
  let shape: Shape | null = null;
  switch (raw.type) {
    case 'mound':
      shape = { type: 'mound', x: pos('x', WORLD_SIZE_X) as number, y: pos('y', WORLD_SIZE_Z) as number, radius: len('radius') as number, ...common };
      break;
    case 'ring':
      shape = { type: 'ring', x: pos('x', WORLD_SIZE_X) as number, y: pos('y', WORLD_SIZE_Z) as number, radius: len('radius') as number, width: len('width') as number, ...common };
      break;
    case 'rect':
      shape = {
        type: 'rect',
        x: pos('x', WORLD_SIZE_X) as number,
        y: pos('y', WORLD_SIZE_Z) as number,
        width: len('width') as number,
        length: len('length') as number,
        angle: c.num(raw, 'angle', path, -1e6, 1e6, 0),
        ...common,
      };
      break;
    case 'line': {
      const pt = (k: string): [number, number] | undefined => {
        const v = raw[k];
        if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1])) {
          c.err(`${path}.${k}`, 'must be [x, y]');
          return undefined;
        }
        return [clamp(v[0], -WORLD_SIZE_X, 2 * WORLD_SIZE_X), clamp(v[1], -WORLD_SIZE_Z, 2 * WORLD_SIZE_Z)];
      };
      shape = { type: 'line', from: pt('from') as [number, number], to: pt('to') as [number, number], width: len('width') as number, ...common };
      break;
    }
    default:
      c.warn(`${path}.type`, `unknown shape ${JSON.stringify(raw.type)}; skipped`);
      return null;
  }
  // a broken shape is an error: drawing a guess would surprise people
  return c.errors.length > before ? null : shape;
}

/** The default soft-edge width of a shape (m). */
function defaultEdge(s: Shape): number {
  switch (s.type) {
    case 'mound':
      return s.radius; // a dome
    case 'ring':
    case 'line':
      return s.width / 4;
    case 'rect':
      return Math.min(s.width, s.length) / 4;
  }
}

/** Signed distance (m) from (x, y) to the shape's outline: negative inside. */
function signedDistance(s: Shape, x: number, y: number): number {
  switch (s.type) {
    case 'mound':
      return Math.hypot(x - s.x, y - s.y) - s.radius;
    case 'ring':
      return Math.abs(Math.hypot(x - s.x, y - s.y) - s.radius) - s.width / 2;
    case 'line': {
      const [ax, ay] = s.from;
      const [bx, by] = s.to;
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
      return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) - s.width / 2;
    }
    case 'rect': {
      const a = ((s.angle ?? 0) * Math.PI) / 180;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const lx = (x - s.x) * ca + (y - s.y) * sa;
      const ly = -(x - s.x) * sa + (y - s.y) * ca;
      const qx = Math.abs(lx) - s.width / 2;
      const qy = Math.abs(ly) - s.length / 2;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
    }
  }
}

/** The shape's bounding box (m): [x0, y0, x1, y1]. */
function bounds(s: Shape): [number, number, number, number] {
  switch (s.type) {
    case 'mound':
      return [s.x - s.radius, s.y - s.radius, s.x + s.radius, s.y + s.radius];
    case 'ring': {
      const r = s.radius + s.width / 2;
      return [s.x - r, s.y - r, s.x + r, s.y + r];
    }
    case 'line': {
      const w = s.width / 2;
      return [Math.min(s.from[0], s.to[0]) - w, Math.min(s.from[1], s.to[1]) - w, Math.max(s.from[0], s.to[0]) + w, Math.max(s.from[1], s.to[1]) + w];
    }
    case 'rect': {
      const r = Math.hypot(s.width, s.length) / 2;
      return [s.x - r, s.y - r, s.x + r, s.y + r];
    }
  }
}

/**
 * Draw shapes into a height field (m, relative to the untouched beach) that
 * covers the whole beach at nx x ny cells. In place.
 */
export function drawShapes(delta: Float32Array, nx: number, ny: number, shapes: Shape[]): void {
  const dx = WORLD_SIZE_X / nx;
  const dy = WORLD_SIZE_Z / ny;
  for (const s of shapes) {
    const e = Math.max(0, s.edge ?? defaultEdge(s));
    const mode = s.mode ?? 'add';
    const [x0, y0, x1, y1] = bounds(s);
    const i0 = Math.max(0, Math.floor(x0 / dx - 0.5));
    const i1 = Math.min(nx - 1, Math.ceil(x1 / dx - 0.5));
    const j0 = Math.max(0, Math.floor(y0 / dy - 0.5));
    const j1 = Math.min(ny - 1, Math.ceil(y1 / dy - 0.5));
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) * dy;
      for (let i = i0; i <= i1; i++) {
        const inside = -signedDistance(s, (i + 0.5) * dx, y);
        if (inside <= 0) continue;
        const f = inside >= e ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * inside) / e);
        const k = j * nx + i;
        const d = delta[k];
        switch (mode) {
          case 'add':
            delta[k] = d + s.height * f;
            break;
          case 'set':
            delta[k] = d + (s.height - d) * f;
            break;
          case 'max':
            delta[k] = d + Math.max(0, s.height - d) * f;
            break;
          case 'min':
            delta[k] = d + Math.min(0, s.height - d) * f;
            break;
        }
      }
    }
  }
}

// ------------------------------------------------------------------ objects

/** A variant seed for an object the file gives none for (stable for the same file). */
const defaultVariant = (x: number, y: number, n: number) => 1 + ((Math.round(x * 100) * 31 + Math.round(y * 100) * 17 + n * 7) % 997);

function readObjects(c: Checker, raw: unknown): PlacedObject[] {
  if (!Array.isArray(raw)) {
    c.err('objects', 'must be an array');
    return [];
  }
  if (raw.length > MAX_OBJECTS) c.warn('objects', `has ${raw.length} objects; only the first ${MAX_OBJECTS} are used`);
  const out: PlacedObject[] = [];
  raw.slice(0, MAX_OBJECTS).forEach((o, n) => {
    const path = `objects[${n}]`;
    if (!isObj(o)) {
      c.warn(path, 'is not an object; skipped');
      return;
    }
    const item = typeof o.item === 'string' ? itemById(o.item) : undefined;
    if (!item) {
      c.warn(`${path}.item`, `unknown item ${JSON.stringify(o.item)}; skipped`);
      return;
    }
    const before = c.errors.length;
    const x = c.num(o, 'x', path, EDGE, WORLD_SIZE_X - EDGE);
    const y = c.num(o, 'y', path, EDGE, WORLD_SIZE_Z - EDGE);
    if (c.errors.length > before) return;
    const angle = c.num(o, 'angle', path, -1e6, 1e6, 0) as number;
    const [lo, hi] = item.size;
    const size = item.fixedSize ? lo : (c.num(o, 'size', path, lo, hi, Math.sqrt(lo * hi)) as number);
    let variant = defaultVariant(x as number, y as number, n);
    if (o.variant !== undefined) {
      if (Number.isInteger(o.variant) && (o.variant as number) >= 0 && (o.variant as number) <= MAX_VARIANT) variant = o.variant as number;
      else c.warn(`${path}.variant`, `must be a whole number from 0 to ${MAX_VARIANT}; using ${variant}`);
    }
    out.push({ id: out.length + 1, kind: item.kind, item: item.id, x: x as number, y: y as number, angle: (angle * Math.PI) / 180, size, variant });
  });
  return out;
}

// ------------------------------------------------------------------ reading

export interface ParseOptions {
  /** the grid the beach is wanted at (default 256 x 256) */
  nx?: number;
  ny?: number;
}

/** Read a beach file. Structural problems are errors; anything fixable is a warning. */
export async function parseBeachFile(text: string, opts: ParseOptions = {}): Promise<ParseResult> {
  const nx = opts.nx ?? 256;
  const ny = opts.ny ?? 256;
  const c = new Checker();
  if (text.length > MAX_FILE_CHARS) return { ok: false, errors: [{ path: '', message: `the file is larger than ${MAX_FILE_CHARS / 1024 / 1024} MB` }] };
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ path: '', message: `not valid JSON (${(e as Error).message})` }] };
  }
  if (!isObj(root)) return { ok: false, errors: [{ path: '', message: 'must be a JSON object' }] };
  if (root.format !== BEACH_FORMAT) c.err('format', `must be "${BEACH_FORMAT}"`);
  if (!Number.isInteger(root.version) || (root.version as number) < 1) c.err('version', 'must be a whole number, 1 or more');
  else if ((root.version as number) > BEACH_FILE_VERSION) c.err('version', `this file is version ${root.version}; update the app to open it`);
  if (c.errors.length) return { ok: false, errors: c.errors };

  let name: string | undefined;
  if (root.name !== undefined) {
    if (typeof root.name !== 'string') c.warn('name', 'must be text; ignored');
    else {
      name = root.name.trim().slice(0, MAX_NAME);
      if (root.name.trim().length > MAX_NAME) c.warn('name', `longer than ${MAX_NAME} characters; shortened`);
    }
  }
  let location: string | undefined;
  if (root.location !== undefined) {
    if (typeof root.location === 'string' && beachById(root.location)) location = root.location;
    else c.warn('location', `unknown location ${JSON.stringify(root.location)}; ignored`);
  }

  // sand: the grid (resampled to the wanted size), then the shapes
  let delta: Float32Array = new Float32Array(nx * ny);
  if (root.sand !== undefined) {
    const sand = await readSand(c, root.sand);
    if (sand) {
      const m = new Float32Array(sand.mm.length);
      for (let k = 0; k < m.length; k++) m[k] = sand.mm[k] / 1000;
      delta = resampleField(m, sand.nx, sand.ny, nx, ny);
    }
  }
  if (root.shapes !== undefined) {
    if (!Array.isArray(root.shapes)) c.err('shapes', 'must be an array');
    else {
      if (root.shapes.length > MAX_SHAPES) c.warn('shapes', `has ${root.shapes.length} shapes; only the first ${MAX_SHAPES} are used`);
      const shapes = root.shapes.slice(0, MAX_SHAPES).map((s, n) => readShape(c, s, `shapes[${n}]`)).filter((s): s is Shape => !!s);
      if (!c.errors.length) drawShapes(delta, nx, ny, shapes);
    }
  }
  let low = 0;
  let high = 0;
  for (let k = 0; k < delta.length; k++) {
    if (delta[k] < MIN_DELTA) {
      delta[k] = MIN_DELTA;
      low++;
    } else if (delta[k] > MAX_RAISE) {
      delta[k] = MAX_RAISE;
      high++;
    }
  }
  if (low) c.warn('sand', `${low} cells dug deeper than ${-MIN_DELTA} m reach the rock below and were raised to it`);
  if (high) c.warn('sand', `${high} cells piled higher than ${MAX_RAISE} m were lowered to it`);

  const objects = root.objects === undefined ? [] : readObjects(c, root.objects);
  if (c.errors.length) return { ok: false, errors: c.errors };
  return { ok: true, beach: { nx, ny, delta, objects, ...(name ? { name } : {}), ...(location ? { location } : {}) }, warnings: c.warnings };
}

// ------------------------------------------------------------------ writing

export interface WriteOptions {
  name?: string;
  location?: string;
  /** e.g. "beech 0.1.0" */
  createdWith?: string;
  /** "deflate-int16le" (default, compact) or "rows" (for editing by hand) */
  encoding?: SandEncoding;
}

/** Write a beach as a version 1 beach file (pretty enough to read). */
export async function writeBeachFile(beach: SavedBeach, opts: WriteOptions = {}): Promise<string> {
  const { nx, ny, delta } = beach;
  const q = new Int16Array(nx * ny);
  for (let k = 0; k < q.length; k++) q[k] = clamp(Math.round(delta[k] * 1000), -32767, 32767);
  const encoding = opts.encoding ?? 'deflate-int16le';
  let data: unknown;
  if (encoding === 'rows') {
    const rows: number[][] = [];
    for (let j = 0; j < ny; j++) rows.push(Array.from(q.subarray(j * nx, (j + 1) * nx)));
    data = rows;
  } else {
    // int16 arrays are little-endian on every platform we run on
    const bytes = new Uint8Array(q.buffer);
    data = toBase64(encoding === 'deflate-int16le' ? await pipe(bytes, new CompressionStream('deflate')) : bytes);
  }
  const objects = beach.objects
    .filter((o) => !o.wild)
    .slice(0, MAX_OBJECTS)
    .map((o) => {
      const item = itemById(o.item);
      return {
        item: o.item,
        x: r3(o.x),
        y: r3(o.y),
        angle: r1((o.angle * 180) / Math.PI),
        ...(item?.fixedSize ? {} : { size: r3(o.size) }),
        variant: Math.round(o.variant),
      };
    });
  const file = {
    format: BEACH_FORMAT,
    version: BEACH_FILE_VERSION,
    ...(opts.name ? { name: opts.name.slice(0, MAX_NAME) } : {}),
    ...(opts.location ? { location: opts.location } : {}),
    ...(opts.createdWith ? { createdWith: opts.createdWith } : {}),
    sand: { nx, ny, unit: 'mm', encoding, data: '\u0000' },
    objects: '\u0001',
  };
  // one object per line and one sand row per line: readable, and diffs well
  const dataJson =
    encoding === 'rows' ? `[\n${(data as number[][]).map((r) => `      ${JSON.stringify(r)}`).join(',\n')}\n    ]` : JSON.stringify(data);
  const objsJson = objects.length ? `[\n${objects.map((o) => `    ${JSON.stringify(o)}`).join(',\n')}\n  ]` : '[]';
  return `${JSON.stringify(file, null, 2).replace('"\\u0000"', dataJson).replace('"\\u0001"', objsJson)}\n`;
}

// ------------------------------------------------------------------ inventory

export interface Shortfall {
  item: string;
  /** how many the beach uses */
  need: number;
  /** how many you can put down */
  have: number;
}

/**
 * Keep what you can build: free items always; other items up to
 * owned - placed on your other beaches, in the order the beach lists them.
 * The same rule applies to imports and checkpoint restores.
 */
export function reconcileItems(
  objects: PlacedObject[],
  owned: ReadonlyMap<string, number>,
  placedElsewhere: ReadonlyMap<string, number> = new Map(),
): { keep: PlacedObject[]; missing: Shortfall[] } {
  const left = new Map<string, number>();
  const need = new Map<string, number>();
  const keep: PlacedObject[] = [];
  for (const o of objects) {
    const item = itemById(o.item);
    if (!item) continue;
    if (item.unlimited) {
      keep.push(o);
      continue;
    }
    need.set(o.item, (need.get(o.item) ?? 0) + 1);
    if (!left.has(o.item)) left.set(o.item, Math.max(0, (owned.get(o.item) ?? 0) - (placedElsewhere.get(o.item) ?? 0)));
    const n = left.get(o.item) as number;
    if (n > 0) {
      left.set(o.item, n - 1);
      keep.push(o);
    }
  }
  const missing: Shortfall[] = [];
  for (const [item, n] of need) {
    const have = Math.max(0, (owned.get(item) ?? 0) - (placedElsewhere.get(item) ?? 0));
    if (n > have) missing.push({ item, need: n, have });
  }
  return { keep, missing };
}
