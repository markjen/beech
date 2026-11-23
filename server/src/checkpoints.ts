// Checkpoints (docs/CHECKPOINTS.md): the server reads a saved beach's bytes
// itself, so a restore never trusts the app's own count of what's on it.
import { deflateSync, inflateSync } from 'node:zlib';

/** a saved beach (and so a checkpoint) is never bigger than this */
export const MAX_BEACH_BYTES = 768 * 1024;
export const MAX_CELLS = 400 * 300;
const MAX_OBJECTS = 400;
const MAX_OBJECTS_JSON = 128 * 1024;

/**
 * Items anyone can place as many of as they like. Everything else, unknown
 * ids included, has to be owned. Kept in step with the catalog's `unlimited`
 * items (src/world/items.ts) by a client test.
 */
export const FREE_ITEMS: ReadonlySet<string> = new Set(['rock', 'driftwood', 'shell', 'seaglass', 'flag']);

/** checkpoint limits */
export const CHECKPOINTS_PER_BEACH = 5;
export const CHECKPOINT_BYTES_PER_USER = 16 * 1024 * 1024;
export const CHECKPOINT_NAME_MAX = 40;

const MAGIC1 = 'BCH1';
const MAGIC2 = 'BCH2';

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
}

function parts(bytes: Uint8Array): { nx: number; ny: number; sand: Uint8Array; objs: Uint8Array | null } {
  if (bytes.byteLength > MAX_BEACH_BYTES) throw new BadBlob('too big');
  const magic = Buffer.from(bytes.subarray(0, 4)).toString('latin1');
  if (bytes.byteLength < 8 || (magic !== MAGIC1 && magic !== MAGIC2)) throw new BadBlob('not a saved beach');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nx = dv.getUint16(4, true);
  const ny = dv.getUint16(6, true);
  if (nx < 8 || ny < 8 || nx * ny > MAX_CELLS) throw new BadBlob('bad grid size');
  if (magic === MAGIC1) return { nx, ny, sand: bytes.subarray(8), objs: null };
  if (bytes.byteLength < 12) throw new BadBlob('not a saved beach');
  const len = dv.getUint32(8, true);
  if (12 + len > bytes.byteLength) throw new BadBlob('corrupt saved beach');
  return { nx, ny, sand: bytes.subarray(12, 12 + len), objs: bytes.subarray(12 + len) };
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

/** Count what's on a saved beach. Throws BadBlob if it isn't one. */
export function inspectBlob(bytes: Uint8Array): BlobInfo {
  const { nx, ny, sand, objs } = parts(bytes);
  const raw = inflate(sand, nx * ny * 2 + 1);
  if (raw.byteLength !== nx * ny * 2) throw new BadBlob('corrupt saved beach');
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
 * last (highest ids) come off. The sand bytes are kept as they are.
 */
export function dropMissing(bytes: Uint8Array, short: Short[]): { bytes: Uint8Array; dropped: number } {
  const { sand, objs } = parts(bytes);
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
  const out = new Uint8Array(12 + sand.byteLength + json.byteLength);
  out.set(bytes.subarray(0, 12), 0);
  new DataView(out.buffer).setUint32(8, sand.byteLength, true);
  out.set(sand, 12);
  out.set(json, 12 + sand.byteLength);
  return { bytes: out, dropped: gone.size };
}
