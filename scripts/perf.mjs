#!/usr/bin/env node
// Performance profile of the app, for regular runs and CI (docs/PERFORMANCE.md).
//
//   npm run build && npm run perf                       # check against perf/budget.json
//   node scripts/perf.mjs --baseline old.json           # also show changes since an earlier run
//   node scripts/perf.mjs --counts 0,400,2000,4000 --profile --throttle 4
//
// It serves dist/ itself (or uses --url), loads fixed scenes of things on the
// beach (a seeded, realistic mix), and measures:
//   counts (deterministic; budgets fail CI):  draw calls per frame, meshes,
//     draw calls for things, things touched per frame on a still beach,
//     bundle size
//   timings (noisy on shared CI machines; budgets are loose): main-thread ms
//     per frame spent on things, the worker's sim tick, fps, heap
// Writes JSON (--out) and a Markdown summary (to $GITHUB_STEP_SUMMARY when set).
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}

// ------------------------------------------------------------------ options
const opt = { counts: '0,400,2000', seconds: '4', budget: path.join(root, 'perf/budget.json'), dist: path.join(root, 'dist') };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2);
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) opt[k] = true;
  else opt[k] = process.argv[++i];
}
const counts = String(opt.counts).split(',').map(Number);
const SECONDS = Number(opt.seconds);
const say = (s) => process.stderr.write(`${s}\n`);

// ------------------------------------------------------------------ serve dist/
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
let server = null;
let url = opt.url;
if (!url) {
  if (!existsSync(path.join(opt.dist, 'index.html'))) {
    say('perf: no dist/ — run `npm run build` first (or pass --url)');
    process.exit(2);
  }
  server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(opt.dist, p);
    if (!file.startsWith(opt.dist)) return res.writeHead(403).end();
    if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(opt.dist, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
}

// ------------------------------------------------------------------ bundle size
function bundle() {
  const dir = path.join(opt.dist, 'assets');
  if (!existsSync(dir)) return null;
  const js = readdirSync(dir).filter((f) => f.endsWith('.js'));
  let total = 0;
  let totalGz = 0;
  let main = { bytes: 0, gz: 0 };
  for (const f of js) {
    const b = readFileSync(path.join(dir, f));
    const gz = gzipSync(b).length;
    total += b.length;
    totalGz += gz;
    if (b.length > main.bytes) main = { bytes: b.length, gz };
  }
  return { mainJsKB: main.bytes / 1024, mainJsGzipKB: main.gz / 1024, totalJsKB: total / 1024, totalJsGzipKB: totalGz / 1024, jsFiles: js.length };
}

// ------------------------------------------------------------------ the simulation alone
// The browser's own tick number is unreliable here: the software GPU keeps
// every core busy, so the worker mostly measures waiting for a turn. The
// sim's real cost is measured in Node, on its own (scripts/perf-sim.mjs).
let sim = null;
if (!opt['no-sim']) {
  const tmp = path.join(root, `.perf-sim-${process.pid}.json`);
  try {
    execSync(`node ${JSON.stringify(path.join(root, 'scripts/perf-sim.mjs'))} --ticks ${Number(opt['sim-ticks'] ?? 200)} --json ${JSON.stringify(tmp)}`, { stdio: ['ignore', 'ignore', 'inherit'] });
    sim = JSON.parse(readFileSync(tmp, 'utf8'));
  } finally {
    try {
      execSync(`rm -f ${JSON.stringify(tmp)}`);
    } catch {
      /* gone already */
    }
  }
  for (const [tier, r] of Object.entries(sim)) say(`perf: sim ${tier} (${r.grid}) ${r.msPerTick.toFixed(2)} ms a tick`);
}

// ------------------------------------------------------------------ the browser
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(url + '?nointro&fixedres&seed=1&nofinds');
await page.waitForSelector('body[data-ready="1"]', { timeout: 90000 });
await page.waitForTimeout(1500);
const cdp = await page.context().newCDPSession(page);
if (opt.throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(opt.throttle) });
if (opt.profile) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
}

// time spent on things on the main thread: the view's set/update/touch
await page.evaluate(() => {
  const b = window.__beech;
  const acc = (window.__perf = { ms: 0, frames: 0 });
  const ov = b.objectView;
  for (const name of ['set', 'update', 'touch']) {
    if (typeof ov[name] !== 'function') continue;
    const orig = ov[name].bind(ov);
    ov[name] = (...a) => {
      const t = performance.now();
      const r = orig(...a);
      acc.ms += performance.now() - t;
      return r;
    };
  }
  const loop = () => {
    acc.frames++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

const scenes = [];
for (const n of counts) {
  // a seeded mix like a real beach: mostly free things, a few special ones (they glow).
  // On the dry sand, so "touched per frame" measures what a still beach costs.
  await page.evaluate((n) => {
    const mix = [
      ['rock', 'rock', 0.33, [0.12, 0.8]],
      ['rock', 'pebble', 0.17, [0.05, 0.25]],
      ['driftwood', 'driftwood', 0.12, [0.6, 2.4]],
      ['shell', 'shell', 0.2, [0.06, 0.3]],
      ['seaglass', 'seaglass', 0.08, [0.06, 0.14]],
      ['flag', 'flag', 0.05, [0.4, 0.4]],
      ['starfish', 'starfish', 0.005, [0.1, 0.2]],
      ['deckchair', 'deckchair', 0.005, [1, 1]],
      ['parasol', 'parasol', 0.005, [1, 1]],
      ['sandcastle', 'sandcastle', 0.005, [1, 1]],
    ];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const objects = [];
    for (let i = 0; i < n; i++) {
      let r = rnd();
      let m = mix[0];
      for (const x of mix) {
        if (r < x[2]) {
          m = x;
          break;
        }
        r -= x[2];
      }
      objects.push({ id: i + 1, kind: m[0], item: m[1], x: 1 + rnd() * 30, y: 21 + rnd() * 10, angle: rnd() * 6.28, size: m[3][0] + rnd() * (m[3][1] - m[3][0]), variant: 1 + Math.floor(rnd() * 8) });
    }
    const b = window.__beech;
    b.send({ type: 'setSand', delta: new Float32Array(b.grid.nx * b.grid.ny), objects });
  }, n);
  // let it settle in *simulation* time (sand slumps around new rocks for a
  // few sim seconds): a slow CI machine runs the sim slower than real time,
  // so a fixed wall-clock wait would measure a beach still on the move
  const settle = await page.evaluate(async (simSeconds) => {
    const info = () => window.__beech.info();
    const t0 = info().t;
    const w0 = performance.now();
    while (info().t - t0 < simSeconds && performance.now() - w0 < 120000) await new Promise((r) => setTimeout(r, 250));
    return { sim: info().t - t0, wall: (performance.now() - w0) / 1000 };
  }, Number(opt.settle ?? 8));
  say(`perf: ${n} things settled for ${settle.sim.toFixed(1)} sim s (${settle.wall.toFixed(1)} s)`);
  await page.evaluate(() => {
    const p = window.__perf;
    p.ms = 0;
    p.frames = 0;
    p.ticks = [];
    p.t0 = performance.now();
    p.dc0 = window.__beech.scene.getEngine()._drawCalls.current;
    p.timer = setInterval(() => p.ticks.push(window.__beech.info().tickMs), 200);
  });
  if (opt.profile) await cdp.send('Profiler.start');
  await page.waitForTimeout(SECONDS * 1000);
  const profile = opt.profile ? (await cdp.send('Profiler.stop')).profile : null;
  const r = await page.evaluate(() => {
    const b = window.__beech;
    const p = window.__perf;
    clearInterval(p.timer);
    const ms = performance.now() - p.t0;
    const ticks = p.ticks.filter((x) => x > 0).sort((a, c) => a - c);
    const scene = b.scene;
    return {
      things: b.info().objects.length,
      drawCallsPerFrame: (scene.getEngine()._drawCalls.current - p.dc0) / Math.max(1, p.frames),
      meshes: scene.meshes.length,
      thingDrawCalls: b.objectView.drawCalls ?? null,
      touchedPerFrame: b.objectView.moving ?? null,
      mainThingsMsPerFrame: p.ms / Math.max(1, p.frames),
      workerTickMs: ticks.length ? ticks[Math.floor(ticks.length / 2)] : 0,
      fps: (p.frames / ms) * 1000,
      heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    };
  });
  const scene = { n, ...r };
  if (profile) scene.top = topFunctions(profile);
  scenes.push(scene);
  say(`perf: ${n} things · ${r.drawCallsPerFrame.toFixed(0)} draws/frame · main ${r.mainThingsMsPerFrame.toFixed(2)} ms · tick ${r.workerTickMs.toFixed(1)} ms`);
}
await browser.close();
server?.close();

function topFunctions(profile) {
  const self = new Map();
  const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]));
  for (let i = 0; i < profile.samples.length; i++) {
    const f = byId.get(profile.samples[i]).callFrame;
    const key = `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  }
  return [...self.entries()]
    .filter(([k]) => !/^\((idle|program)\)/.test(k))
    .sort((a, c) => c[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${v.toFixed(0)} ms ${k}`);
}

// ------------------------------------------------------------------ results
const sha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  } catch {
    return process.env.GITHUB_SHA?.slice(0, 7) ?? 'unknown';
  }
})();
const result = { sha, date: new Date().toISOString(), throttle: Number(opt.throttle ?? 1), seconds: SECONDS, bundle: bundle(), sim, scenes, pageErrors };
if (opt.out) writeFileSync(opt.out, `${JSON.stringify(result, null, 2)}\n`);

// metric paths: "bundle.mainJsGzipKB", "scenes.2000.drawCallsPerFrame"
const get = (res, p) => {
  const [a, b, c] = p.split('.');
  if (a === 'bundle') return res.bundle?.[b];
  if (a === 'sim') return res.sim?.[b]?.[c];
  if (a === 'scenes') return res.scenes.find((s) => s.n === Number(b))?.[c];
  return undefined;
};

// budgets
const failures = [];
const rows = [];
let budget = null;
if (opt.budget && opt.budget !== 'none' && existsSync(opt.budget)) budget = JSON.parse(readFileSync(opt.budget, 'utf8'));
if (budget) {
  for (const [kind, entries] of [['count', budget.counts ?? {}], ['timing', budget.timings ?? {}]]) {
    for (const [p, max] of Object.entries(entries)) {
      const v = get(result, p);
      if (v === undefined || v === null) {
        rows.push([p, '—', max, 'not measured']);
        continue;
      }
      const ok = v <= max;
      if (!ok) failures.push(`${p} = ${fmt(v)} (budget ${max}, ${kind})`);
      rows.push([p, fmt(v), max, ok ? 'ok' : `**over** (${kind})`]);
    }
  }
}

// changes since a baseline run
let base = null;
if (opt.baseline && existsSync(opt.baseline)) base = JSON.parse(readFileSync(opt.baseline, 'utf8'));
function fmt(v) {
  return typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : String(v);
}
const delta = (p) => {
  if (!base) return '';
  const a = get(base, p);
  const b = get(result, p);
  if (typeof a !== 'number' || typeof b !== 'number' || a === 0) return '';
  const d = ((b - a) / a) * 100;
  return `${d > 0 ? '+' : ''}${d.toFixed(0)}%`;
};

const metrics = ['drawCallsPerFrame', 'meshes', 'thingDrawCalls', 'touchedPerFrame', 'mainThingsMsPerFrame', 'workerTickMs', 'fps', 'heapMB'];
let md = `## Performance (${sha}${result.throttle > 1 ? `, CPU ×${result.throttle} slower` : ''})\n\n`;
md += `Headless Chromium with a software GPU: fps and timings are slower than a real device and noisy; the counts are exact.\n\n`;
md += `| things | ${metrics.join(' | ')} |\n|${'---|'.repeat(metrics.length + 1)}\n`;
for (const s of scenes) md += `| ${s.n} | ${metrics.map((m) => `${fmt(s[m])}${base ? ` <sub>${delta(`scenes.${s.n}.${m}`)}</sub>` : ''}`).join(' | ')} |\n`;
if (result.bundle) {
  const b = result.bundle;
  md += `\nBundle: main ${b.mainJsKB.toFixed(0)} KB (${b.mainJsGzipKB.toFixed(0)} KB gzip${base ? ` ${delta('bundle.mainJsGzipKB')}` : ''}), all JS ${b.totalJsKB.toFixed(0)} KB (${b.totalJsGzipKB.toFixed(0)} KB gzip) in ${b.jsFiles} files.\n`;
}
if (result.sim) {
  md += `\nSimulation tick in Node (as the app runs it: waves, tide, erosion, healing, seepage):\n\n| tier | grid | ms a tick | top phases |\n|---|---|---|---|\n`;
  for (const [tier, r] of Object.entries(result.sim)) {
    const top = Object.entries(r.phases).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ');
    md += `| ${tier} | ${r.grid} | ${r.msPerTick.toFixed(2)}${base ? ` <sub>${delta(`sim.${tier}.msPerTick`)}</sub>` : ''} | ${top} |\n`;
  }
}
if (rows.length) md += `\n| budget | value | max | |\n|---|---|---|---|\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;
if (base) md += `\nChanges are against ${base.sha} (${base.date.slice(0, 10)}).\n`;
for (const s of scenes) if (s.top) md += `\n<details><summary>top functions at ${s.n} things</summary>\n\n${s.top.map((t) => `- ${t}`).join('\n')}\n</details>\n`;
if (pageErrors.length) md += `\nPage errors: ${pageErrors.join(' | ')}\n`;

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
process.stdout.write(md);
if (pageErrors.length) failures.push(`page errors: ${pageErrors.length}`);
if (failures.length) {
  say(`\nperf: over budget:\n  ${failures.join('\n  ')}\nIf this is expected (a deliberate trade-off), raise the number in perf/budget.json in the same commit and say why.`);
  process.exit(1);
}
say('perf: within budget');
