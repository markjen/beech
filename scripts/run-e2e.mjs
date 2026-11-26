#!/usr/bin/env node
// Run all server E2E scripts in parallel against a running dev server
// (npm run server:dev), sharing one headless Chromium browser server.
//   npm run e2e                       # runs all 11 server E2E scripts (default: 3 concurrent)
//   node scripts/run-e2e.mjs --jobs 4
//   node scripts/run-e2e.mjs account live
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROMIUM_ARGS, loadPlaywright } from './lib/e2e.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL = [
  'account-e2e',
  'neighbors-e2e',
  'shore-e2e',
  'beaches-e2e',
  'leaderboard-e2e',
  'checkpoints-e2e',
  'invites-e2e',
  'inbox-e2e',
  'live-e2e',
  'copy-e2e',
  'push-e2e',
];

let jobCount = process.env.E2E_JOBS ?? '3';
const filters = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--jobs' || a === '-j') {
    jobCount = process.argv[++i];
  } else if (a.startsWith('-')) {
    console.error(`Unknown E2E option: ${a}`);
    process.exit(2);
  } else {
    filters.push(a);
  }
}

const jobs = Number(jobCount);
if (!Number.isSafeInteger(jobs) || jobs < 1) {
  console.error('E2E job count must be a positive integer (--jobs or E2E_JOBS).');
  process.exit(2);
}

const scripts = filters.length ? ALL.filter((s) => filters.some((f) => s.includes(f))) : ALL;
if (!scripts.length) {
  console.error(`No E2E scripts matched: ${filters.join(', ')}`);
  process.exit(2);
}

const { chromium } = await loadPlaywright();
const server = await chromium.launchServer({ args: CHROMIUM_ARGS, executablePath: process.env.E2E_CHROMIUM_PATH });
const wsEndpoint = server.wsEndpoint();

const tAll = Date.now();
const queue = [...scripts];
const results = [];

function runOne(name) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(root, 'scripts', `${name}.mjs`)], {
      cwd: root,
      env: { ...process.env, E2E_WS_ENDPOINT: wsEndpoint },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const record = (chunk) => {
      if (process.env.DEBUG_E2E) process.stdout.write(chunk);
      else out += chunk;
    };
    child.stdout.on('data', record);
    child.stderr.on('data', record);
    child.on('error', (error) => record(`Could not start ${name}: ${error.message}\n`));
    child.on('close', (code) => {
      const ms = Date.now() - t0;
      const ok = code === 0;
      const tag = ok ? 'PASS' : 'FAIL';
      console.log(`${tag}  ${name.padEnd(18)} ${(ms / 1000).toFixed(2).padStart(6)}s`);
      if (!ok && out) {
        console.log(`--- ${name} output ---\n${out.trim()}\n---`);
      }
      resolve({ name, ok, ms, out });
    });
  });
}

try {
  const workers = Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      results.push(await runOne(next));
    }
  });
  await Promise.all(workers);
} finally {
  await server.close();
}

const totalSec = ((Date.now() - tAll) / 1000).toFixed(2);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in ${totalSec}s (jobs=${jobs})`);
process.exit(failed.length ? 1 : 0);
