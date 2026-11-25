// Sample render of a footprints drag trail, for QA.
//
//   node scripts/render-footprints-drag.mjs [--out docs/items/renders/footprints-drag.png]
//
// Loads the sandbox app in headless Chromium, picks footprints from the
// bag, and drags an S-curve across the sand with real pointer events —
// the same path a player takes — then screenshots the trail it leaves.
// Fails when the drag lays down fewer than three trails.
//
// Needs playwright (not a repo dependency — install it like CI does):
//   npm install --no-save playwright@1.63.0
//   npx playwright install chromium
// If the installed Playwright wants a different Chromium revision than the
// one cached on this machine, point at it directly:
//   CHROME_PATH=~/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome node scripts/render-footprints-drag.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
  const eq = a.indexOf('=');
  if (eq >= 0) args.set(a.slice(2, eq), a.slice(eq + 1));
  else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args.set(a.slice(2), argv[++i]);
  else args.set(a.slice(2), true);
}
const OUT = path.resolve(ROOT, String(args.get('out') ?? 'docs/items/renders/footprints-drag.png'));
const PORT = 5199;

let server;
let browser;
let failed = 0;
const fail = (msg) => {
  console.log(`FAIL ${msg}`);
  failed++;
};
try {
  const { createServer } = await import('vite');
  server = await createServer({
    root: ROOT,
    server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false },
  });
  await server.listen();

  const launchOpts = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
  if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
  browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1000, height: 625 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('beech.settings.v1', JSON.stringify({ palette: 'day', quality: 'low', sound: false, music: false, haptics: false }));
  });
  await page.goto(`http://127.0.0.1:${PORT}/?nointro&fixedres&seed=1&nofinds&quality=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
  await page.waitForTimeout(1500);
  // no UI over the sand
  await page.addStyleTag({ content: '.hud,.hud-walk,.place,.place-wrap,.shore-bar,.vignette{display:none!important}' });
  // open the rail (the app starts collapsed, palm only: look-only) and pick footprints up
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__beech.setRail(true));
  await page.evaluate(() => window.__beech.inventory.select('footprints'));
  await page.waitForTimeout(300);

  // an S-curve across the sand, with real pointer events (kept on dry sand:
  // a big screen-y swing maps to a long cross-shore run at this camera angle)
  const N = 48;
  await page.mouse.move(220, 400);
  await page.mouse.down();
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const x = 220 + t * 560;
    const y = 400 + Math.sin(t * Math.PI * 2) * 45;
    await page.mouse.move(x, y);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);

  const trail = await page.evaluate(() => {
    const b = window.__beech;
    const objects = b.info().objects.filter((o) => o.item === 'footprints');
    return objects.map((o) => ({ x: o.x, y: o.y }));
  });
  console.log(`footprints trails laid down: ${trail.length}`);
  if (trail.length < 3) fail(`only ${trail.length} footprints trails after the drag`);
  if (errors.length) fail(`page errors: ${errors.join(' | ')}`);

  // freeze the sea, then frame the whole trail
  await page.evaluate(() => window.__beech.send({ type: 'pause', paused: true }));
  const xs = trail.map((p) => p.x);
  const ys = trail.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const halfH = Math.max(spanY / 2, spanX / 2 / 1.6) * 1.25 + 0.5;
  console.log(`trail spans ${spanX.toFixed(1)} m alongshore x ${spanY.toFixed(1)} m cross-shore, framing halfH ${halfH.toFixed(1)}`);
  await page.evaluate(
    ({ x, y, halfH }) => {
      const b = window.__beech;
      const cam = b.cam;
      const { dx } = b.grid;
      const i = Math.min(b.grid.nx - 1, Math.max(0, Math.floor(x / dx)));
      const j = Math.min(b.grid.ny - 1, Math.max(0, Math.floor(y / dx)));
      const sand = b.rest[j * b.grid.nx + i];
      cam.camera.target.x = x + b.origin.x;
      cam.camera.target.y = sand;
      cam.camera.target.z = y + b.origin.z;
      cam.halfH = halfH;
      cam.applyOrtho();
    },
    { x: cx, y: cy, halfH },
  );
  await page.waitForTimeout(800);
  mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, timeout: 120000 });
  console.log(`wrote ${OUT}`);
} finally {
  await browser?.close();
  await server?.close();
}
if (failed) process.exit(1);
