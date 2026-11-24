// 3D isometric share snapshot — server/src/beachImage.ts renderIsoBeach/beachIsoPng.
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  beachIsoPng,
  decodeSavedBeach,
  isoScreenPoint,
  renderIsoBeach,
  type IsoPanel,
  type SavedSand,
} from '../src/beachImage.js';

const W = 1200;
const H = 630;

/** a saved beach: flat rest profile with one conical mound at local (cx, cy) cells */
function moundSand(cx: number, cy: number, height: number, r = 6, nx = 64): SavedSand {
  const delta = new Float32Array(nx * nx);
  for (let j = cy - r; j <= cy + r; j++)
    for (let i = cx - r; i <= cx + r; i++) {
      if (i < 0 || j < 0 || i >= nx || j >= nx) continue;
      const d = Math.hypot(i - cx, j - cy) / r;
      if (d < 1) delta[j * nx + i] = height * (1 - d);
    }
  return { nx, ny: nx, delta, things: [] };
}

const flat: SavedSand = { nx: 64, ny: 64, delta: new Float32Array(64 * 64), things: [] };
const centerPanel: IsoPanel = { sand: moundSand(32, 48, 1.2), location: 'bondi', linked: false };
// A mound on the dry sand of each neighbour: local cell (32, 48) = (16 m, 24 m).
const leftPanel: IsoPanel = { sand: moundSand(32, 48, 1.2), location: 'waikiki', linked: true };
const rightPanel: IsoPanel = { sand: moundSand(32, 48, 1.2), location: 'piha', linked: false };

function px(buf: Uint8Array, x: number, y: number): [number, number, number] {
  const i = (y * W + x) * 3;
  return [buf[i], buf[i + 1], buf[i + 2]];
}

function patchDiff(a: Uint8Array, b: Uint8Array, cx: number, cy: number, r = 8): number {
  let max = 0;
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      const pa = px(a, x, y);
      const pb = px(b, x, y);
      max = Math.max(max, Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]));
    }
  return max;
}

describe('renderIsoBeach', () => {
  it('renders 1200x630 RGB deterministically', () => {
    const a = renderIsoBeach(centerPanel, leftPanel, rightPanel, { width: W, height: H });
    const b = renderIsoBeach(centerPanel, leftPanel, rightPanel, { width: W, height: H });
    expect(a.length).toBe(W * H * 3);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('puts each neighbour on its own side and leaves the centre untouched', () => {
    const solo = renderIsoBeach(centerPanel, null, null, { width: W, height: H });
    const withLeft = renderIsoBeach(centerPanel, leftPanel, null, { width: W, height: H });
    const withRight = renderIsoBeach(centerPanel, null, rightPanel, { width: W, height: H });
    // Mound peaks: the left neighbour sits flush at +32 m, the right one
    // keeps its 1.6 m gap at -(32 + 1.6) m. The height at a peak is the
    // rest profile (~0.85 m at 24 m inland) plus the mound (1.2 m).
    const [lx, ly] = isoScreenPoint(W, H, 32 + 16, 24, 0.85 + 1.2).map(Math.round);
    const [rx, ry] = isoScreenPoint(W, H, -(32 + 1.6) + 16, 24, 0.85 + 1.2).map(Math.round);
    const [cx, cy] = isoScreenPoint(W, H, 16, 24, 0.85 + 1.2).map(Math.round);
    // A neighbour's mound changes the pixels where it stands…
    expect(patchDiff(withLeft, solo, lx, ly)).toBeGreaterThan(30);
    expect(patchDiff(withRight, solo, rx, ry)).toBeGreaterThan(30);
    // …and nowhere on the other side or the centre beach.
    expect(patchDiff(withRight, solo, lx, ly)).toBe(0);
    expect(patchDiff(withLeft, solo, rx, ry)).toBe(0);
    expect(patchDiff(withLeft, solo, cx, cy)).toBe(0);
    expect(patchDiff(withRight, solo, cx, cy)).toBe(0);
  });

  it('renders untouched shore with no neighbours', () => {
    const solo = renderIsoBeach(centerPanel, null, null, { width: W, height: H });
    const blank = renderIsoBeach({ sand: null, location: 'bondi' }, null, null, { width: W, height: H });
    // The centre mound is still there, but the flanks are untouched.
    const [cx, cy] = isoScreenPoint(W, H, 16, 24, 0.85 + 1.2).map(Math.round);
    expect(patchDiff(solo, blank, cx, cy)).toBeGreaterThan(30);
  });

  it('renders in well under a second', () => {
    const t0 = Date.now();
    renderIsoBeach(centerPanel, leftPanel, rightPanel, { width: W, height: H });
    expect(Date.now() - t0).toBeLessThan(800);
  });
});

describe('beachIsoPng', () => {
  function bch1(sand: SavedSand): Uint8Array {
    const nx = sand.nx;
    const ny = sand.ny;
    const body = new Uint8Array(4 + 1 + 2 + 2 + nx * ny * 2);
    const dv = new DataView(body.buffer);
    dv.setUint32(0, 0x42434831); // "BCH1"
    body[4] = 1; // BCH1 version
    dv.setUint16(5, nx, false);
    dv.setUint16(7, ny, false);
    for (let i = 0; i < nx * ny; i++) dv.setInt16(9 + i * 2, Math.round(sand.delta[i] * 100), false);
    return deflateSync(body);
  }

  it('encodes a 1200x630 PNG deterministically, even from broken bytes', () => {
    const a = beachIsoPng({ bytes: bch1(centerPanel.sand!), location: 'bondi' }, leftPanel, rightPanel, {
      width: W,
      height: H,
    });
    const b = beachIsoPng({ bytes: bch1(centerPanel.sand!), location: 'bondi' }, leftPanel, rightPanel, {
      width: W,
      height: H,
    });
    expect(a.equals(b)).toBe(true);
    expect(a.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    const dv = new DataView(a.buffer, a.byteOffset);
    expect(dv.getUint32(16, false)).toBe(1200);
    expect(dv.getUint32(20, false)).toBe(630);
    const broken = beachIsoPng({ bytes: Buffer.from('not a beach'), location: 'bondi' }, null, null, {
      width: W,
      height: H,
    });
    expect(broken.length).toBeGreaterThan(0);
    expect(() => decodeSavedBeach(Buffer.from('not a beach'))).toThrow('not a saved beach');
  });
});
