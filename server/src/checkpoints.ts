// Checkpoints (docs/CHECKPOINTS.md): the server reads a saved beach's bytes
// itself, so a restore never trusts the app's own count of what's on it.
import { deflateSync, inflateSync } from 'node:zlib';

/** a saved beach (and so a checkpoint) is never bigger than this */
export const MAX_BEACH_BYTES = 768 * 1024;
export const MAX_CELLS = 400 * 300;
/** the most things a saved beach holds (src/sim/sandCodec.ts MAX_OBJECTS) */
export const MAX_OBJECTS = 2000;
/** what apps before the raise kept (they send no X-Beach-Max) */
export const OLD_MAX_OBJECTS = 400;
/** the things part, inflated: ~120 bytes a thing, with room to spare */
const MAX_OBJECTS_JSON = 512 * 1024;

/**
 * Items anyone can place as many of as they like. Everything else, unknown
 * ids included, has to be owned. Kept in step with the catalog's `unlimited`
 * items (src/world/items.ts) by a client test.
 */
export const FREE_ITEMS: ReadonlySet<string> = new Set(['rock', 'driftwood', 'shell', 'seaglass', 'trash', 'seaweed', 'cowrie', 'flag', 'footprints']);

/** checkpoint limits */
export const CHECKPOINTS_PER_BEACH = 5;
export const CHECKPOINT_BYTES_PER_USER = 16 * 1024 * 1024;
export const CHECKPOINT_NAME_MAX = 40;

/**
 * A save counts as a large edit when it reshapes at least this share of the
 * beach's sand cells by at least LARGE_EDIT_MIN_HEIGHT_MM, or changes at
 * least LARGE_EDIT_MIN_OBJECTS things, or changes the grid. 10% of a beach
 * is about 100 m² on every grid tier (low 192²: 3,686 cells × 0.028 m²;
 * medium 256²: 6,554 × 0.016 m²; high 320²: 10,240 × 0.01 m²) — far beyond
 * one brush stroke at the largest radius (2.2 m, ~15 m², ~1.5%), and well
 * within what a bulldozer run across a quadrant, flattening the whole
 * beach, or pasting a design does. A single stroke can never trip it; a
 * session that reshapes a tenth of the beach always does.
 */
export const LARGE_EDIT_FRACTION = 0.1;
/** sand stored in millimetres; a real dig moves it by tens of centimetres, while wave settling and a centimetre of drift do not count as reshaping */
export const LARGE_EDIT_MIN_HEIGHT_MM = 50;
/** things moved, added or removed, counting a move as two (one gone, one new) */
export const LARGE_EDIT_MIN_OBJECTS = 50;

export interface SandDiff {
  /** cells whose height moved by at least LARGE_EDIT_MIN_HEIGHT_MM */
  changedCells: number;
  totalCells: number;
  /** things added, removed or moved (symmetric difference of placed things) */
  changedObjects: number;
  /** the grids differ: a resample reshapes the whole beach */
  gridChanged: boolean;
  large: boolean;
}

function objectKey(o: RawObject): string {
  const x = typeof o.x === 'number' ? o.x.toFixed(2) : '';
  const y = typeof o.y === 'number' ? o.y.toFixed(2) : '';
  const angle = typeof o.angle === 'number' ? o.angle.toFixed(2) : '';
  const size = typeof o.size === 'number' ? o.size.toFixed(2) : '';
  return `${typeof o.id === 'number' ? o.id : '?'}:${o.item as string}:${x}:${y}:${angle}:${size}`;
}

/**
 * How much a new save differs from the beach as saved: sand cells moved,
 * things moved/added/removed, and whether the grid changed. Unreadable
 * bytes count as large — when the server cannot tell what changed, it
 * keeps the old beach rather than risk losing it unseen. BCH1 saves have
 * no things part, so they compare on sand alone.
 */
export function sandDiff(oldBytes: Uint8Array, newBytes: Uint8Array): SandDiff {
  let oldSand: Buffer;
  let newSand: Buffer;
  let oldNx = 0;
  let oldNy = 0;
  let newNx = 0;
  let newNy = 0;
  let oldObjs: RawObject[] = [];
  let newObjs: RawObject[] = [];
  try {
    const o = parts(oldBytes);
    const n = parts(newBytes);
    oldNx = o.nx;
    oldNy = o.ny;
    newNx = n.nx;
    newNy = n.ny;
    oldSand = inflate(o.sand, o.nx * o.ny * 2 + 1);
    newSand = inflate(n.sand, n.nx * n.ny * 2 + 1);
    if (oldSand.byteLength !== o.nx * o.ny * 2 || newSand.byteLength !== n.nx * n.ny * 2) throw new BadBlob('corrupt saved beach');
    oldObjs = readObjects(o.objs);
    newObjs = readObjects(n.objs);
  } catch {
    return { changedCells: 0, totalCells: 0, changedObjects: 0, gridChanged: false, large: true };
  }
  const gridChanged = oldNx !== newNx || oldNy !== newNy;
  let changedCells = 0;
  if (!gridChanged) {
    for (let i = 0; i < oldNx * oldNy; i++) {
      if (Math.abs(oldSand.readInt16LE(i * 2) - newSand.readInt16LE(i * 2)) >= LARGE_EDIT_MIN_HEIGHT_MM) changedCells++;
    }
  }
  const oldKeys = new Map<string, number>();
  for (const k of oldObjs.map(objectKey)) oldKeys.set(k, (oldKeys.get(k) ?? 0) + 1);
  let changedObjects = 0;
  for (const k of newObjs.map(objectKey)) {
    const left = oldKeys.get(k) ?? 0;
    if (left > 0) oldKeys.set(k, left - 1);
    else changedObjects++;
  }
  for (const left of oldKeys.values()) changedObjects += left;
  const totalCells = oldNx * oldNy;
  const large = gridChanged || changedCells >= totalCells * LARGE_EDIT_FRACTION || changedObjects >= LARGE_EDIT_MIN_OBJECTS;
  return { changedCells, totalCells, changedObjects, gridChanged, large };
}

const MAGIC1 = 'BCH1';
const MAGIC2 = 'BCH2';
const MAGIC3 = 'BCH3';

export interface BlobInfo {
  nx: number;
  ny: number;
  /** non-free items on it (wild ones too: the sea only brings free kinds) */
  items: Record<string, number>;
  objects: number;
}

export class BadBlob extends Error {}

interface RawObject {
  id?: unknown;
  item?: unknown;
  wild?: unknown;
  x?: unknown;
  y?: unknown;
  angle?: unknown;
  size?: unknown;
}

function parts(bytes: Uint8Array): { nx: number; ny: number; sand: Uint8Array; objs: Uint8Array | null; cover: Uint8Array | null } {
  if (bytes.byteLength > MAX_BEACH_BYTES) throw new BadBlob('too big');
  const magic = Buffer.from(bytes.subarray(0, 4)).toString('latin1');
  if (bytes.byteLength < 8 || (magic !== MAGIC1 && magic !== MAGIC2 && magic !== MAGIC3)) throw new BadBlob('not a saved beach');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nx = dv.getUint16(4, true);
  const ny = dv.getUint16(6, true);
  if (nx < 8 || ny < 8 || nx * ny > MAX_CELLS) throw new BadBlob('bad grid size');
  if (magic === MAGIC1) return { nx, ny, sand: bytes.subarray(8), objs: null, cover: null };
  if (magic === MAGIC2) {
    if (bytes.byteLength < 12) throw new BadBlob('not a saved beach');
    const len = dv.getUint32(8, true);
    if (12 + len > bytes.byteLength) throw new BadBlob('corrupt saved beach');
    return { nx, ny, sand: bytes.subarray(12, 12 + len), objs: bytes.subarray(12 + len), cover: null };
  }
  if (bytes.byteLength < 16) throw new BadBlob('not a saved beach');
  const sandLen = dv.getUint32(8, true);
  const objsLen = dv.getUint32(12, true);
  if (16 + sandLen + objsLen > bytes.byteLength) throw new BadBlob('corrupt saved beach');
  return {
    nx,
    ny,
    sand: bytes.subarray(16, 16 + sandLen),
    objs: bytes.subarray(16 + sandLen, 16 + sandLen + objsLen),
    cover: bytes.subarray(16 + sandLen + objsLen),
  };
}

function inflate(data: Uint8Array, max: number): Buffer {
  try {
    // maxOutputLength: a tiny zip bomb can't make us allocate gigabytes
    return inflateSync(data, { maxOutputLength: max });
  } catch {
    throw new BadBlob('corrupt saved beach');
  }
}

function readObjects(objs: Uint8Array | null): RawObject[] {
  if (!objs) return [];
  let list: unknown;
  try {
    list = JSON.parse(inflate(objs, MAX_OBJECTS_JSON).toString('utf8'));
  } catch (e) {
    if (e instanceof BadBlob) throw e;
    throw new BadBlob('corrupt saved beach');
  }
  if (!Array.isArray(list) || list.length > MAX_OBJECTS) throw new BadBlob('too many things');
  for (const o of list) {
    if (!o || typeof o !== 'object' || typeof (o as RawObject).item !== 'string' || ((o as RawObject).item as string).length > 64)
      throw new BadBlob('bad thing on the beach');
  }
  return list as RawObject[];
}

/** How many things a saved beach holds (0 if it can't be read). */
export function countObjects(bytes: Uint8Array): number {
  try {
    return readObjects(parts(bytes).objs).length;
  } catch {
    return 0;
  }
}

/** Count what's on a saved beach. Throws BadBlob if it isn't one. */
export function inspectBlob(bytes: Uint8Array): BlobInfo {
  const { nx, ny, sand, objs, cover } = parts(bytes);
  const raw = inflate(sand, nx * ny * 2 + 1);
  if (raw.byteLength !== nx * ny * 2) throw new BadBlob('corrupt saved beach');
  if (cover) {
    const rawCov = inflate(cover, nx * ny * 2 + 1);
    if (rawCov.byteLength !== nx * ny * 2) throw new BadBlob('corrupt saved beach');
  }
  const list = readObjects(objs);
  const items: Record<string, number> = {};
  for (const o of list) {
    const id = o.item as string;
    if (FREE_ITEMS.has(id)) continue;
    items[id] = (items[id] ?? 0) + 1;
  }
  return { nx, ny, items, objects: list.length };
}

export interface Short {
  item: string;
  need: number;
  have: number;
}

/**
 * What a restore is short of: for each item it needs, owned minus what's on
 * your other beaches must cover it. (The target's own things don't count:
 * the restore replaces them.) Shared cases: tests/fixtures/checkpoint-fit.json.
 */
export function shortfall(
  need: Record<string, number>,
  owned: Record<string, number>,
  elsewhere: Record<string, number>,
): Short[] {
  const out: Short[] = [];
  for (const [item, n] of Object.entries(need).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (n <= 0 || FREE_ITEMS.has(item)) continue;
    const have = Math.max(0, (owned[item] ?? 0) - (elsewhere[item] ?? 0));
    if (n > have) out.push({ item, need: n, have });
  }
  return out;
}

/**
 * The same beach without what's short: of each short item, the ones placed
 * last (highest ids) come off. The sand (and rock cover) bytes are kept as they are.
 */
export function dropMissing(bytes: Uint8Array, short: Short[]): { bytes: Uint8Array; dropped: number } {
  const { sand, objs, cover } = parts(bytes);
  if (!objs || !short.length) return { bytes, dropped: 0 };
  const list = readObjects(objs);
  const drop = new Map(short.map((s) => [s.item, s.need - s.have]));
  const byNewest = list
    .map((o, i) => ({ o, i, id: typeof o.id === 'number' ? o.id : i }))
    .sort((a, b) => b.id - a.id);
  const gone = new Set<number>();
  for (const { o, i } of byNewest) {
    const left = drop.get(o.item as string) ?? 0;
    if (left > 0) {
      gone.add(i);
      drop.set(o.item as string, left - 1);
    }
  }
  const kept = list.filter((_, i) => !gone.has(i));
  const json = deflateSync(Buffer.from(JSON.stringify(kept), 'utf8'));
  if (cover) {
    const out = new Uint8Array(16 + sand.byteLength + json.byteLength + cover.byteLength);
    out.set(bytes.subarray(0, 16), 0);
    const dv = new DataView(out.buffer);
    dv.setUint32(8, sand.byteLength, true);
    dv.setUint32(12, json.byteLength, true);
    out.set(sand, 16);
    out.set(json, 16 + sand.byteLength);
    out.set(cover, 16 + sand.byteLength + json.byteLength);
    return { bytes: out, dropped: gone.size };
  }
  const out = new Uint8Array(12 + sand.byteLength + json.byteLength);
  out.set(bytes.subarray(0, 12), 0);
  new DataView(out.buffer).setUint32(8, sand.byteLength, true);
  out.set(sand, 12);
  out.set(json, 12 + sand.byteLength);
  return { bytes: out, dropped: gone.size };
}
