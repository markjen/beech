import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHOT_VERSIONS, storyHtml } from '../src/story.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/landing-assets/story');

describe('/story pictures', () => {
  it('each picture has a version matching its contents, so a replaced picture is never served stale', () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webp')).sort();
    expect(Object.keys(SHOT_VERSIONS).sort()).toEqual(files);
    for (const f of files) {
      const hash = createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex').slice(0, 8);
      expect(SHOT_VERSIONS[f], `${f}: update SHOT_VERSIONS in server/src/story.ts`).toBe(hash);
    }
  });

  it('every picture on the page is versioned', () => {
    const srcs = [...storyHtml().matchAll(/\/landing-assets\/story\/[^"']+/g)].map((m) => m[0]);
    expect(srcs.length).toBeGreaterThan(7);
    for (const s of srcs) expect(s).toMatch(/\.webp\?v=[0-9a-f]{8}$/);
  });
});
