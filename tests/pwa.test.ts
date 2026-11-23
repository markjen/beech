import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The PWA install prompt only fires when the manifest is valid and every
// icon it names actually exists. The manifest used to list .webp icons that
// were never shipped, so Chrome never offered to install the app.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

/** Width/height out of a PNG's IHDR chunk (bytes 16..24, big-endian). */
function pngSize(file: string): { w: number; h: number } {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe('web app manifest', () => {
  const manifest = JSON.parse(readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8')) as {
    name?: string;
    short_name?: string;
    start_url?: string;
    display?: string;
    icons?: { src: string; sizes: string; type?: string; purpose?: string }[];
  };

  it('has the fields an installable PWA needs', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(['fullscreen', 'standalone']).toContain(manifest.display);
  });

  it('every icon exists on disk at the size it claims', () => {
    expect(manifest.icons?.length).toBeGreaterThan(0);
    for (const icon of manifest.icons ?? []) {
      const file = path.join(PUBLIC, icon.src.replace(/^\.\//, ''));
      expect(existsSync(file), icon.src).toBe(true);
      const [w, h] = icon.sizes.split('x').map(Number);
      const actual = pngSize(file);
      expect(actual, icon.src).toEqual({ w, h });
    }
  });

  it('covers the install sizes: 192 + 512 "any", 512 "maskable"', () => {
    const has = (sizes: string, purpose: string) =>
      (manifest.icons ?? []).some(
        (i) => i.sizes === sizes && (i.purpose ?? 'any').split(' ').includes(purpose),
      );
    expect(has('192x192', 'any')).toBe(true);
    expect(has('512x512', 'any')).toBe(true);
    expect(has('512x512', 'maskable')).toBe(true);
  });
});

describe('service worker', () => {
  it('exists, and everything its offline shell names is a real file', () => {
    const sw = path.join(PUBLIC, 'sw.js');
    expect(existsSync(sw)).toBe(true);
    const src = readFileSync(sw, 'utf8');
    const shellBlock = /const SHELL = \[([\s\S]*?)\]/.exec(src)?.[1] ?? '';
    const shell = [...shellBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(shell.length).toBeGreaterThan(0);
    for (const entry of shell) {
      const rel = entry.replace(/^\.\//, '');
      // './index.html' lives at the repo root; everything else under public/
      const file = rel === '' ? PUBLIC : existsSync(path.join(PUBLIC, rel)) ? path.join(PUBLIC, rel) : path.join(ROOT, rel);
      expect(existsSync(file), entry).toBe(true);
    }
  });
});
