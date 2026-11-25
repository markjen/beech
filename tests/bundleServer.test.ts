import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS helper shared with scripts/bundle-server.mjs
import { BUNDLES, bundleText, outPath } from '../scripts/lib/bundleServer.mjs';

describe('server bundles (docs/LIVE_SIM.md)', () => {
  for (const b of BUNDLES as { entry: string; out: string }[]) {
    it(`${b.out} is up to date with ${b.entry} (npm run bundle:server)`, async () => {
      expect(readFileSync(outPath(b), 'utf8')).toBe(await bundleText(b));
    });
  }

  // The catch-up (the sea's work while nobody had a beach open) runs on the
  // server only: an app never catches a beach up itself, it reloads the
  // server's copy (owner after a gap, viewers when the version moves on).
  // Only the server bundle's entry may import it.
  it('no app code imports the catch-up model', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.ts') ? [join(dir, d.name)] : []));
    const allowed = new Set(['src/world/catchupBeach.ts', 'src/sim/catchup.ts']);
    const importers = files('src')
      .map((f) => relative('.', f).split('\\').join('/'))
      .filter((f) => !allowed.has(f))
      .filter((f) => /from\s+['"][^'"]*\/(catchup|catchupBeach)['"]|import\(\s*['"][^'"]*\/(catchup|catchupBeach)['"]/.test(readFileSync(f, 'utf8')));
    expect(importers).toEqual([]);
  });
});
