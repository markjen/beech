import { describe, expect, it } from 'vitest';
import { decodeSand, encodeSand, resampleField } from '../src/sim/sandCodec';
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

  it('drops malformed objects from a saved beach', async () => {
    const { sanitizeObjects } = await import('../src/sim/sandCodec');
    const ok = { id: 1, kind: 'rock', item: 'rock', x: 3, y: 4, angle: 0, size: 0.4, variant: 1 };
    expect(sanitizeObjects([ok, { ...ok, id: 2, kind: 'boat' }, { ...ok, id: 3, x: NaN }, { ...ok }, null, 'x'])).toEqual([ok]);
    expect(sanitizeObjects({})).toEqual([]);
  });

  it('beaches saved in the old 32 x 24 world get the extra sea added offshore', async () => {
    const { fitWorld } = await import('../src/sim/sandCodec');
    const nx = 192;
    const ny = 144; // old low tier
    const delta = new Float32Array(nx * ny);
    delta[100 * nx + 50] = 0.3;
    const old = { nx, ny, delta, objects: [{ id: 1, kind: 'rock' as const, item: 'rock', x: 5, y: 20, angle: 0, size: 0.4, variant: 1 }] };
    const now = fitWorld(old);
    const dx = 32 / nx;
    expect(now.ny).toBe(Math.round(32 / dx));
    const pad = now.ny - ny;
    expect(now.delta[(100 + pad) * nx + 50]).toBeCloseTo(0.3, 6);
    expect(now.delta[0]).toBe(0);
    expect(now.objects[0].y).toBeCloseTo(20 + pad * dx, 6);
    // today's saves are left alone
    const fresh = { nx, ny: 192, delta: new Float32Array(nx * 192), objects: [] };
    expect(fitWorld(fresh)).toBe(fresh);
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
