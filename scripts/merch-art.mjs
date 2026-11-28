// Draws the merch store's brand print files (docs/MERCH_STORE.md) into
// public/merch/, at the sizes server/src/merchCatalog.ts's ART_SIZES says.
// Printful fetches them from store.beech.games/merch-art/<file>.
//
//   node scripts/merch-art.mjs
//
// The look (review rounds, 2026-11-28): minimal, one-colour line drawings
// over full pictures, the beach straight from above or straight from the
// side (never slanted), muted colours. The sample beach's top-view prints
// (sample-square.png, sample-flat.png) come from scripts/merch-sample.mts.
// Commit the PNGs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'merch');
fs.mkdirSync(out, { recursive: true });

const INK = '#2f3e4a';
const LIGHT = '#f3ede3';
const FONT = `<style>@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&display=block');</style>`;
const svg = (w, h, body, viewBox = `0 0 ${w} ${h}`) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">${FONT}${body}</svg>`;
const word = (ink, x, y, size, anchor = 'middle') => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Fraunces, Georgia, serif" font-weight="600" font-size="${size}" fill="${ink}">beech</text>`;

// muted colours: a little toward gray, a little toward white (as server/src/merchPrint.ts mutes the beach)
const mute = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  return '#' + c.map((v) => Math.round((v * 0.7 + l * 0.3) * 0.88 + 255 * 0.12).toString(16).padStart(2, '0')).join('');
};

// ------------------------------------------------------------------ line drawings, one colour
const L = (d, w = 6, ink = INK) => `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const palm = (x, g, s = 1) => `<g transform="translate(${x} ${g}) scale(${s})">${L('M0 0 C -4 -60 8 -130 40 -190')}${L('M40 -190 Q 0 -215 -50 -185')}${L('M40 -190 Q 20 -235 -15 -240')}${L('M40 -190 Q 70 -235 105 -225')}${L('M40 -190 Q 90 -200 115 -160')}${L('M40 -190 Q 70 -170 75 -130')}<circle cx="34" cy="-178" r="8" fill="none" stroke="${INK}" stroke-width="5"/></g>`;
const crab = (x, g, s = 1, w = 5) => `<g transform="translate(${x} ${g}) scale(${s})">${L('M-44 -18 Q 0 -64 44 -18 Z', w + 1)}${L('M-30 -20 L-44 0 M-16 -20 L-24 0 M16 -20 L24 0 M30 -20 L44 0', w)}${L('M-34 -34 L-52 -56 M34 -34 L52 -56', w)}${L('M-62 -62 q 10 -16 22 -2 q -12 4 -22 2 Z M62 -62 q -10 -16 -22 -2 q 12 4 22 2 Z', w)}${L('M-12 -46 L-14 -64 M12 -46 L14 -64', w - 1)}<circle cx="-14" cy="-68" r="${w}" fill="${INK}"/><circle cx="14" cy="-68" r="${w}" fill="${INK}"/></g>`;
const parasol = (x, g) => `<g transform="translate(${x} ${g})">${L('M0 0 L0 -150')}${L('M-80 -120 Q 0 -190 80 -120 Z')}${L('M-80 -120 Q -40 -110 -27 -128 Q 0 -112 27 -128 Q 40 -110 80 -120', 5)}</g>`;
const castle = (x, g) => `<g transform="translate(${x} ${g})">${L('M-50 0 L-50 -50 L-30 -50 L-30 -40 L-15 -40 L-15 -70 L15 -70 L15 -40 L30 -40 L30 -50 L50 -50 L50 0')}${L('M0 -70 L0 -100 L22 -92 L0 -84', 4)}${L('M-6 0 L-6 -18 Q0 -26 6 -18 L6 0', 4)}</g>`;
const hut = (x, g) => `<g transform="translate(${x} ${g})">${L('M-55 0 L-55 -90 L0 -130 L55 -90 L55 0')}${L('M-20 0 L-20 -50 L20 -50 L20 0', 5)}${L('M-55 -60 L55 -60', 3)}</g>`;
const lighthouse = (x, g) => `<g transform="translate(${x} ${g})">${L('M-34 0 L-20 -190 L20 -190 L34 0')}${L('M-30 -60 L30 -60 M-26 -120 L26 -120', 5)}${L('M-26 -190 L-26 -222 L26 -222 L26 -190 M-32 -222 L0 -248 L32 -222', 5)}${L('M-60 -206 L-36 -206 M36 -206 L60 -206', 4)}</g>`;
const boat = (x, y) => `<g transform="translate(${x} ${y})">${L('M-46 0 L46 0 L32 18 L-32 18 Z', 5)}${L('M0 0 L0 -80 L36 -10 Z M0 -70 L-30 -12 L0 -12', 5)}</g>`;
const waves = (x0, x1, y, w = 5) => { let d = `M${x0} ${y}`; for (let x = x0; x < x1; x += 60) d += ' q 15 -14 30 0 t 30 0'; return L(d, w); };

// the line mark: the beach from the side in a rounded square
const markSquare = (ink, x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round">
  <rect x="0" y="0" width="400" height="400" rx="72" stroke-width="18"/><circle cx="282" cy="122" r="44" stroke-width="16"/>
  <path d="M60 222 q 23 -20 46 0 t 46 0 t 46 0 t 46 0 t 46 0 t 46 0" stroke-width="16"/>
  <path d="M40 262 L360 262" stroke-width="18"/><path d="M70 306 L330 306" stroke-width="12"/><path d="M110 344 L290 344" stroke-width="9"/></g>`;

// the side view in muted colours: sky, the sea on the right, a level ground line, sand in layers, a palm and a crab
const sideScene = () => {
  const g = 540;
  const layers = ['#efd2a8', '#d8b088', '#e6c49d', '#c89f7a', '#e2c197', '#b98f6c', '#d4ad86'].map(mute);
  let y = g, strata = '';
  layers.forEach((c, i) => { const h = 56 + (i % 3) * 14; strata += `<rect x="0" y="${y}" width="1000" height="${h}" fill="${c}"/>`; y += h; });
  strata += `<rect x="0" y="${y}" width="1000" height="${1000 - y}" fill="${mute('#8a97a8')}"/>`;
  const green = mute('#3f9b5a'), green2 = mute('#5cb874'), red = mute('#e8604a'), red2 = mute('#c4483a'), trunk = mute('#8a6b4a');
  const fronds = [[-150, 40], [-110, -10], [-60, -40], [10, -46], [70, -24], [120, 20], [150, 70]]
    .map(([dx, dy]) => `<path d="M0 0 Q ${dx * 0.5} ${dy - 40} ${dx} ${dy}" fill="none" stroke="${green}" stroke-width="30" stroke-linecap="round"/><path d="M0 0 Q ${dx * 0.5} ${dy - 40} ${dx} ${dy}" fill="none" stroke="${green2}" stroke-width="10" stroke-linecap="round"/>`).join('');
  return `<rect width="1000" height="1000" fill="${mute('#eef5f3')}"/><circle cx="790" cy="170" r="70" fill="${mute('#f7dd9a')}"/>
  <rect x="620" y="452" width="380" height="${g - 452}" fill="${mute('#7fc6d2')}"/>
  <path d="M620 452 q 24 -16 48 0 t 48 0 t 48 0 t 48 0 t 48 0 t 48 0 t 48 0 t 48 0" fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/>
  <rect x="0" y="${g - 18}" width="1000" height="18" fill="${mute('#f6e3c3')}"/>${strata}
  <line x1="0" y1="${g}" x2="1000" y2="${g}" stroke="${INK}" stroke-width="8"/>
  <ellipse cx="300" cy="${g + 130}" rx="26" ry="18" fill="${mute('#f7ead8')}" stroke="${mute('#b98f6c')}" stroke-width="4"/>
  <ellipse cx="640" cy="${g + 250}" rx="36" ry="14" fill="${mute('#9aa5ae')}"/>
  <path d="M240 ${g} C 236 420 250 330 286 238" fill="none" stroke="${trunk}" stroke-width="30" stroke-linecap="round"/>
  <g transform="translate(286 238)">${fronds}<circle cx="-10" cy="16" r="15" fill="${mute('#7a5a3a')}"/><circle cx="16" cy="20" r="15" fill="${mute('#6e5238')}"/></g>
  <g transform="translate(470 ${g})">
    ${[-48, -28, 28, 48].map((x) => `<path d="M${x * 0.6} -26 L${x} -6 L${x * 1.15} 0" fill="none" stroke="${red2}" stroke-width="8" stroke-linecap="round"/>`).join('')}
    <path d="M-52 -26 Q 0 -78 52 -26 Z" fill="${red}"/><path d="M-40 -40 L-62 -64 M40 -40 L62 -64" stroke="${red2}" stroke-width="10" stroke-linecap="round"/>
    <ellipse cx="-70" cy="-76" rx="20" ry="16" fill="${red}"/><ellipse cx="70" cy="-76" rx="20" ry="16" fill="${red}"/>
    <path d="M-16 -58 L-18 -82 M16 -58 L18 -82" stroke="${red2}" stroke-width="6"/>
    <circle cx="-18" cy="-86" r="8" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="18" cy="-86" r="8" fill="#fff" stroke="${INK}" stroke-width="3"/>
    <circle cx="-17" cy="-86" r="3.5" fill="${INK}"/><circle cx="19" cy="-86" r="3.5" fill="${INK}"/></g>`;
};

// the badge: two thin rings, "beech games" centred between them (the letters' middle, not their baseline), a line drawing inside
const badgeFont = 104, mid = (470 + 330) / 2, rb = mid - 0.25 * badgeFont;
const badge = svg(1650, 1650, `<defs><path id="arc" d="M ${500 - rb} 500 A ${rb} ${rb} 0 0 1 ${500 + rb} 500"/><clipPath id="c"><circle cx="500" cy="500" r="318"/></clipPath></defs>
  <circle cx="500" cy="500" r="470" fill="none" stroke="${INK}" stroke-width="8"/><circle cx="500" cy="500" r="330" fill="none" stroke="${INK}" stroke-width="6"/>
  <text font-family="Fraunces, Georgia, serif" font-weight="600" font-size="${badgeFont}" fill="${INK}" letter-spacing="4"><textPath href="#arc" startOffset="50%" text-anchor="middle">beech games</textPath></text>
  ${L(`M${500 - 60} ${500 + mid} q 15 -14 30 0 t 30 0 t 30 0 t 30 0`, 6)}
  <g clip-path="url(#c)">${L('M170 600 L830 600')}${L('M170 650 L830 650', 4)}${L('M170 690 L830 690', 3)}<circle cx="640" cy="330" r="40" fill="none" stroke="${INK}" stroke-width="6"/>${palm(360, 600, 1.05)}${crab(560, 600, 0.9)}${waves(650, 830, 576)}</g>`, '0 0 1000 1000');

// the wrap: a panorama whose two ends meet on plain sand, for the bottle, the tumbler and the mug
const G = 520;
const wrap = svg(3000, 760, `${L(`M0 ${G} L3000 ${G}`)}${L(`M0 ${G + 60} L3000 ${G + 60}`, 4)}${L(`M0 ${G + 110} L3000 ${G + 110}`, 3)}
  <circle cx="420" cy="170" r="54" fill="none" stroke="${INK}" stroke-width="6"/>
  ${palm(220, G)}${hut(560, G)}${parasol(860, G)}${castle(1080, G)}${crab(1280, G)}${waves(1420, 2080, G - 26)}${waves(1480, 2020, G - 70)}${boat(1760, G - 120)}
  ${lighthouse(2260, G)}${palm(2560, G, 0.9)}${crab(2800, G, 0.8)}
  <ellipse cx="700" cy="${G + 85}" rx="18" ry="10" fill="none" stroke="${INK}" stroke-width="4"/><ellipse cx="2400" cy="${G + 85}" rx="14" ry="8" fill="none" stroke="${INK}" stroke-width="4"/>`);

// the sea and the sand, muted, for the towel, flip flops, tote and socks: a small "beech", no logo block
const SEA = '#86c2cb', SEA2 = '#74b2bd', SEA3 = '#a9d6da', SAND = '#f1e2c8', WET = '#e6d3b3';
const swell = (w, y, amp, len, c, sw) => { let d = `M0 ${y}`; for (let x = 0; x < w; x += len) d += ` q ${len / 4} ${-amp} ${len / 2} 0 t ${len / 2} 0`; return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`; };
const shore = (w, h, seaH, wordY, wordSize) => {
  const k = w / 1000;
  const edge = `M0 ${seaH} C ${200 * k} ${seaH + 60 * k} ${400 * k} ${seaH - 40 * k} ${600 * k} ${seaH + 10 * k} S ${900 * k} ${seaH - 20 * k} ${w} ${seaH + 20 * k}`;
  return `<rect width="${w}" height="${h}" fill="${SAND}"/><rect width="${w}" height="${seaH + 40 * k}" fill="${SEA}"/>
    ${swell(w, seaH * 0.3, 18 * k, 180 * k, SEA2, 12 * k)}${swell(w, seaH * 0.6, 18 * k, 180 * k, SEA3, 10 * k)}
    <path d="${edge} L ${w} ${seaH + 120 * k} L 0 ${seaH + 120 * k} Z" fill="${WET}"/>
    <path d="${edge} L ${w} ${h} L 0 ${h} Z" transform="translate(0 ${30 * k})" fill="${SAND}"/>
    <path d="${edge}" fill="none" stroke="#ffffff" stroke-width="${14 * k}" stroke-linecap="round"/>
    ${word(INK, w / 2, wordY, wordSize)}`;
};

const art = {
  'mark.png': [900, 800, markSquare(INK, 250, 40, 1) + word(INK, 450, 730, 220)],
  'mark-light.png': [900, 800, markSquare(LIGHT, 250, 40, 1) + word(LIGHT, 450, 730, 220)],
  'word.png': [900, 300, word(INK, 450, 225, 240)],
  'crab.png': [600, 420, crab(300, 380, 3.2, 6)],
  'mark-wide.png': [1650, 600, markSquare(INK, 70, 70, 1.15) + word(INK, 640, 400, 300, 'start')],
  'mark-wide-light.png': [1650, 600, markSquare(LIGHT, 70, 70, 1.15) + word(LIGHT, 640, 400, 300, 'start')],
  'side-square.png': [1200, 1200, `<g transform="scale(1.2)">${sideScene()}</g>`],
  'badge.png': [1650, 1650, null, badge],
  'wrap.png': [3000, 760, null, wrap],
  'towel.png': [9300, 4800, shore(9300, 4800, 1700, 4500, 420)],
  'flipflops.png': [1650, 1950, shore(1650, 1950, 560, 1820, 130)],
  'tote.png': [2550, 2475, shore(2550, 2475, 800, 2250, 200)],
  'socks.png': [1348, 5657, shore(1348, 5657, 1500, 5300, 150)],
};

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [file, [w, h, body, whole]] of Object.entries(art)) {
  const s = whole ?? svg(w, h, body);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${s.replace(/width="\d+" height="\d+" viewBox/, `width="${w}" height="${h}" viewBox`)}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, file), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(file, `${w}x${h}`, `${Math.round(fs.statSync(path.join(out, file)).size / 1024)} KB`);
}
await browser.close();
