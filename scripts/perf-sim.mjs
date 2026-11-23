#!/usr/bin/env node
// Where the simulation's tick goes, phase by phase, on each grid tier
// (docs/PERFORMANCE.md). Runs the real BeachSim in Node (bundled with esbuild).
//   node scripts/perf-sim.mjs [--ticks 300] [--tier high] [--json out.json]
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : acc), []),
);
const TICKS = Number(args.ticks ?? 300);

const dir = mkdtempSync(path.join(tmpdir(), 'perf-sim-'));
const entry = path.join(dir, 'entry.ts');
writeFileSync(
  entry,
  `export { BeachSim } from ${JSON.stringify(path.join(root, 'src/sim/beachSim.ts'))};
   export { GRID_TIERS, SIM_HZ, PROFILE } from ${JSON.stringify(path.join(root, 'src/config.ts'))};
   export { catchUp } from ${JSON.stringify(path.join(root, 'src/sim/catchup.ts'))};
   export { beachById } from ${JSON.stringify(path.join(root, 'src/world/locations.ts'))};
   export { tideHeight } from ${JSON.stringify(path.join(root, 'src/world/tides.ts'))};
   export { diorama } from ${JSON.stringify(path.join(root, 'src/world/live.ts'))};`,
);
const out = path.join(dir, 'sim.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', loader: { '.json': 'json' } });
const { BeachSim, GRID_TIERS, SIM_HZ, PROFILE, catchUp, beachById, tideHeight, diorama } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const PHASES = ['applyBrush', 'applyUndoEasing', 'force', 'flow', 'seep', 'erode', 'slump', 'heal', 'updateWetFoam', 'measureSwash'];
const results = {};
for (const tier of args.tier ? [args.tier] : Object.keys(GRID_TIERS)) {
  // as the app runs it (src/main.ts): every process on, a live tide and full waves
  const sim = new BeachSim(GRID_TIERS[tier], 1, { waves: true, tide: true, erosion: true, healing: true, seep: true });
  sim.setSea(Number(args.tide ?? 0.3), 1);
  const ms = Object.fromEntries([...PHASES, 'objects', 'pack'].map((p) => [p, 0]));
  for (const p of PHASES) {
    const orig = sim[p].bind(sim);
    sim[p] = (...a) => {
      const t = performance.now();
      const r = orig(...a);
      ms[p] += performance.now() - t;
      return r;
    };
  }
  const objStep = sim.objects.step.bind(sim.objects);
  sim.objects.step = (...a) => {
    const t = performance.now();
    objStep(...a);
    ms.objects += performance.now() - t;
  };
  // warm up (JIT), then measure
  const dt = 1 / SIM_HZ;
  for (let i = 0; i < 60; i++) sim.step(dt);
  for (const k of Object.keys(ms)) ms[k] = 0;
  const buf = new Float32Array(sim.n * 4);
  const t0 = performance.now();
  for (let i = 0; i < TICKS; i++) {
    sim.step(dt);
    const tp = performance.now();
    sim.pack(buf);
    ms.pack += performance.now() - tp;
  }
  const total = performance.now() - t0;
  const per = Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, v / TICKS]));
  // the server's catch-up (docs/LIVE_SIM.md): 14 days of Brighton's big tides
  // on a beach with a few castles in the swash, at this tier's grid
  const g = GRID_TIERS[tier];
  const delta = new Float32Array(g.nx * g.ny);
  for (const [cx, cy] of [[6, 1], [14, 0], [22, 2], [28, -1]]) {
    const y0 = PROFILE.shoreline + cy;
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const d = Math.hypot((i + 0.5) * g.dx - cx, (j + 0.5) * g.dx - y0);
        if (d < 1.5) delta[j * g.nx + i] = 0.6 * Math.min(1, (1.5 - d) / 0.4);
      }
  }
  const place = beachById('brighton') ?? beachById('bondi');
  const tide = (t) => diorama(tideHeight(place.tide, new Date(t)));
  const to = Date.UTC(2026, 10, 15);
  const run = () => catchUp({ nx: g.nx, ny: g.ny, delta, objects: [], tide, waves: place.waves, from: to - 14 * 86400000, to });
  run();
  const c0 = performance.now();
  const REPS = 3;
  for (let r = 0; r < REPS; r++) run();
  const catchup14dMs = (performance.now() - c0) / REPS;
  results[tier] = { grid: `${sim.nx}x${sim.ny}`, msPerTick: total / TICKS, phases: per, catchup14dMs };
  console.log(`${tier}: 14-day catch-up ${catchup14dMs.toFixed(1)} ms`);
  const rows = Object.entries(per)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${k.padEnd(16)} ${v.toFixed(3)} ms  ${((v / (total / TICKS)) * 100).toFixed(0)}%`);
  console.log(`${tier} (${sim.nx}x${sim.ny}): ${(total / TICKS).toFixed(2)} ms a tick (incl. pack)\n${rows.join('\n')}`);
}
if (args.json) writeFileSync(args.json, JSON.stringify(results, null, 2));
