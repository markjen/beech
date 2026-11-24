#!/usr/bin/env node
// Writes server/src/generated/ from the client code the server shares
// (docs/LIVE_SIM.md). Run after changing src/sim/catchup.ts, its config or
// anything it imports: npm run bundle:server
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BUNDLES, bundleText, outPath } from './lib/bundleServer.mjs';

for (const b of BUNDLES) {
  const text = await bundleText(b);
  mkdirSync(path.dirname(outPath(b)), { recursive: true });
  writeFileSync(outPath(b), text);
  console.log(`wrote ${b.out} (${(text.length / 1024).toFixed(0)} KB)`);
}
