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

const MAGIC = [0x42, 0x43, 0x48, 0x31]; // "BCH1"
const MM = 1000;

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeSand(delta: Float32Array, nx: number, ny: number): Promise<Uint8Array> {
  if (delta.length !== nx * ny) throw new Error('size mismatch');
  const q = new Int16Array(nx * ny);
  for (let k = 0; k < q.length; k++) {
    const v = Math.round(delta[k] * MM);
    q[k] = v > 32767 ? 32767 : v < -32767 ? -32767 : v;
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

export async function decodeSand(bytes: Uint8Array): Promise<{ nx: number; ny: number; delta: Float32Array }> {
  if (bytes.length < 8 || MAGIC.some((m, i) => bytes[i] !== m)) throw new Error('not a saved beach');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nx = dv.getUint16(4, true);
  const ny = dv.getUint16(6, true);
  const raw = await pipe(bytes.subarray(8), new DecompressionStream('deflate'));
  if (raw.byteLength !== nx * ny * 2) throw new Error('corrupt saved beach');
  const q = new Int16Array(raw.buffer, raw.byteOffset, nx * ny);
  const delta = new Float32Array(nx * ny);
  for (let k = 0; k < delta.length; k++) delta[k] = q[k] / MM;
  return { nx, ny, delta };
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
