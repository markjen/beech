import { describe, expect, it } from 'vitest';
import { catchUpSaved } from '../src/world/catchupBeach';
import { decodeSand, encodeSand } from '../src/sim/sandCodec';
import { castle, g, SHORE } from './catchup.fixture';

const DAY = 86400000;
const T0 = Date.UTC(2026, 10, 1);

describe('catching up a saved beach (docs/LIVE_SIM.md)', () => {
  it('saves washed-away footprints even when no sand moved and no strays came in', async () => {
    const delta = new Float32Array(g.nx * g.ny);
    const wet = { id: 1, kind: 'footprints' as const, item: 'footprints', x: 10, y: SHORE - 3, angle: 0, size: 1, variant: 1 };
    const dry = { ...wet, id: 2, y: 29 };
    const bytes = await encodeSand(delta, g.nx, g.ny, [wet, dry]);
    const out = (await catchUpSaved(bytes, 'brighton', T0, T0 + 60_000))!;
    expect(out.changed).toBe(true);
    expect(out.sandMoved).toBe(0);
    expect(out.broughtIn).toBe(0);
    expect(out.lost).toEqual([]);
    expect((await decodeSand(out.bytes)).objects).toEqual([dry]);
  });

  it('wears down a waterline castle at its real place and keeps buried rocks’ cover', async () => {
    const delta = new Float32Array(g.nx * g.ny);
    castle(delta, 10, SHORE + 0.5);
    const cover = new Float32Array(g.nx * g.ny);
    cover[50 * g.nx + 40] = 0.2;
    const rock = { id: 1, kind: 'rock' as const, item: 'rock', x: 7, y: 8, angle: 0, size: 0.4, variant: 1 };
    const bytes = await encodeSand(delta, g.nx, g.ny, [rock], cover);
    const out = (await catchUpSaved(bytes, 'brighton', T0, T0 + 2 * DAY))!;
    expect(out.changed).toBe(true);
    expect(out.highTides).toBeGreaterThanOrEqual(3);
    const back = await decodeSand(out.bytes);
    expect(back.objects.find((o) => o.id === 1)).toBeDefined();
    expect(back.cover?.[50 * g.nx + 40]).toBeCloseTo(0.2, 3);
    let top = 0;
    for (const v of back.delta) top = Math.max(top, v);
    expect(top).toBeLessThan(0.3);
  });

  it('an unknown place: nothing to take the tide from', async () => {
    const bytes = await encodeSand(new Float32Array(g.nx * g.ny), g.nx, g.ny);
    expect(await catchUpSaved(bytes, 'atlantis', T0, T0 + DAY)).toBeNull();
  });
});
