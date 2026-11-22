// Renders the app icon / splash artwork (an isometric beach tile) to every PNG
// size the PWA and the native stores need. Run: npm run icons
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}

const SKY = { top: '#8fd0e6', mid: '#cfe9ee', bottom: '#fbeedd' };
const DUSK = { top: '#4a4f85', mid: '#9a7fa6', bottom: '#e59a9a' };

/** The tile, drawn in a 1024 box. */
function tile() {
  const T = [512, 300];
  const L = [192, 485];
  const B = [512, 670];
  const R = [832, 485];
  const h = 130;
  const p = (pts) => pts.map((q) => q.join(',')).join(' ');
  const a = [352, 392.5];
  const b = [672, 577.5];
  // gentle wavy shoreline from a to b
  const wave = `M${a} Q 420,470 472,455 T 590,520 T ${b}`;
  const stripes = [];
  for (let i = 0; i < 4; i++) {
    const y0 = 22 + i * 27;
    const col = i % 2 ? '#d8b088' : '#efd2a8';
    stripes.push(`<polygon points="${p([[L[0], L[1] + y0], [B[0], B[1] + y0], [B[0], B[1] + y0 + 14], [L[0], L[1] + y0 + 14]])}" fill="${col}"/>`);
    stripes.push(`<polygon points="${p([[B[0], B[1] + y0], [R[0], R[1] + y0], [R[0], R[1] + y0 + 14], [B[0], B[1] + y0 + 14]])}" fill="${i % 2 ? '#c89f7a' : '#e2c197'}"/>`);
  }
  return `
  <polygon points="${p([L, B, [B[0], B[1] + h], [L[0], L[1] + h]])}" fill="#e6c49d"/>
  <polygon points="${p([B, R, [R[0], R[1] + h], [B[0], B[1] + h]])}" fill="#d4ad86"/>
  ${stripes.join('\n')}
  <polygon points="${p([[L[0], L[1] + h], [B[0], B[1] + h], [B[0], B[1] + h + 40], [L[0] + 40, L[1] + h + 18]])}" fill="#8a97a8"/>
  <polygon points="${p([[B[0], B[1] + h], [R[0], R[1] + h], [R[0] - 40, R[1] + h + 18], [B[0], B[1] + h + 40]])}" fill="#76849a"/>
  <path d="M${L} L${B} L${b} ${wave.replace(/^M[^Q]+/, '').replace(/Q/, 'L' + a + ' Q')} Z" fill="none"/>
  <clipPath id="top"><polygon points="${p([T, R, B, L])}"/></clipPath>
  <g clip-path="url(#top)">
    <polygon points="${p([T, R, B, L])}" fill="#2fa4bb"/>
    <path d="${wave} L ${R} L ${T} Z" fill="#45b6c9"/>
    <path d="M${a} Q 420,470 472,455 T 590,520 T ${b} L ${B} L ${L} Z" fill="#f6e3c3" transform="translate(0,0)"/>
    <path d="M${a} Q 420,470 472,455 T 590,520 T ${b} L ${b[0] - 40},${b[1] - 40} Q 560,480 470,425 T ${a[0] + 30},${a[1] - 25} Z" fill="#8ff0de" opacity="0.85"/>
    <path d="M${a[0] + 6},${a[1] - 4} Q 420,465 472,450 T 590,515 T ${b[0] - 6},${b[1] - 4}" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" opacity="0.95"/>
    <path d="M${a[0] + 4},${a[1] + 10} Q 420,480 472,466 T 590,531 T ${b[0] + 2},${b[1] + 8}" fill="none" stroke="#cdb08e" stroke-width="10" stroke-linecap="round" opacity="0.6"/>
    <ellipse cx="420" cy="560" rx="38" ry="21" fill="#e0c49d"/>
    <ellipse cx="420" cy="556" rx="24" ry="13" fill="#cdb08e"/>
  </g>`;
}

function svg({ size = 1024, bg = SKY, scale = 1, transparent = false, tileOnly = false } = {}) {
  const off = (1 - scale) * 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${bg.top}"/><stop offset="0.55" stop-color="${bg.mid}"/><stop offset="1" stop-color="${bg.bottom}"/>
  </linearGradient></defs>
  ${transparent ? '' : '<rect width="1024" height="1024" fill="url(#sky)"/>'}
  ${tileOnly && transparent ? '' : ''}
  <g transform="translate(${off},${off - 45 * scale}) scale(${scale})">${tile()}</g>
</svg>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svgText, out, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svgText.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`,
  );
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', out);
}

fs.mkdirSync('public/icons', { recursive: true });
fs.mkdirSync('resources', { recursive: true });
fs.writeFileSync('public/icons/icon.svg', svg({ scale: 1.2 }));
await render(svg({ scale: 1.2 }), 'public/icons/icon-192.png', 192);
await render(svg({ scale: 1.2 }), 'public/icons/icon-512.png', 512);
await render(svg({ scale: 0.95 }), 'public/icons/maskable-512.png', 512);
await render(svg({ scale: 1.2 }), 'public/icons/apple-touch-icon.png', 180);
await render(svg({ scale: 1.25 }), 'public/icons/favicon-32.png', 32);
// native store sources (consumed by `npx @capacitor/assets generate`)
await render(svg({ scale: 1.15 }), 'resources/icon-only.png', 1024);
await render(svg({ scale: 0.85, transparent: true }), 'resources/icon-foreground.png', 1024);
await render(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SKY.top}"/><stop offset="0.55" stop-color="${SKY.mid}"/><stop offset="1" stop-color="${SKY.bottom}"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#g)"/></svg>`, 'resources/icon-background.png', 1024);
await render(svg({ scale: 0.26 }), 'resources/splash.png', 2732);
await render(svg({ scale: 0.26, bg: DUSK }), 'resources/splash-dark.png', 2732);
// Android TV launcher banner (320x180, xhdpi)
{
  const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 1600 900">
  <defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SKY.top}"/><stop offset="0.55" stop-color="${SKY.mid}"/><stop offset="1" stop-color="${SKY.bottom}"/></linearGradient></defs>
  <rect width="1600" height="900" fill="url(#b)"/>
  <g transform="translate(-60,60) scale(0.78)">${tile()}</g>
  <text x="1080" y="500" font-family="Avenir Next, Futura, sans-serif" font-size="170" font-weight="300" letter-spacing="40" fill="#5f7287" text-anchor="middle">beech</text>
</svg>`;
  fs.mkdirSync('android/app/src/main/res/drawable-xhdpi', { recursive: true });
  await page.setViewportSize({ width: 320, height: 180 });
  await page.setContent(`<html><body style="margin:0">${banner}</body></html>`);
  await page.screenshot({ path: 'android/app/src/main/res/drawable-xhdpi/banner.png', clip: { x: 0, y: 0, width: 320, height: 180 } });
  console.log('wrote android banner');
}
await browser.close();
