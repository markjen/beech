// Re-render the isometric share-snapshot samples in docs/:
//   docs/shore-iso-sample.png      (ocean view: from the sea, looking in)
//   docs/shore-iso-land-sample.png (land view: from the land, looking out)
// The beach is a constructed player-like beach — a hut, a parasol, a
// sandcastle with a moat, shells and rocks scattered about, sculpted sand —
// with two realistic public neighbours, so the samples show what a real
// beach looks like in 3D, not a test fixture.
// Run: node --input-type=module -e "…" or via esbuild:
//   server/node_modules/.bin/esbuild server/scripts/render-iso-samples.ts \
//     --bundle --platform=node --format=esm --outfile=/tmp/render-iso-samples.mjs
//   node /tmp/render-iso-samples.mjs
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePng, renderIsoBeach, type IsoPanel, type SavedSand, type Thing } from '../src/beachImage.js';

const N = 64; // 64x64 cells at 0.5 m: a 32 m beach
const DX = 32 / N;

function blank(): SavedSand {
  return { nx: N, ny: N, delta: new Float32Array(N * N), things: [] };
}

function mound(s: SavedSand, cx: number, cy: number, h: number, r: number): void {
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * DX;
      const y = (j + 0.5) * DX;
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d < 1) s.delta[j * N + i] += h * (1 - d);
    }
}

function dig(s: SavedSand, cx: number, cy: number, rx: number, ry: number, d: number): void {
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) * DX;
      const y = (j + 0.5) * DX;
      const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (e < 1) s.delta[j * N + i] -= d * (1 - e);
    }
}

function thing(kind: string, x: number, y: number, size = 1, variant = 0, item = ''): Thing {
  return { kind, item, x, y, angle: 0, size, variant };
}

/** a beach someone actually built: a hut and a parasol, a sandcastle in a moat, shells and rocks about */
function centreBeach(): SavedSand {
  const s = blank();
  mound(s, 10, 24, 0.5, 4);
  mound(s, 24, 27, 0.4, 3.5);
  dig(s, 16, 22, 3, 2, 0.3); // the moat around the castle
  mound(s, 16, 22, 0.35, 1.2); // the castle's mound
  s.things = [
    thing('beachhut', 8, 25, 1.2),
    thing('parasol', 12, 21, 1),
    thing('deckchair', 13.5, 22.5, 0.9),
    thing('sandcastle', 16, 22, 1.3),
    thing('flag', 20, 26, 0.8, 1),
    thing('shell', 5, 18, 0.6, 0),
    thing('shell', 7, 27, 0.5, 2),
    thing('shell', 19, 18, 0.7, 1),
    thing('shell', 26, 21, 0.5, 3),
    thing('shell', 11, 29, 0.6, 4),
    thing('conch', 27, 24, 0.8, 0),
    thing('starfish', 6, 19, 0.7, 0),
    thing('starfish', 25, 19, 0.6, 1),
    thing('rock', 4, 14, 1.1, 1),
    thing('rock', 28, 16, 0.8, 4),
    thing('rock', 22, 29, 0.7, 0),
    thing('driftwood', 24, 18, 1, 0),
    thing('seaglass', 10, 18, 0.5, 1),
    thing('sanddollar', 18, 26, 0.7, 0),
    thing('nautilus', 21, 20, 0.7, 0),
  ];
  return s;
}

/** the walk-left neighbour (linked, flush): a palm, a towel, a bucket and ball — only its first 4 m show, so the palm and a shell sit in the sliver */
function leftBeach(): SavedSand {
  const s = blank();
  mound(s, 8, 26, 0.4, 3);
  s.things = [
    thing('palmtree', 2, 23, 1.1),
    thing('towel', 10, 20, 1),
    thing('bucket', 11, 22, 0.8, 0),
    thing('beachball', 12.5, 21, 0.7, 0),
    thing('shell', 3, 25, 0.6, 1),
    thing('shell', 8, 18, 0.5, 3),
    thing('rock', 3, 17, 0.9, 2),
    thing('starfish', 12, 27, 0.6, 0),
  ];
  return s;
}

/** the walk-right neighbour (unlinked, 1.6 m gap): a lifeguard tower and a bonfire — only the 4 m nearest the centre beach show (local x 28..32), so a shell, a rock and the hammock sit in the sliver */
function rightBeach(): SavedSand {
  const s = blank();
  mound(s, 25, 26, 0.4, 3);
  s.things = [
    thing('lifeguardtower', 26, 24, 1.1),
    thing('bonfire', 24, 22, 0.9),
    thing('hammock', 31, 25, 1),
    thing('coconut', 22, 19, 0.7, 0),
    thing('coral', 27, 18, 0.8, 1),
    thing('shell', 23, 26, 0.6, 0),
    thing('shell', 29, 20, 0.5, 2),
    thing('rock', 30, 17, 0.8, 3),
  ];
  return s;
}

const centre: IsoPanel = { sand: centreBeach(), location: 'bondi', linked: false };
const left: IsoPanel = { sand: leftBeach(), location: 'waikiki', linked: true };
const right: IsoPanel = { sand: rightBeach(), location: 'santamonica', linked: false };

const root = process.cwd(); // run from the repo root
for (const [dir, file] of [
  ['ocean', 'docs/shore-iso-sample.png'],
  ['land', 'docs/shore-iso-land-sample.png'],
] as const) {
  const rgb = renderIsoBeach(centre, left, right, { width: 1200, height: 630 }, dir);
  writeFileSync(resolve(root, file), encodePng(rgb, 1200, 630));
  console.log(`wrote ${file}`);
}
