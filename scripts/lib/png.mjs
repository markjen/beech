// A small PNG reader for heightmaps: 8- or 16-bit, grey, grey+alpha, RGB or
// RGBA, not interlaced (what image editors write by default). Returns one
// brightness value per pixel, 0..1. No dependencies (node:zlib only).
import { inflateSync } from 'node:zlib';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** @returns {{ width: number, height: number, value: Float64Array }} row 0 is the top of the image */
export function readPng(buf) {
  if (buf.length < 8 || SIGNATURE.some((b, i) => buf[i] !== b)) throw new Error('not a PNG file');
  let p = 8;
  let ihdr = null;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!ihdr) throw new Error('PNG has no header');
  const { width, height, depth, color, interlace } = ihdr;
  const ch = CHANNELS[color];
  if (!ch) throw new Error('palette PNGs are not supported: save it as greyscale or RGB');
  if (depth !== 8 && depth !== 16) throw new Error(`${depth}-bit PNGs are not supported: save it as 8- or 16-bit`);
  if (interlace) throw new Error('interlaced PNGs are not supported: save it without interlacing');
  const bpp = (ch * depth) / 8; // bytes per pixel
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) throw new Error('PNG data is too short');
  const img = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = img.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? img.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (f !== 0) throw new Error(`bad PNG filter ${f}`);
      out[x] = v & 255;
    }
  }
  const max = depth === 16 ? 65535 : 255;
  const sample = (o) => (depth === 16 ? img.readUInt16BE(o) : img[o]);
  const value = new Float64Array(width * height);
  for (let k = 0; k < width * height; k++) {
    const o = k * bpp;
    // colour images: brightness (Rec. 709 luma); alpha is ignored
    value[k] =
      ch >= 3
        ? (0.2126 * sample(o) + 0.7152 * sample(o + depth / 8) + 0.0722 * sample(o + (2 * depth) / 8)) / max
        : sample(o) / max;
  }
  return { width, height, value };
}
