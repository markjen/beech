// Bundles client code the server needs (docs/LIVE_SIM.md: the catch-up) into
// server/src/generated/, so there is one source. Used by
// scripts/bundle-server.mjs (writes it) and tests/bundleServer.test.ts
// (checks it's up to date).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const BUNDLES = [
  { entry: 'src/world/catchupBeach.ts', out: 'server/src/generated/catchup.ts' },
  // the inland rows' shapes, for the shore site's pictures (docs/INLAND_SECTIONS.md)
  { entry: 'src/render/sectionShapes.ts', out: 'server/src/generated/sections.ts' },
];

const BANNER = (entry) =>
  `// @ts-nocheck\n// GENERATED from ${entry} by scripts/bundle-server.mjs. Do not edit: run \`npm run bundle:server\`.\n/* eslint-disable */`;

/** The bundle's text for one entry. */
export async function bundleText({ entry }) {
  const res = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    write: false,
    legalComments: 'none',
    loader: { '.json': 'json' },
    banner: { js: BANNER(entry) },
    logLevel: 'error',
  });
  // stable across machines: esbuild writes paths relative to the working dir in comments
  return res.outputFiles[0].text.replace(/^\/\/ (src|node_modules)\/.*$/gm, '').replace(/\n{3,}/g, '\n\n');
}

export const outPath = (b) => path.join(root, b.out);
