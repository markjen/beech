import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORLD_SIZE_X } from '../src/config';
import type { PlacedObject } from '../src/sim/objects';
import { MAX_OBJECTS, decodeSand, encodeSand } from '../src/sim/sandCodec';
import {
  MAX_FILE_CHARS,
  MAX_RAISE,
  MIN_DELTA,
  drawShapes,
  parseBeachFile,
  reconcileItems,
  writeBeachFile,
  type Shape,
} from '../src/world/beachFile';

const N = 64;
const dx = WORLD_SIZE_X / N;
const cell = (x: number, y: number) => Math.floor(y / dx) * N + Math.floor(x / dx);
const file = (extra: Record<string, unknown>) => JSON.stringify({ format: 'beech.beach', version: 1, ...extra });

function wavyBeach(): Float32Array {
  const d = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) d[j * N + i] = Math.round(300 * Math.sin(i / 5) * Math.cos(j / 7)) / 1000;
  return d;
}

const objs: PlacedObject[] = [
  { id: 4, kind: 'rock', item: 'rock', x: 10.25, y: 18.5, angle: 1.2, size: 0.6, variant: 3 },
  { id: 9, kind: 'deckchair', item: 'deckchair', x: 16, y: 24, angle: -0.2, size: 1, variant: 2 },
  { id: 11, kind: 'shell', item: 'shell', x: 5, y: 15, angle: 0, size: 0.1, variant: 7, wild: true },
];

describe('beach files', () => {
  for (const encoding of ['deflate-int16le', 'int16le', 'rows'] as const) {
    it(`round-trips the sand and objects (${encoding})`, async () => {
      const delta = wavyBeach();
      const text = await writeBeachFile({ nx: N, ny: N, delta, objects: objs }, { name: 'Wavy', location: 'piha', encoding });
      const r = await parseBeachFile(text, { nx: N, ny: N });
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      expect(r.warnings).toEqual([]);
      expect(r.beach.name).toBe('Wavy');
      expect(r.beach.location).toBe('piha');
      for (let k = 0; k < delta.length; k++) expect(r.beach.delta[k]).toBeCloseTo(delta[k], 3);
      // the wild shell isn't exported; the others come back as they were
      expect(r.beach.objects.map((o) => o.item)).toEqual(['rock', 'deckchair']);
      const rock = r.beach.objects[0];
      expect(rock).toMatchObject({ kind: 'rock', x: 10.25, y: 18.5, size: 0.6, variant: 3 });
      expect(rock.angle).toBeCloseTo(1.2, 2);
    });
  }

  it('reads the sand of the app’s own save format', async () => {
    const delta = wavyBeach();
    const saved = await decodeSand(await encodeSand(delta, N, N, objs));
    const r = await parseBeachFile(await writeBeachFile(saved), { nx: N, ny: N });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Array.from(r.beach.delta)).toEqual(Array.from(saved.delta).map((v) => Math.round(v * 1000) / 1000).map((v) => Math.fround(v)));
  });

  it('resamples a small grid to the device grid', async () => {
    const rows = Array.from({ length: 8 }, () => Array(8).fill(200));
    const r = await parseBeachFile(file({ sand: { nx: 8, ny: 8, unit: 'mm', encoding: 'rows', data: rows } }), { nx: N, ny: N });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.beach.delta.length).toBe(N * N);
      for (const v of r.beach.delta) expect(v).toBeCloseTo(0.2, 5);
    }
  });

  it('draws each kind of shape where the file says', async () => {
    const shapes = [
      { type: 'mound', x: 8, y: 24, radius: 2, height: 0.5 },
      { type: 'ring', x: 24, y: 24, radius: 3, width: 1, height: -0.3 },
      { type: 'line', from: [4, 6], to: [28, 6], width: 1, height: 0.4 },
      { type: 'rect', x: 16, y: 14, width: 4, length: 2, height: 0.25, edge: 0 },
    ];
    const r = await parseBeachFile(file({ shapes }), { nx: N, ny: N });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const d = r.beach.delta;
    expect(d[cell(8, 24)]).toBeGreaterThan(0.45); // top of the dome
    expect(d[cell(8, 26.6)]).toBe(0); // outside it
    expect(d[cell(27, 24)]).toBeCloseTo(-0.3, 1); // in the moat
    expect(d[cell(24, 24)]).toBe(0); // inside the ring: untouched
    expect(d[cell(16, 6)]).toBeCloseTo(0.4, 2); // along the wall
    expect(d[cell(16, 8)]).toBe(0);
    expect(d[cell(16, 14)]).toBeCloseTo(0.25, 5); // flat-topped plateau
    expect(d[cell(17.5, 14.6)]).toBeCloseTo(0.25, 5);
    expect(d[cell(19, 14)]).toBe(0);
  });

  it('combines shapes with add, set, max and min', () => {
    const base = () => new Float32Array(N * N).fill(0.2);
    const sq = (height: number, mode: Shape['mode']): Shape => ({ type: 'rect', x: 16, y: 16, width: 8, length: 8, height, mode, edge: 0 });
    const at = (d: Float32Array) => d[cell(16, 16)];
    const run = (s: Shape) => {
      const d = base();
      drawShapes(d, N, N, [s]);
      return at(d);
    };
    expect(run(sq(0.3, 'add'))).toBeCloseTo(0.5, 5);
    expect(run(sq(0.3, 'set'))).toBeCloseTo(0.3, 5);
    expect(run(sq(0.1, 'max'))).toBeCloseTo(0.2, 5);
    expect(run(sq(0.4, 'max'))).toBeCloseTo(0.4, 5);
    expect(run(sq(-0.5, 'min'))).toBeCloseTo(-0.5, 5);
    expect(run(sq(0.5, 'min'))).toBeCloseTo(0.2, 5);
  });

  it('clamps sand to the rock below and the highest pile, with warnings', async () => {
    const r = await parseBeachFile(file({ shapes: [{ type: 'mound', x: 8, y: 8, radius: 3, height: -3 }, { type: 'mound', x: 24, y: 24, radius: 3, height: 3 }, { type: 'mound', x: 24, y: 24, radius: 3, height: 3 }] }), { nx: N, ny: N });
    if (!r.ok) throw new Error('refused');
    expect(Math.min(...r.beach.delta)).toBeCloseTo(MIN_DELTA, 5);
    expect(Math.max(...r.beach.delta)).toBeCloseTo(MAX_RAISE, 5);
    expect(r.warnings.map((w) => w.path)).toEqual(['sand', 'sand']);
  });

  it('fixes objects: clamps, defaults, skips unknown items', async () => {
    const r = await parseBeachFile(
      file({
        objects: [
          { item: 'rock', x: 40, y: 10, size: 99 },
          { item: 'unicorn', x: 1, y: 1 },
          { item: 'flag', x: 16, y: 20, size: 3 },
          { item: 'driftwood', x: 3, y: 3 },
        ],
      }),
    );
    if (!r.ok) throw new Error('refused');
    const [rock, flag, wood] = r.beach.objects;
    expect(rock.x).toBeCloseTo(WORLD_SIZE_X - 0.3, 5);
    expect(rock.size).toBe(1.3);
    expect(flag.size).toBe(0.4); // fixed size: the file's size is ignored
    expect(wood.size).toBeGreaterThan(0.5);
    expect(wood.size).toBeLessThan(3.2);
    expect(wood.variant).toBe(r.beach.objects[2].variant); // deterministic
    expect(new Set(r.beach.objects.map((o) => o.id)).size).toBe(3);
    expect(r.warnings.map((w) => w.path)).toEqual(['objects[0].x', 'objects[0].size', 'objects[1].item']);
  });

  it('refuses broken files with JSON paths', async () => {
    const bad = async (text: string) => {
      const r = await parseBeachFile(text);
      expect(r.ok).toBe(false);
      return r.ok ? [] : r.errors.map((e) => e.path);
    };
    expect(await bad('{nope')).toEqual(['']);
    expect(await bad('[]')).toEqual(['']);
    expect(await bad(JSON.stringify({ format: 'other', version: 1 }))).toEqual(['format']);
    expect(await bad(file({ version: 2 }))).toEqual(['version']);
    expect(await bad(file({ sand: { nx: 4, ny: 8, unit: 'mm', encoding: 'rows', data: [] } }))).toEqual(['sand.nx']);
    expect(await bad(file({ sand: { nx: 8, ny: 8, unit: 'mm', encoding: 'int16le', data: 'AAAA' } }))).toEqual(['sand.data']);
    expect(await bad(file({ sand: { nx: 8, ny: 8, unit: 'mm', encoding: 'rows', data: Array(8).fill(Array(8).fill('x')) } }))).toEqual(['sand.data[0][0]']);
    expect(await bad(file({ objects: [{ item: 'rock', y: 3 }] }))).toEqual(['objects[0].x']);
    expect(await bad(file({ shapes: [{ type: 'line', from: [1], to: [2, 2], width: 1, height: 1 }] }))).toEqual(['shapes[0].from']);
    expect(await bad(' '.repeat(MAX_FILE_CHARS + 1))).toEqual(['']);
  });

  it('ignores unknown fields (forward compatible)', async () => {
    const r = await parseBeachFile(file({ future: { x: 1 }, objects: [{ item: 'rock', x: 5, y: 5, sparkle: true }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it('every example file parses with no warnings', async () => {
    const dir = new URL('../docs/examples/', import.meta.url);
    const names = readdirSync(dir).filter((f) => f.endsWith('.beach.json'));
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      const r = await parseBeachFile(readFileSync(new URL(n, dir), 'utf8'));
      if (!r.ok) throw new Error(`${n}: ${JSON.stringify(r.errors)}`);
      expect(r.warnings, n).toEqual([]);
    }
  });
});

describe('reconcileItems', () => {
  const o = (item: string, id: number): PlacedObject => ({ id, kind: 'rock', item, x: 1, y: 1, angle: 0, size: 0.5, variant: 1 });
  it('keeps free items, and owned ones up to what is not placed elsewhere', () => {
    const list = [o('rock', 1), o('deckchair', 2), o('deckchair', 3), o('starfish', 4), o('rock', 5)];
    const { keep, missing } = reconcileItems(list, new Map([['deckchair', 3], ['starfish', 1]]), new Map([['deckchair', 2]]));
    expect(keep.map((k) => k.id)).toEqual([1, 2, 4, 5]);
    expect(missing).toEqual([{ item: 'deckchair', need: 2, have: 1 }]);
  });
  it('nothing owned: only free items stay', () => {
    const { keep, missing } = reconcileItems([o('lighthouse', 1), o('flag', 2)], new Map());
    expect(keep.map((k) => k.id)).toEqual([2]);
    expect(missing).toEqual([{ item: 'lighthouse', need: 1, have: 0 }]);
  });
});

describe('the JSON Schema', () => {
  it('lists every catalog item and matches the reader’s limits', async () => {
    const { ITEMS } = await import('../src/world/items');
    const schema = JSON.parse(readFileSync(new URL('../docs/beach-file.schema.json', import.meta.url), 'utf8'));
    expect([...schema.properties.objects.items.properties.item.enum].sort()).toEqual(ITEMS.map((i) => i.id).sort());
    expect(schema.properties.objects.maxItems).toBe(MAX_OBJECTS);
    expect(schema.properties.shapes.maxItems).toBe(500);
  });
});
