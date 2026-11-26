// 3D isometric share snapshots — server/src/beachImage.ts renderIsoBeach/beachIsoPng,
// and the flat card's edge-to-edge framing (server/src/beachImage.ts renderBeach).
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  PIER,
  beachIsoPng,
  decodeSavedBeach,
  isoScreenPoint,
  renderBeach,
  renderIsoBeach,
  restHeight,
  type IsoDir,
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
// A mound on the dry sand of each neighbour, inside the sliver the frame
// shows: the left neighbour's first 4 m (local cell 4 = 2 m in) and the
// right neighbour's 4 m nearest the centre beach (local cell 60 = 30 m in).
// The left neighbour sits flush at +32 m, the right one keeps its 1.6 m gap.
const leftMound: IsoPanel = { sand: moundSand(4, 48, 1.2), location: 'waikiki', linked: true };
const leftFlat: IsoPanel = { sand: flat, location: 'waikiki', linked: true };
const rightMound: IsoPanel = { sand: moundSand(60, 48, 1.2), location: 'piha', linked: false };
const rightFlat: IsoPanel = { sand: flat, location: 'piha', linked: false };

function px(buf: Uint8Array, x: number, y: number): [number, number, number] {
  const i = (y * W + x) * 3;
  return [buf[i], buf[i + 1], buf[i + 2]];
}

function patchDiff(a: Uint8Array, b: Uint8Array, cx: number, cy: number, r = 8): number {
  let max = 0;
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const pa = px(a, x, y);
      const pb = px(b, x, y);
      max = Math.max(max, Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]));
    }
  return max;
}

/** biggest pixel difference between two renders, and where it is */
function maxDiff(a: Uint8Array, b: Uint8Array): { d: number; x: number; y: number } {
  let best = { d: 0, x: 0, y: 0 };
  for (let y = 0; y < H; y += 2)
    for (let x = 0; x < W; x += 2) {
      const pa = px(a, x, y);
      const pb = px(b, x, y);
      const d = Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]);
      if (d > best.d) best = { d, x, y };
    }
  return best;
}

describe('renderIsoBeach', () => {
  it.each(['ocean', 'land'] as IsoDir[])('renders 1200x630 RGB deterministically (%s)', (dir) => {
    const a = renderIsoBeach(centerPanel, leftMound, rightMound, { width: W, height: H }, dir);
    const b = renderIsoBeach(centerPanel, leftMound, rightMound, { width: W, height: H }, dir);
    expect(a.length).toBe(W * H * 3);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('puts each neighbour on its own side from the sea, and mirrors them from the land', () => {
    // Compare a neighbour with a mound against the same neighbour flat: the
    // frame is identical, so only the mound can change the pixels. The
    // mound's shaded flank sits off its peak, so take the biggest difference
    // anywhere and check it is on the right side.
    const moundH = 0.85 + 1.2; // rest profile at 24 m inland plus the mound
    for (const dir of ['ocean', 'land'] as IsoDir[]) {
      const withLeft = renderIsoBeach(centerPanel, leftMound, null, { width: W, height: H }, dir);
      const flatLeft = renderIsoBeach(centerPanel, leftFlat, null, { width: W, height: H }, dir);
      const withRight = renderIsoBeach(centerPanel, null, rightMound, { width: W, height: H }, dir);
      const flatRight = renderIsoBeach(centerPanel, null, rightFlat, { width: W, height: H }, dir);
      // The frame with one neighbour: centre 0..32, left 32..64 or right -33.6..-1.6.
      // The mounds sit in the sliver the frame shows (left local 2 m, right local 30 m).
      const [lx] = isoScreenPoint(W, H, dir, 32 + 2, 24, moundH, 0, 64);
      const [rx] = isoScreenPoint(W, H, dir, -(32 + 1.6) + 30, 24, moundH, -(32 + 1.6), 32);
      const dl = maxDiff(withLeft, flatLeft);
      const dr = maxDiff(withRight, flatRight);
      expect(dl.d).toBeGreaterThan(30);
      expect(dr.d).toBeGreaterThan(30);
      // From the sea the walk-left neighbour is on the picture's left; from
      // the land it is on the right (and the right neighbour mirrors too).
      if (dir === 'ocean') {
        expect(lx).toBeLessThan(W / 2);
        expect(dl.x).toBeLessThan(W / 2);
        expect(rx).toBeGreaterThan(W / 2);
        expect(dr.x).toBeGreaterThan(W / 2);
      } else {
        expect(lx).toBeGreaterThan(W / 2);
        expect(dl.x).toBeGreaterThan(W / 2);
        expect(rx).toBeLessThan(W / 2);
        expect(dr.x).toBeLessThan(W / 2);
      }
      // A neighbour's mound leaves the centre beach untouched.
      const [cxl, cyl] = isoScreenPoint(W, H, dir, 16, 24, moundH, 0, 64).map(Math.round);
      const [cxr, cyr] = isoScreenPoint(W, H, dir, 16, 24, moundH, -(32 + 1.6), 32).map(Math.round);
      expect(patchDiff(withLeft, flatLeft, cxl, cyl, 25)).toBe(0);
      expect(patchDiff(withRight, flatRight, cxr, cyr, 25)).toBe(0);
    }
  });

  it('fits the frame to exactly the beaches present, with no filler shore', () => {
    // Solo, the strip is 0..32: its corners touch the frame's edges.
    for (const dir of ['ocean', 'land'] as IsoDir[]) {
      const [seaX] = isoScreenPoint(W, H, dir, 0, 0, 0);
      const [backX] = isoScreenPoint(W, H, dir, 32, 32, 0);
      if (dir === 'ocean') {
        expect(seaX).toBeGreaterThan(W - 40);
        expect(backX).toBeLessThan(40);
      } else {
        expect(seaX).toBeLessThan(40);
        expect(backX).toBeGreaterThan(W - 40);
      }
    }
    // And a beach with no neighbours still renders its own mound.
    const solo = renderIsoBeach(centerPanel, null, null, { width: W, height: H }, 'ocean');
    const blank = renderIsoBeach({ sand: null, location: 'bondi' }, null, null, { width: W, height: H }, 'ocean');
    expect(maxDiff(solo, blank).d).toBeGreaterThan(30);
  });

  it('frames the centre beach big: with neighbours it spans a good part of the picture, and the far ends are cropped off', () => {
    // Before the crop the frame fitted the whole 96 m strip and the centre
    // beach was 286 px wide (24% of the picture); the 14 m slice made it
    // 403 px (34%); the 4 m sliver makes it 516 px (43%), and the far end
    // of a neighbour is off the frame instead of fitted.
    for (const dir of ['ocean', 'land'] as IsoDir[]) {
      const [x0] = isoScreenPoint(W, H, dir, 0, 16, 0, -(32 + 1.6), 64);
      const [x1] = isoScreenPoint(W, H, dir, 32, 16, 0, -(32 + 1.6), 64);
      expect(Math.abs(x1 - x0)).toBeGreaterThan(W * 0.4);
      const [fx] = isoScreenPoint(W, H, dir, 64, 16, 0, -(32 + 1.6), 64);
      expect(fx < 0 || fx > W).toBe(true);
    }
  });

  it('draws swell lines on the sea: the water varies, with bright foam streaks', () => {
    // Same sample points as the flat card's swell: open water, both
    // directions. Before the stronger foam the brightness sd was 6.2 and
    // the brightest sea pixel 143; now 15.1 and 179.
    for (const dir of ['ocean', 'land'] as IsoDir[]) {
      const img = renderIsoBeach(centerPanel, leftMound, rightMound, { width: W, height: H }, dir);
      const sea: number[] = [];
      for (let wx = -20; wx <= 50; wx += 2)
        for (let wy = 1; wy <= 6; wy += 1) {
          const [sx, sy] = isoScreenPoint(W, H, dir, wx, wy, 0, -(32 + 1.6), 64).map(Math.round);
          if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
          const [r, g, b] = px(img, sx, sy);
          sea.push((r + g + b) / 3);
        }
      const mean = sea.reduce((a, v) => a + v, 0) / sea.length;
      const sd = Math.sqrt(sea.reduce((a, v) => a + (v - mean) ** 2, 0) / sea.length);
      expect(sd).toBeGreaterThan(10);
      expect(Math.max(...sea)).toBeGreaterThan(160);
    }
  });

  it('gives even a black-sand neighbour texture: Piha reads as sand, not a slab', () => {
    // Flat dry sand on the Piha neighbour, away from its mound: before the
    // grain the (r+g+b) range across the patch was 60 (the rest profile's
    // bands were the only variation); now it is 121, while the sand stays
    // dark (mean brightness ~99), so the location tint is kept.
    const img = renderIsoBeach(centerPanel, leftMound, rightMound, { width: W, height: H }, 'ocean');
    const patch: number[] = [];
    let sum = 0;
    let n = 0;
    // The visible sliver of the Piha neighbour is local 29.6..32 m, so the
    // patch sits there (world -4..-2), on dry sand in two bands — wy 12..20
    // and wy 28..31 — clear of the mound at local 30 m / wy 21..27. The
    // bands together cover about the same area as the old 6x8 m patch, so
    // the slow grain has room to vary.
    for (let wx = -4; wx <= -2; wx += 0.5)
      for (const wy of [12, 13, 14, 15, 16, 17, 18, 19, 20, 28, 29, 30, 31]) {
        const [sx, sy] = isoScreenPoint(W, H, 'ocean', wx, wy, restHeight(wx + 33.6, wy), -(32 + 1.6), 64).map(Math.round);
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
        const [r, g, b] = px(img, sx, sy);
        patch.push(r + g + b);
        sum += (r + g + b) / 3;
        n++;
      }
    expect(Math.max(...patch) - Math.min(...patch)).toBeGreaterThan(90);
    expect(sum / n).toBeLessThan(130);
  });

  it('draws things at the ground scale, so the centrepiece reads: a sandcastle stands ~25 px tall', () => {
    const castle: SavedSand = {
      nx: 64,
      ny: 64,
      delta: new Float32Array(64 * 64),
      things: [{ kind: 'sandcastle', item: '', x: 16, y: 22, angle: 0, size: 1.3, variant: 0 }],
    };
    const bare: SavedSand = { nx: 64, ny: 64, delta: new Float32Array(64 * 64), things: [] };
    const withCastle = renderIsoBeach({ sand: castle, location: 'bondi', linked: false }, null, null, { width: W, height: H }, 'ocean');
    const without = renderIsoBeach({ sand: bare, location: 'bondi', linked: false }, null, null, { width: W, height: H }, 'ocean');
    const [bx, by] = isoScreenPoint(W, H, 'ocean', 16, 22, restHeight(16, 22), 0, 32).map(Math.round);
    let run = 0;
    let best = 0;
    for (let y = by - 70; y <= by + 5; y++) {
      if (y < 0 || y >= H) continue;
      const [r1, g1, b1] = px(withCastle, bx, y);
      const [r2, g2, b2] = px(without, bx, y);
      if (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) > 10) {
        run++;
        best = Math.max(best, run);
      } else {
        run = 0;
      }
    }
    expect(best).toBeGreaterThan(20);
  });

  it('renders in well under a second', () => {
    const t0 = Date.now();
    renderIsoBeach(centerPanel, leftMound, rightMound, { width: W, height: H }, 'ocean');
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

  it.each(['ocean', 'land'] as IsoDir[])('encodes a 1200x630 PNG deterministically (%s), even from broken bytes', (dir) => {
    const a = beachIsoPng({ bytes: bch1(centerPanel.sand!), location: 'bondi' }, leftMound, rightMound, { width: W, height: H }, dir);
    const b = beachIsoPng({ bytes: bch1(centerPanel.sand!), location: 'bondi' }, leftMound, rightMound, { width: W, height: H }, dir);
    expect(a.equals(b)).toBe(true);
    expect(a.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    const dv = new DataView(a.buffer, a.byteOffset);
    expect(dv.getUint32(16, false)).toBe(1200);
    expect(dv.getUint32(20, false)).toBe(630);
    const broken = beachIsoPng({ bytes: Buffer.from('not a beach'), location: 'bondi' }, null, null, { width: W, height: H }, dir);
    expect(broken.length).toBeGreaterThan(0);
    expect(() => decodeSavedBeach(Buffer.from('not a beach'))).toThrow('not a saved beach');
  });
});

describe('renderBeach without shoulders', () => {
  it('is exactly the beach edge to edge: things at the edges sit at the picture edges', () => {
    const rockAt = (x: number): SavedSand => ({
      nx: 64,
      ny: 64,
      delta: new Float32Array(64 * 64),
      things: [{ kind: 'rock', item: '', x, y: 24, angle: 0, size: 1, variant: 0 }],
    });
    const bare = renderBeach({ nx: 64, ny: 64, delta: new Float32Array(64 * 64), things: [] }, { width: W, height: H, location: 'bondi' });
    // A rock at the beach's left edge in the world (x 31.5, mirrored to the
    // picture's left) lands at px ~19, not ~124 where the old shoulders put it.
    const leftRock = renderBeach(rockAt(31.5), { width: W, height: H, location: 'bondi' });
    expect(patchDiff(leftRock, bare, 19, 384)).toBeGreaterThan(30);
    expect(patchDiff(leftRock, bare, 124, 384)).toBe(0);
    // …and a rock at the other edge lands at the picture's right edge.
    const rightRock = renderBeach(rockAt(0.5), { width: W, height: H, location: 'bondi' });
    expect(patchDiff(rightRock, bare, 1181, 384)).toBeGreaterThan(30);
    expect(patchDiff(rightRock, bare, 1076, 384)).toBe(0);
  });
});

describe('piers in the pictures (docs/PIERS.md)', () => {
  const deck: [number, number, number] = [0xa8, 0x92, 0x7a];
  const near = (c: [number, number, number], want: [number, number, number], tol: number) =>
    Math.abs(c[0] - want[0]) + Math.abs(c[1] - want[1]) + Math.abs(c[2] - want[2]) <= tol;

  it('the card shows the deck from above, over the water, only when the pier shows', () => {
    const plain = renderBeach(null, { width: W, height: H, location: 'bondi' });
    const pier = renderBeach(null, { width: W, height: H, location: 'bondi', pier: true });
    // the card spans y = 11.5..32 down the picture, the beach edge to edge across it
    const at = (y: number) => Math.round(((y - 11.5) / 20.5) * H);
    expect(near(px(pier, W / 2, at(14)), deck, 30)).toBe(true);
    expect(near(px(plain, W / 2, at(14)), deck, 30)).toBe(false);
    // away from it, nothing changes
    expect(px(pier, 100, at(14))).toEqual(px(plain, 100, at(14)));
  });

  it.each(['ocean', 'land'] as IsoDir[])('the 3D view stands the deck above the water, on its own beach (%s)', (dir) => {
    const one = (c: boolean, l: boolean) =>
      renderIsoBeach({ ...centerPanel, pier: c }, { ...leftFlat, pier: l }, null, { width: W, height: H, location: 'bondi' }, dir);
    const plain = one(false, false);
    const pier = one(true, false);
    const [x, y] = isoScreenPoint(W, H, dir, 16, 12, PIER.deckHeight, 0, 64).map(Math.round);
    expect(patchDiff(pier, plain, x, y, 2)).toBeGreaterThan(60);
    const [sx, sy] = isoScreenPoint(W, H, dir, 16, 12, 0, 0, 64).map(Math.round);
    // the water under the middle of the deck isn't covered by it
    expect(px(pier, sx, sy + (dir === 'ocean' ? 6 : 6))).toEqual(px(plain, sx, sy + 6));
    // the neighbour's pier stands on the neighbour (32 m along), not here
    const theirs = one(false, true);
    expect(patchDiff(theirs, plain, x, y, 2)).toBe(0);
    const [nx, ny] = isoScreenPoint(W, H, dir, 48, 12, PIER.deckHeight, 0, 64);
    const d = maxDiff(theirs, plain);
    expect(d.d).toBeGreaterThan(0);
    expect(Math.hypot(d.x - nx, d.y - ny)).toBeLessThan(Math.hypot(d.x - x, d.y - y));
  });
});
