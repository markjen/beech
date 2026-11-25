// A saved beach as the app writes it (BCH2), for tests that save one: the
// server reads every save (it counts the things on it itself and refuses
// anything that isn't a beach), so placeholder bytes no longer do.
import { deflateSync } from 'node:zlib';

export interface BlobObject {
  item: string;
  [k: string]: unknown;
}

/** sand filled with `fill` mm on an n x n grid, plus `objects` */
export function beachBlob(objects: BlobObject[] = [], fill = 0, n = 256): Uint8Array {
  const q = new Int16Array(n * n).fill(fill);
  const sand = deflateSync(Buffer.from(q.buffer));
  const objs = deflateSync(
    Buffer.from(JSON.stringify(objects.map((o, i) => ({ id: i + 1, kind: 'rock', x: 5, y: 20, angle: 0, size: 0.3, variant: 1, ...o })))),
  );
  const out = new Uint8Array(12 + sand.length + objs.length);
  out.set(Buffer.from('BCH2', 'latin1'), 0);
  const dv = new DataView(out.buffer);
  dv.setUint16(4, n, true);
  dv.setUint16(6, n, true);
  dv.setUint32(8, sand.length, true);
  out.set(sand, 12);
  out.set(objs, 12 + sand.length);
  return out;
}
