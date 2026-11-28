// Renders the merch store's sample beach, Sunny cove
// (docs/examples/sunny-cove.beach.json), into the two top-view prints the
// brand items use: public/merch/sample-square.png and sample-flat.png
// (server/src/merchPrint.ts, the same drawing as a buyer's own beach).
//
//   npx tsx scripts/merch-sample.mts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBeachFile } from '../src/world/beachFile';
import { encodeSand } from '../src/sim/sandCodec';
import { beachPrintPng } from '../server/src/merchPrint';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = await parseBeachFile(fs.readFileSync(path.join(root, 'docs', 'examples', 'sunny-cove.beach.json'), 'utf8'));
if (!r.ok) throw new Error(JSON.stringify(r.errors));
const b = r.beach;
const bytes = await encodeSand(b.delta, b.nx, b.ny, b.objects, b.cover);
const look = { location: b.location ?? 'bondi' };
for (const cut of ['square', 'flat'] as const) {
  const file = path.join(root, 'public', 'merch', `sample-${cut}.png`);
  fs.writeFileSync(file, beachPrintPng(bytes, look, cut));
  console.log(path.relative(root, file), Math.round(fs.statSync(file).size / 1024), 'KB');
}
