// Profile what things on the beach cost, at several counts.
//   npx vite --port 5173 &
//   node scripts/perf-objects.mjs [url] [counts]     e.g. node scripts/perf-objects.mjs http://localhost:5173/ 0,400,1000,2000
// For each count it loads that many things (a realistic mix) straight into
// the simulation, lets it settle, then measures for a few seconds:
//   - worker:  the sim tick (ms) as the worker reports it
//   - main:    main-thread ms per frame in ObjectView.set / update, and in
//              handling the worker's frame message
//   - render:  draw calls, active meshes, frame time (headless Chromium uses
//              a software GPU, so absolute frame times are pessimistic; the
//              main-thread numbers are what to compare)
//   - top functions from a CPU profile (self time)
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}
const [url = 'http://localhost:5173/', countsArg = '0,400,1000,2000'] = process.argv.slice(2);
const counts = countsArg.split(',').map(Number);
const SECONDS = Number(process.env.PERF_SECONDS ?? 5);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'nointro&fixedres&seed=1&nofinds');
await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
await page.waitForTimeout(1500);

// instrument: time spent in ObjectView.set / update, and the worker message handler
await page.evaluate(() => {
  const b = window.__beech;
  const acc = (window.__perf = { set: 0, update: 0, frames: 0, msg: 0, tick: [] });
  const ov = b.objectView;
  for (const name of ['set', 'update']) {
    const orig = ov[name].bind(ov);
    ov[name] = (...a) => {
      const t = performance.now();
      const r = orig(...a);
      acc[name] += performance.now() - t;
      return r;
    };
  }
  const loop = () => {
    acc.frames++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

const cdp = await page.context().newCDPSession(page);
// PERF_THROTTLE=4 slows the CPU 4x, about a mid-range phone
if (process.env.PERF_THROTTLE) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.PERF_THROTTLE) });
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });

const rows = [];
for (const n of counts) {
  // a realistic mix, spread over the dry and wet beach
  await page.evaluate((n) => {
    const mix = [
      ['rock', 'rock', 0.33, [0.12, 0.8]],
      ['driftwood', 'driftwood', 0.12, [0.6, 2.4]],
      ['shell', 'shell', 0.2, [0.06, 0.3]],
      ['seaglass', 'seaglass', 0.08, [0.06, 0.14]],
      ['flag', 'flag', 0.05, [0.4, 0.4]],
      // the special things (they glow) are bought or won a few at a time
      ['starfish', 'starfish', 0.005, [0.1, 0.2]],
      ['deckchair', 'deckchair', 0.005, [1, 1]],
      ['parasol', 'parasol', 0.005, [1, 1]],
      ['sandcastle', 'sandcastle', 0.005, [1, 1]],
      ['rock', 'pebble', 0.17, [0.05, 0.25]],
    ];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
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
      objects.push({ id: i + 1, kind: m[0], item: m[1], x: 1 + rnd() * 30, y: 12 + rnd() * 19, angle: rnd() * 6.28, size: m[3][0] + rnd() * (m[3][1] - m[3][0]), variant: 1 + Math.floor(rnd() * 8) });
    }
    const b = window.__beech;
    b.send({ type: 'setSand', delta: new Float32Array(b.grid.nx * b.grid.ny), objects });
  }, n);
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const p = window.__perf;
    p.set = p.update = p.frames = 0;
    p.tick = [];
    p.t0 = performance.now();
    p.timer = setInterval(() => p.tick.push(window.__beech.info().tickMs), 250);
    p.dc0 = window.__beech.scene.getEngine()._drawCalls.current;
  });
  await cdp.send('Profiler.start');
  await page.waitForTimeout(SECONDS * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  const r = await page.evaluate(() => {
    const b = window.__beech;
    const p = window.__perf;
    clearInterval(p.timer);
    const ms = performance.now() - p.t0;
    const scene = b.scene;
    const ticks = p.tick.filter((x) => x > 0).sort((a, c) => a - c);
    return {
      objects: b.info().objects.length,
      fps: (p.frames / ms) * 1000,
      setMsPerFrame: p.set / Math.max(1, p.frames),
      updateMsPerFrame: p.update / Math.max(1, p.frames),
      tickMs: ticks.length ? ticks[Math.floor(ticks.length / 2)] : 0,
      meshes: scene.meshes.length,
      activeMeshes: scene.getActiveMeshes().length,
      drawCalls: (scene.getEngine()._drawCalls.current - p.dc0) / Math.max(1, p.frames),
      propDraws: b.objectView.drawCalls ?? null,
      moving: b.objectView.moving ?? null,
      jsHeapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    };
  });
  // top self-time functions
  const self = new Map();
  const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]));
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const nd = byId.get(profile.samples[i]);
    const f = nd.callFrame;
    const key = `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
  }
  const total = [...self.values()].reduce((s, v) => s + v, 0);
  const top = [...self.entries()]
    .filter(([k]) => !k.startsWith('(idle)') && !k.startsWith('(program)'))
    .sort((a, c) => c[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${((v / total) * 100).toFixed(1)}% ${k}`);
  rows.push({ n, ...r, top });
}

for (const r of rows) {
  console.log(
    `\n== ${r.n} things (${r.objects} in the sim) ==\n` +
      `fps ${r.fps.toFixed(1)} · worker tick ${r.tickMs.toFixed(2)} ms · main: set ${r.setMsPerFrame.toFixed(2)} ms/frame, update ${r.updateMsPerFrame.toFixed(2)} ms/frame\n` +
      `meshes ${r.meshes} (active ${r.activeMeshes}) · draw calls/frame ${r.drawCalls.toFixed(0)}${r.propDraws === null ? '' : ` (things: ${r.propDraws})`}${r.moving === null ? '' : ` · moving ${r.moving}`} · heap ${r.jsHeapMB?.toFixed(0)} MB\n` +
      `top self time (main thread):\n  ${r.top.join('\n  ')}`,
  );
}
if (process.env.PERF_JSON) console.log(JSON.stringify(rows.map(({ top, ...r }) => r)));
await browser.close();
