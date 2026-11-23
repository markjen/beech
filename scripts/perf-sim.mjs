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
   export { GRID_TIERS, SIM_HZ } from ${JSON.stringify(path.join(root, 'src/config.ts'))};`,
);
const out = path.join(dir, 'sim.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { BeachSim, GRID_TIERS, SIM_HZ } = await import(pathToFileURL(out).href);
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
  results[tier] = { grid: `${sim.nx}x${sim.ny}`, msPerTick: total / TICKS, phases: per };
  const rows = Object.entries(per)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  ${k.padEnd(16)} ${v.toFixed(3)} ms  ${((v / (total / TICKS)) * 100).toFixed(0)}%`);
  console.log(`${tier} (${sim.nx}x${sim.ny}): ${(total / TICKS).toFixed(2)} ms a tick (incl. pack)\n${rows.join('\n')}`);
}
if (args.json) writeFileSync(args.json, JSON.stringify(results, null, 2));
