// Compact storage for a player's beach.
//
// We store the sand *relative to the untouched beach* (sand - rest), rounded
// to the millimetre, as little-endian int16, then zlib-compress it. Untouched
// areas are zeros, so a typical beach is a few KB.
//
//   bytes 0-3  "BCH1"
//   bytes 4-5  nx (uint16 LE)
//   bytes 6-7  ny (uint16 LE)
//   bytes 8-   deflate(int16[nx*ny] millimetres)
//
// Version 2 adds the things placed on the beach (rocks, driftwood…):
//
//   bytes 0-3   "BCH2"
//   bytes 4-7   nx, ny (uint16 LE)
//   bytes 8-11  length of the compressed sand (uint32 LE)
//   then        deflate(int16 sand), deflate(UTF-8 JSON PlacedObject[])
//
// Rocks are stored as objects, not as sand, so a saved rock is a rock again
// when the beach loads. Version 1 files still load (with no objects).

import type { PlacedObject } from './objects';

const MAGIC = [0x42, 0x43, 0x48, 0x31]; // "BCH1"
const MAGIC2 = [0x42, 0x43, 0x48, 0x32]; // "BCH2"
const KINDS = new Set(['rock', 'driftwood']);
/** a saved beach never holds more than this many objects */
export const MAX_OBJECTS = 400;
const MM = 1000;

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function quantize(delta: Float32Array): Int16Array {
  const q = new Int16Array(delta.length);
  for (let k = 0; k < q.length; k++) {
    const v = Math.round(delta[k] * MM);
    q[k] = v > 32767 ? 32767 : v < -32767 ? -32767 : v;
  }
  return q;
}

export async function encodeSand(
  delta: Float32Array,
  nx: number,
  ny: number,
  objects: PlacedObject[] = [],
): Promise<Uint8Array> {
  if (delta.length !== nx * ny) throw new Error('size mismatch');
  const q = quantize(delta);
  if (objects.length) {
    const sand = await pipe(new Uint8Array(q.buffer), new CompressionStream('deflate'));
    const json = new TextEncoder().encode(JSON.stringify(objects.slice(0, MAX_OBJECTS).map(round)));
    const objs = await pipe(json, new CompressionStream('deflate'));
    const out = new Uint8Array(12 + sand.length + objs.length);
    out.set(MAGIC2, 0);
    const dv = new DataView(out.buffer);
    dv.setUint16(4, nx, true);
    dv.setUint16(6, ny, true);
    dv.setUint32(8, sand.length, true);
    out.set(sand, 12);
    out.set(objs, 12 + sand.length);
    return out;
  }
  // int16 arrays are little-endian on every platform we run on (x86, ARM)
  const packed = await pipe(new Uint8Array(q.buffer), new CompressionStream('deflate'));
  const out = new Uint8Array(8 + packed.length);
  out.set(MAGIC, 0);
  const dv = new DataView(out.buffer);
  dv.setUint16(4, nx, true);
  dv.setUint16(6, ny, true);
  out.set(packed, 8);
  return out;
}

export interface SavedBeach {
  nx: number;
  ny: number;
  delta: Float32Array;
  objects: PlacedObject[];
}

export async function decodeSand(bytes: Uint8Array): Promise<SavedBeach> {
  const v1 = bytes.length >= 8 && MAGIC.every((m, i) => bytes[i] === m);
  const v2 = bytes.length >= 12 && MAGIC2.every((m, i) => bytes[i] === m);
  if (!v1 && !v2) throw new Error('not a saved beach');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nx = dv.getUint16(4, true);
  const ny = dv.getUint16(6, true);
  let sandBytes = bytes.subarray(8);
  let objects: PlacedObject[] = [];
  if (v2) {
    const len = dv.getUint32(8, true);
    if (12 + len > bytes.length) throw new Error('corrupt saved beach');
    sandBytes = bytes.subarray(12, 12 + len);
    const json = await pipe(bytes.subarray(12 + len), new DecompressionStream('deflate'));
    objects = sanitizeObjects(JSON.parse(new TextDecoder().decode(json)));
  }
  const raw = await pipe(sandBytes, new DecompressionStream('deflate'));
  if (raw.byteLength !== nx * ny * 2) throw new Error('corrupt saved beach');
  const q = new Int16Array(raw.buffer, raw.byteOffset, nx * ny);
  const delta = new Float32Array(nx * ny);
  for (let k = 0; k < delta.length; k++) delta[k] = q[k] / MM;
  return { nx, ny, delta, objects };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const round = (o: PlacedObject): PlacedObject => ({ ...o, x: r3(o.x), y: r3(o.y), angle: r3(o.angle), size: r3(o.size) });

/** Saved data comes from elsewhere: keep only well-formed objects on the beach. */
export function sanitizeObjects(raw: unknown): PlacedObject[] {
  if (!Array.isArray(raw)) return [];
  const out: PlacedObject[] = [];
  const ids = new Set<number>();
  const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  for (const o of raw.slice(0, MAX_OBJECTS)) {
    if (!o || typeof o !== 'object') continue;
    const p = o as Record<string, unknown>;
    if (typeof p.kind !== 'string' || !KINDS.has(p.kind)) continue;
    if (typeof p.item !== 'string' || p.item.length > 64) continue;
    if (!num(p.id, 1, 1e9) || ids.has(p.id as number)) continue;
    if (!num(p.x, 0, 64) || !num(p.y, 0, 64) || !num(p.angle, -1e4, 1e4) || !num(p.size, 0.05, 4) || !num(p.variant, 0, 1e6)) continue;
    ids.add(p.id as number);
    out.push({
      id: p.id as number,
      kind: p.kind as PlacedObject['kind'],
      item: p.item,
      x: p.x as number,
      y: p.y as number,
      angle: p.angle as number,
      size: p.size as number,
      variant: p.variant as number,
    });
  }
  return out;
}

/**
 * Resample a field between grid sizes covering the same 32 m x 24 m world
 * (a beach saved on a desktop "fine" grid loads on a phone's "light" grid).
 */
export function resampleField(src: Float32Array, nx: number, ny: number, toNx: number, toNy: number): Float32Array {
  if (nx === toNx && ny === toNy) return src.slice();
  const out = new Float32Array(toNx * toNy);
  for (let j = 0; j < toNy; j++) {
    const fy = Math.min(ny - 1, Math.max(0, ((j + 0.5) * ny) / toNy - 0.5));
    const j0 = Math.min(ny - 2, Math.floor(fy));
    const ty = fy - j0;
    for (let i = 0; i < toNx; i++) {
      const fx = Math.min(nx - 1, Math.max(0, ((i + 0.5) * nx) / toNx - 0.5));
      const i0 = Math.min(nx - 2, Math.floor(fx));
      const tx = fx - i0;
      const k = j0 * nx + i0;
      out[j * toNx + i] =
        (src[k] * (1 - tx) + src[k + 1] * tx) * (1 - ty) + (src[k + nx] * (1 - tx) + src[k + nx + 1] * tx) * ty;
    }
  }
  return out;
}
