// Sample renders of every catalog item, for QA.
//
//   node scripts/render-items.mjs [--only rock,shell] [--out docs/items/renders] [--url http://localhost:5173/]
//
// Loads the sandbox app in headless Chromium, imports a beach that places
// every catalog item in labelled rows on dry sand, pauses the simulation,
// and screenshots the whole beach plus a close-up of each item. Then it
// composes the close-ups into a labelled contact sheet.
//
// Needs playwright (not a repo dependency — install it like CI does):
//   npm install --no-save playwright@1.63.0
//   npx playwright install chromium
// and a dev server, unless --url points at one already running:
//   npx vite --port 5199
//
// The renders are committed under docs/items/renders/ and linked from
// docs/ITEMS.md. Regenerate them whenever an item's look changes; each
// item PR adds renders for its own items with --only.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const OUT = path.resolve(ROOT, String(args.get('out') ?? 'docs/items/renders'));
const ONLY = args.get('only') ? String(args.get('only')).split(',').map((s) => s.trim()) : null;
const suppliedUrl = args.get('url') ? String(args.get('url')) : null;
const PORT = 5199;

// ---------------------------------------------------------------- catalog (the app's own data, bundled on the fly)

const entry = `export { ITEMS } from ${JSON.stringify(path.join(ROOT, 'src/world/items.ts'))};
export { POOLS } from ${JSON.stringify(path.join(ROOT, 'server/src/pulls.ts'))};
export { VENDING_SETS } from ${JSON.stringify(path.join(ROOT, 'server/src/vending.ts'))};
`;
const tmp = mkdtempSync(path.join(tmpdir(), 'beech-render-'));
const entryFile = path.join(tmp, 'entry.ts');
const bundleFile = path.join(tmp, 'catalog.mjs');
let catalog;
try {
  writeFileSync(entryFile, entry);
  execFileSync(path.join(ROOT, 'node_modules/.bin/esbuild'), [entryFile, '--bundle', '--format=esm', '--platform=node', `--outfile=${bundleFile}`], { stdio: 'pipe' });
  catalog = await import(pathToFileURL(bundleFile).href);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
const { ITEMS, POOLS, VENDING_SETS } = catalog;

// ---------------------------------------------------------------- layout: rows of items on dry sand (waves never reach y >= 22)

const GROUPS = [
  { name: 'Free', match: (it) => it.source === 'free' },
  { name: 'Claw', match: (it) => POOLS.daily.items[it.rarity]?.includes(it.id) },
  ...VENDING_SETS.map(({ week, items }) => ({
    name: `Vending · Week ${week}`,
    match: (it) => items[it.rarity]?.includes(it.id),
  })),
  { name: 'Shop', match: (it) => it.source === 'shop' },
];
const groupOf = (it) => GROUPS.find((g) => g.match(it))?.name ?? 'Other';
const groupOrder = (it) => {
  const index = GROUPS.findIndex((group) => group.match(it));
  return index < 0 ? GROUPS.length : index;
};
const ordered = [...ITEMS].sort((a, b) => groupOrder(a) - groupOrder(b));
const items = ONLY ? ordered.filter((it) => ONLY.includes(it.id)) : ordered;
if (ONLY) {
  const missing = ONLY.filter((id) => !ITEMS.some((it) => it.id === id));
  if (missing.length) throw new Error(`unknown item id(s): ${missing.join(', ')}`);
}

/**
 * Close-up framing (ortho half-height, metres). Shop pieces and the flag
 * have a fixed framing per kind; small things frame by their own size, so
 * a pebble and a rock don't share a framing just because they share a
 * kind, and the giant golden sand dollar doesn't fill (or crop) its shot.
 */
const HALF_H = {
  driftwood: 1.5, flag: 1.7,
  deckchair: 1.9, parasol: 2.7, surfboard: 2.5, tikitorch: 2.0,
  sandcastle: 2.2, beachhut: 2.6, lighthouse: 3.4,
  palmtree: 3.4, lifeguardtower: 3.0, bonfire: 1.6, hammock: 1.8, towel: 1.6,
};
const CLOSE_UP_LIFT = { palmtree: 1.2, lifeguardtower: 1.2 };
const halfHFor = (it) => HALF_H[it.kind] ?? Math.min(1.6, Math.max(0.55, Math.sqrt(it.size[0] * it.size[1]) * 2.2));

// Keep the rows on dry sand as the catalog grows. Widen the grid before
// putting a fifth row beyond the back edge of the beach.
const columns = Math.max(8, Math.ceil(items.length / 4));
const columnSpacing = 25.9 / (columns - 1);
const rowSpacing = columns > 8 ? 2.3 : 3;
const placed = items.map((it, i) => {
  const col = i % columns;
  const row = Math.floor(i / columns);
  const mid = Math.sqrt(it.size[0] * it.size[1]);
  return {
    id: it.id,
    name: it.name,
    group: groupOf(it),
    kind: it.kind,
    item: it.id,
    x: 3.2 + col * columnSpacing,
    y: 22.5 + row * rowSpacing,
    angle: 0,
    size: it.fixedSize ? it.size[0] : mid,
    variant: 1,
    halfH: halfHFor(it),
  };
});

let server;
let browser;
try {
  const url = new URL(suppliedUrl ?? `http://127.0.0.1:${PORT}/`);
  if (!suppliedUrl) {
    const { createServer } = await import('vite');
    server = await createServer({
      root: ROOT,
      server: { host: url.hostname, port: PORT, strictPort: true, hmr: false },
    });
    await server.listen();
  }

  mkdirSync(OUT, { recursive: true });
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // fixed palette and a cheap grid: the same light every run
  await page.addInitScript(() => {
    localStorage.setItem('beech.settings.v1', JSON.stringify({ palette: 'day', quality: 'low', sound: false, music: false, haptics: false }));
  });
  url.searchParams.set('seed', '1');
  url.searchParams.set('smoke', '1');
  url.searchParams.set('fixedres', '');
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
  // no UI over the sand
  await page.addStyleTag({ content: '.hud,.hud-walk,.place,.shore-bar,.vignette{display:none!important}' });
  // the whole QA beach at once (untouched sand, items from the catalog)
  await page.evaluate((objects) => {
    const b = window.__beech;
    const delta = new Float32Array(b.grid.nx * b.grid.ny);
    b.send({ type: 'importBeach', delta, objects }, [delta.buffer]);
  }, placed.map(({ id, ...o }) => o));
  await page.waitForFunction((ids) => {
    const objects = window.__beech.info().objects.filter((o) => !o.wild);
    return objects.length === ids.length && objects.every((o, i) => o.item === ids[i]);
  }, placed.map((p) => p.id), { timeout: 60000 });
  // freeze the sea: no wash-ins, no rolling, while the shots are taken
  await page.evaluate(() => window.__beech.send({ type: 'pause', paused: true }));

  const frame = async (x, y, halfH, lift = 0) => {
    await page.evaluate(
      ({ x, y, halfH, lift }) => {
        const b = window.__beech;
        const cam = b.cam;
        // aim at the sand under the item, not at y=0.2: the camera looks
        // down at 34°, so a target below the sand pushes the item up-screen
        const { dx } = b.grid;
        const i = Math.min(b.grid.nx - 1, Math.max(0, Math.floor(x / dx)));
        const j = Math.min(b.grid.ny - 1, Math.max(0, Math.floor(y / dx)));
        const sand = b.rest[j * b.grid.nx + i];
        cam.camera.target.x = x + b.origin.x;
        cam.camera.target.y = sand + lift;
        cam.camera.target.z = y + b.origin.z;
        cam.halfH = halfH;
        cam.applyOrtho();
      },
      { x, y, halfH, lift },
    );
    await page.waitForTimeout(800);
  };

  if (!ONLY) {
    await frame(16, 25, 8.5);
    await page.screenshot({ path: path.join(OUT, 'full-beach.png'), timeout: 120000 });
    console.log('full-beach.png');
  }

  // one close-up per item, centred (a 400 px square out of the 800x500 view)
  for (const p of placed) {
    const lift = p.kind === 'beachball' ? p.size : (CLOSE_UP_LIFT[p.kind] ?? 0);
    await frame(p.x, p.y, p.halfH, lift);
    await page.screenshot({ path: path.join(OUT, `${p.id}.png`), clip: { x: 200, y: 50, width: 400, height: 400 }, timeout: 120000 });
    console.log(`${p.id}.png  ${p.name} (${p.group}, ${p.kind})`);
  }
  if (errors.length) console.error('page errors:\n' + errors.slice(0, 10).join('\n'));
  await page.close();

  if (!ONLY) {
    // ---------------------------------------------------------- contact sheet
    const cells = (imageUrl) => placed
      .map(
        (p) =>
          `<figure><img src="${imageUrl(p.id)}" alt="${p.name}"><figcaption><b>${p.name}</b><br>${p.id} · ${p.group} · ${p.kind}</figcaption></figure>`,
      )
      .join('\n');
    const sheetHtml = (imageUrl) => `<!doctype html><meta charset="utf-8"><title>beech items — contact sheet</title>
<style>body{margin:0;background:#f6e3c3;font:14px system-ui,sans-serif;color:#3c2f2a}
h1{margin:16px 20px 4px;font-size:20px}p{margin:0 20px 12px;color:#6b5a54}
.grid{display:grid;grid-template-columns:repeat(4,300px);gap:12px;padding:0 20px 20px}
figure{margin:0;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.15)}
img{display:block;width:300px;height:300px;object-fit:cover}
figcaption{padding:8px 10px;line-height:1.35}</style>
<h1>Beech items — contact sheet</h1><p>Every catalog item on dry sand, day light, seed 1. See docs/ITEMS.md for the catalog.</p>
<div class="grid">${cells(imageUrl)}</div>`;
    const sheetFile = path.join(OUT, 'contact-sheet.html');
    writeFileSync(sheetFile, sheetHtml((id) => `${id}.png`));
    const sheet = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await sheet.setContent(sheetHtml((id) => {
      const png = readFileSync(path.join(OUT, `${id}.png`), 'base64');
      return `data:image/png;base64,${png}`;
    }));
    await sheet.screenshot({ path: path.join(OUT, 'contact-sheet.png'), fullPage: true, timeout: 120000 });
    await sheet.close();
    console.log('contact-sheet.png');
  }
} finally {
  await Promise.all([browser?.close(), server?.close()]);
}
console.log(`\n${placed.length} item(s) rendered to ${OUT}`);
