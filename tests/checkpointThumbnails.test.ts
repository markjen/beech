import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Checkpoint thumbnails used to freeze the game: each row drew its little
// top-down map on a canvas and then read the pixels back (toBlob) to make
// an <img> — ~25 s per thumbnail on software rendering, the whole panel
// frozen while the rows rendered. The canvas itself is the thumbnail now,
// so the pixels are never read back. These tests pin that: no readback API
// in either panel's thumbnail path, and both panels use the helper that
// returns the drawn canvas.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('checkpoint thumbnails', () => {
  it('never read pixels back in either panel', () => {
    for (const file of ['src/ui/checkpoints.ts', 'src/ui/localCheckpoints.ts']) {
      const src = read(file);
      expect(src).not.toContain('toBlob(');
      expect(src).not.toContain('toDataURL(');
      expect(src).not.toContain('createObjectURL(');
    }
  });

  it('both panels use the canvas-returning helper', () => {
    expect(read('src/ui/checkpoints.ts')).toContain('export async function thumbnailCanvas');
    expect(read('src/ui/localCheckpoints.ts')).toContain('thumbnailCanvas(');
  });

  it('the drawn canvas is marked so the device e2e can wait for it', () => {
    expect(read('src/ui/checkpoints.ts')).toContain("dataset.drawn = '1'");
    expect(read('scripts/sandbox-e2e.mjs')).toContain('.cp-thumb[data-drawn]');
  });
});
