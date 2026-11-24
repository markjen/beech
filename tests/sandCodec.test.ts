import { describe, expect, it } from 'vitest';
import { MAX_OBJECTS, decodeSand, encodeSand, objectsToSave, resampleField } from '../src/sim/sandCodec';
import type { PlacedObject } from '../src/sim/objects';
import { BeachSim } from '../src/sim/beachSim';
import { GRID_TIERS } from '../src/config';

describe('saved beach codec', () => {
  it('round-trips a dug beach to the millimetre and compresses well', async () => {
    const g = GRID_TIERS.medium;
    const sim = new BeachSim(g, 1, { waves: false, erosion: false, healing: false, seep: false });
    sim.stamp('dig', 12, 18, 0.6, 0.3);
    sim.stamp('pile', 20, 20, 0.8, 0.4);
    const delta = sim.sandDelta();
    const bytes = await encodeSand(delta, g.nx, g.ny);
    expect(bytes.length).toBeLessThan(8000); // raw is ~98 KB
    const back = await decodeSand(bytes);
    expect(back.nx).toBe(g.nx);
    let maxErr = 0;
    for (let k = 0; k < delta.length; k++) maxErr = Math.max(maxErr, Math.abs(back.delta[k] - delta[k]));
    expect(maxErr).toBeLessThanOrEqual(0.0005 + 1e-6);

    const fresh = new BeachSim(g, 1, { waves: false, erosion: false, healing: false, seep: false });
    fresh.loadDelta(back.delta);
    expect(Math.abs(fresh.sand[50 * g.nx + 60] - sim.sand[50 * g.nx + 60])).toBeLessThan(0.001);
  });

  it('saves placed rocks and driftwood (v2) and still reads v1', async () => {
    const g = GRID_TIERS.low;
    const sim = new BeachSim(g, 1, { waves: false, erosion: false, healing: false, seep: false });
    sim.stamp('dig', 12, 18, 0.6, 0.3);
    sim.placeObject({ kind: 'rock', item: 'rock', x: 16, y: 19, angle: 0.5, size: 0.4, variant: 3 });
    sim.placeObject({ kind: 'driftwood', item: 'driftwood', x: 10.123456, y: 20, angle: 1, size: 1.6, variant: 2 });
    const bytes = await encodeSand(sim.sandDelta(), g.nx, g.ny, sim.objects.persisted());
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('BCH2');
    const back = await decodeSand(bytes);
    expect(back.objects.map((o) => o.kind)).toEqual(['rock', 'driftwood']);
    expect(back.objects[1].x).toBeCloseTo(10.123, 3);
    const v1 = await decodeSand(await encodeSand(sim.sandDelta(), g.nx, g.ny));
    expect(String.fromCharCode(...(await encodeSand(sim.sandDelta(), g.nx, g.ny)).subarray(0, 4))).toBe('BCH1');
    expect(v1.objects).toEqual([]);
  });

  it('saves buried rock cover (v3) and preserves rock base', async () => {
    const g = GRID_TIERS.low;
    const cover = new Float32Array(g.nx * g.ny);
    cover[10 * g.nx + 20] = 0.234;
    const objects: PlacedObject[] = [
      { id: 1, kind: 'rock', item: 'rock', x: 16, y: 19, angle: 0.5, size: 0.4, variant: 3, base: 0.4567 },
    ];
    const bytes = await encodeSand(new Float32Array(g.nx * g.ny), g.nx, g.ny, objects, cover);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('BCH3');
    const back = await decodeSand(bytes);
    expect(back.objects[0].base).toBeCloseTo(0.457, 3);
    expect(back.cover?.[10 * g.nx + 20]).toBeCloseTo(0.234, 3);
    // all-zero cover still writes BCH2
    const b2 = await encodeSand(new Float32Array(g.nx * g.ny), g.nx, g.ny, objects, new Float32Array(g.nx * g.ny));
    expect(String.fromCharCode(...b2.subarray(0, 4))).toBe('BCH2');
    // truncated BCH3 is rejected
    await expect(decodeSand(bytes.subarray(0, 14))).rejects.toThrow();
    await expect(decodeSand(bytes.subarray(0, bytes.length - 4))).rejects.toThrow();
  });

  it('drops malformed objects from a saved beach', async () => {
    const { sanitizeObjects } = await import('../src/sim/sandCodec');
    const ok = { id: 1, kind: 'rock', item: 'rock', x: 3, y: 4, angle: 0, size: 0.4, variant: 1 };
    const withBase = { ...ok, id: 4, base: 0.65 };
    const badBase = { ...ok, id: 5, base: 99 };
    expect(sanitizeObjects([ok, withBase, badBase, { ...ok, id: 2, kind: 'boat' }, { ...ok, id: 3, x: NaN }, { ...ok }, null, 'x'])).toEqual([
      ok,
      withBase,
      { ...ok, id: 5 },
    ]);
    expect(sanitizeObjects({})).toEqual([]);
  });

  it('beaches saved in the old 32 x 24 world get the extra sea added offshore', async () => {
    const { fitWorld } = await import('../src/sim/sandCodec');
    const nx = 192;
    const ny = 144; // old low tier
    const delta = new Float32Array(nx * ny);
    delta[100 * nx + 50] = 0.3;
    const cover = new Float32Array(nx * ny);
    cover[100 * nx + 50] = 0.15;
    const old = { nx, ny, delta, cover, objects: [{ id: 1, kind: 'rock' as const, item: 'rock', x: 5, y: 20, angle: 0, size: 0.4, variant: 1 }] };
    const now = fitWorld(old);
    const dx = 32 / nx;
    expect(now.ny).toBe(Math.round(32 / dx));
    const pad = now.ny - ny;
    expect(now.delta[(100 + pad) * nx + 50]).toBeCloseTo(0.3, 6);
    expect(now.cover![(100 + pad) * nx + 50]).toBeCloseTo(0.15, 6);
    expect(now.delta[0]).toBe(0);
    expect(now.cover![0]).toBe(0);
    expect(now.objects[0].y).toBeCloseTo(20 + pad * dx, 6);
    // today's saves are left alone
    const fresh = { nx, ny: 192, delta: new Float32Array(nx * 192), objects: [] };
    expect(fitWorld(fresh)).toBe(fresh);
  });

  it('puts back things an out-of-date app pushed off the beach', async () => {
    const { fitWorld } = await import('../src/sim/sandCodec');
    const flag = (id: number, y: number) => ({ id, kind: 'flag' as const, item: 'flag', x: 5, y, angle: 0, size: 0.4, variant: 0 });
    const nx = 192;
    // the old app squeezed a 32 x 32 beach into 32 x 24 but kept the objects
    // where they were (some past its own land edge): don't move them again
    const squeezed = { nx, ny: 144, delta: new Float32Array(nx * 144), objects: [flag(1, 10), flag(2, 30)] };
    expect(fitWorld(squeezed).objects.map((o) => o.y)).toEqual([10, 30]);
    // already shifted once or twice (saved again by today's app): fold them back on
    const square = { nx, ny: 192, delta: new Float32Array(nx * 192), objects: [flag(1, 20), flag(2, 38), flag(3, 47), flag(4, 63)] };
    const ys = fitWorld(square).objects.map((o) => o.y);
    expect(ys).toEqual([20, 30, 31, 31]);
    for (const y of ys) expect(y).toBeLessThanOrEqual(32 - 0.3);
  });

  it('rejects garbage', async () => {
    await expect(decodeSand(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toThrow();
  });

  it('resamples between quality tiers', () => {
    const a = GRID_TIERS.high;
    const b = GRID_TIERS.low;
    const src = new Float32Array(a.nx * a.ny);
    // a 1 m bump in the middle of the world
    for (let j = 0; j < a.ny; j++)
      for (let i = 0; i < a.nx; i++) {
        const x = (i + 0.5) * a.dx - 16;
        const y = (j + 0.5) * a.dx - (a.ny * a.dx) / 2;
        src[j * a.nx + i] = Math.max(0, 1 - Math.hypot(x, y) / 3);
      }
    const out = resampleField(src, a.nx, a.ny, b.nx, b.ny);
    expect(out.length).toBe(b.nx * b.ny);
    const centre = out[Math.floor(b.ny / 2) * b.nx + Math.floor(b.nx / 2)];
    expect(centre).toBeGreaterThan(0.9);
    expect(out[0]).toBe(0);
  });
});

describe('the object limit', () => {
  const obj = (id: number, wild = false): PlacedObject => ({ id, kind: 'rock', item: 'rock', x: 5, y: 20, angle: 0, size: 0.3, variant: 1, ...(wild ? { wild } : {}) });
  it('saves your things before the wild ones, and counts what did not fit', () => {
    const wild = [obj(1, true), obj(2, true)];
    const mine = Array.from({ length: MAX_OBJECTS + 3 }, (_, i) => obj(10 + i));
    const { keep, dropped } = objectsToSave([...wild, ...mine]);
    expect(keep.length).toBe(MAX_OBJECTS);
    expect(keep.every((o) => !o.wild)).toBe(true);
    expect(keep[0].id).toBe(10); // the oldest of yours stay
    expect(dropped).toBe(3);
  });
  it('keeps everything when it fits', async () => {
    const all = [obj(1, true), obj(2), obj(3)];
    expect(objectsToSave(all)).toEqual({ keep: [obj(2), obj(3), obj(1, true)], dropped: 0 });
    const back = await decodeSand(await encodeSand(new Float32Array(64), 8, 8, all));
    expect(back.objects.map((o) => o.id)).toEqual([2, 3, 1]);
  });
});
