import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS helper shared with scripts/bundle-server.mjs
import { BUNDLES, bundleText, outPath } from '../scripts/lib/bundleServer.mjs';

describe('server bundles (docs/LIVE_SIM.md)', () => {
  for (const b of BUNDLES as { entry: string; out: string }[]) {
    it(`${b.out} is up to date with ${b.entry} (npm run bundle:server)`, async () => {
      expect(readFileSync(outPath(b), 'utf8')).toBe(await bundleText(b));
    });
  }
});
