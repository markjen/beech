import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs helper of the offline tool
import { readPng } from '../scripts/lib/png.mjs';

/** Encode an 8-bit image, each row with the given PNG filter (0-4). */
function png(w: number, h: number, ch: 1 | 3, px: (x: number, y: number, c: number) => number, filters: number[]): Buffer {
  const raw = (y: number) => Buffer.from(Array.from({ length: w * ch }, (_, k) => px(Math.floor(k / ch), y, k % ch)));
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const cur = raw(y);
    const prev = y ? raw(y - 1) : Buffer.alloc(w * ch);
    const f = filters[y % filters.length];
    const out = Buffer.alloc(w * ch + 1);
    out[0] = f;
    for (let x = 0; x < w * ch; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      const p = a + b - c;
      const pred = [0, a, b, (a + b) >> 1, Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c][f];
      out[x + 1] = (cur[x] - pred) & 255;
    }
    rows.push(out);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]); // the reader doesn't check CRCs
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = ch === 1 ? 0 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

describe('the heightmap PNG reader', () => {
  it('undoes every row filter (grey)', () => {
    const v = (x: number, y: number) => (x * 37 + y * 11 + ((x * y) % 7) * 23) & 255;
    const { width, height, value } = readPng(png(9, 10, 1, v, [0, 1, 2, 3, 4]));
    expect([width, height]).toEqual([9, 10]);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) expect(value[y * 9 + x]).toBeCloseTo(v(x, y) / 255, 9);
  });
  it('reads RGB as brightness', () => {
    const { value } = readPng(png(8, 8, 3, (_x, _y, c) => (c === 1 ? 255 : 0), [4, 1]));
    expect(value[0]).toBeCloseTo(0.7152, 4); // pure green
  });
  it('refuses what it can not read', () => {
    expect(() => readPng(Buffer.from('nope'))).toThrow(/not a PNG/);
  });
});
