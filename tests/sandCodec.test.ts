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
        const y = (j + 0.5) * a.dx - 12;
        src[j * a.nx + i] = Math.max(0, 1 - Math.hypot(x, y) / 3);
      }
    const out = resampleField(src, a.nx, a.ny, b.nx, b.ny);
    expect(out.length).toBe(b.nx * b.ny);
    const centre = out[Math.floor(b.ny / 2) * b.nx + Math.floor(b.nx / 2)];
    expect(centre).toBeGreaterThan(0.9);
    expect(out[0]).toBe(0);
  });
});
