// Draws the merch store's brand print files (docs/MERCH_STORE.md) into
// public/merch/: the logo for tees and hoodies (dark and light ink), the
// hat's embroidery, the towel and the flip flops. Printful fetches them
// from store.beech.games/merch-art/<file>.
//
//   node scripts/merch-art.mjs
//
// The beach block is the app icon's (public/icons/icon.svg) without its sky.
// Rerun after changing the icon; commit the PNGs.
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

const icon = fs.readFileSync(path.join(root, 'public', 'icons', 'icon.svg'), 'utf8');
// the block alone, in its own coordinates (x 192..832, y 300..840)
const inner = icon.slice(icon.indexOf('>', icon.indexOf('<g transform')) + 1, icon.lastIndexOf('</g></g>'));
const block = (x, y, w) => `<g transform="translate(${x},${y}) scale(${w / 640}) translate(-192,-300)">${inner}</g></g>`;
const FONT = `<style>@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&display=block');text{font-family:'Fraunces',Georgia,serif;font-weight:600}</style>`;
const svg = (w, h, body, bg = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${FONT}${bg}${body}</svg>`;

const INK = '#1d2d38';
const CREAM = '#fbf4e7';
const SEA = '#1a6f85';

// waves across a band, for the towel and flip flops
const waves = (w, y, amp, len, color, width) => {
  let d = `M0 ${y}`;
  for (let x = 0; x < w; x += len) d += ` q ${len / 4} ${-amp} ${len / 2} 0 t ${len / 2} 0`;
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`;
};

const art = {
  // tees and hoodies: 12″ × 12″ at 150 dpi, transparent
  'logo-front.png': svg(1800, 1800, `${block(300, 180, 1200)}<text x="900" y="1640" font-size="380" text-anchor="middle" fill="${INK}">beech</text>`),
  'logo-front-light.png': svg(1800, 1800, `${block(300, 180, 1200)}<text x="900" y="1640" font-size="380" text-anchor="middle" fill="${CREAM}">beech</text>`),
  // the hat: 4″ × 1.75″ embroidery, flat colours only
  'logo-hat.png': svg(1200, 525, `${block(40, 40, 520)}<text x="600" y="370" font-size="225" fill="${INK}">beech</text>`),
  'logo-hat-light.png': svg(1200, 525, `${block(40, 40, 520)}<text x="600" y="370" font-size="225" fill="${CREAM}">beech</text>`),
  // the towel: 30″ × 60″ at 100 dpi, edge to edge: sea at the top, the shore, sand
  'towel.png': svg(
    3000,
    6000,
    [
      `<rect width="3000" height="2300" fill="#2fa4bb"/>`,
      `<rect y="2300" width="3000" height="3700" fill="#f6e3c3"/>`,
      `<path d="M0 2150 C 600 2450 1200 2050 1800 2300 S 2700 2150 3000 2350 L 3000 2600 L 0 2600 Z" fill="#f6e3c3"/>`,
      `<path d="M0 2150 C 600 2450 1200 2050 1800 2300 S 2700 2150 3000 2350" fill="none" stroke="#fff" stroke-width="60" stroke-linecap="round"/>`,
      waves(3000, 600, 60, 500, '#45b6c9', 40),
      waves(3000, 1200, 60, 500, '#45b6c9', 40),
      waves(3000, 1800, 60, 500, '#8ff0de', 36),
      ...[[500, 3300], [2400, 3700], [800, 5000], [2200, 5400], [1500, 4300]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="90" ry="50" fill="#e0c49d"/>`),
      block(600, 3100, 1800),
      `<text x="1500" y="5600" font-size="560" text-anchor="middle" fill="${SEA}">beech</text>`,
    ].join(''),
  ),
  // flip flops: both footbeds from one file: sand with the shore across it
  'flipflops.png': svg(
    2000,
    2000,
    [
      `<rect width="2000" height="2000" fill="#f6e3c3"/>`,
      `<rect width="2000" height="700" fill="#2fa4bb"/>`,
      `<path d="M0 640 C 500 820 1000 560 1500 720 S 1900 640 2000 700 L 2000 900 L 0 900 Z" fill="#f6e3c3"/>`,
      `<path d="M0 640 C 500 820 1000 560 1500 720 S 1900 640 2000 700" fill="none" stroke="#fff" stroke-width="40" stroke-linecap="round"/>`,
      waves(2000, 260, 40, 340, '#45b6c9', 28),
      waves(2000, 480, 40, 340, '#8ff0de', 26),
      block(560, 1000, 880),
      `<text x="1000" y="1880" font-size="200" text-anchor="middle" fill="${SEA}">beech</text>`,
    ].join(''),
  ),
};

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [file, s] of Object.entries(art)) {
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(s).map(Number);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:transparent">${s}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, file), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(file, `${w}x${h}`, `${Math.round(fs.statSync(path.join(out, file)).size / 1024)} KB`);
}
await browser.close();
