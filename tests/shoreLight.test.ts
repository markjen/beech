import { describe, expect, it } from 'vitest';
import { SHORE_LIGHT } from '../src/config';
import { migrateSettings } from '../src/ui/settingsStore';
import { LiveConditions } from '../src/world/live';
import { BEACHES } from '../src/world/locations';
import { mixLive, shoreLightMix } from '../src/world/shoreLight';

const places = [
  { x: 0, location: 'a' },
  { x: 30, location: 'b' },
  { x: -30, location: 'c' },
];

describe('shore light: each beach its own place', () => {
  it('keeps a beach’s own light around its centre', () => {
    expect(shoreLightMix(0, places)).toEqual({ a: 'a', b: 'a', t: 0 });
    const edge = (30 * (1 - SHORE_LIGHT.blendSpan)) / 2;
    expect(shoreLightMix(edge - 0.1, places)).toEqual({ a: 'a', b: 'a', t: 0 });
    expect(shoreLightMix(30 - edge + 0.1, places)).toEqual({ a: 'b', b: 'b', t: 0 });
  });

  it('crosses over smoothly and steadily between neighbours', () => {
    const mid = shoreLightMix(15, places)!;
    expect(mid.a).toBe('a');
    expect(mid.b).toBe('b');
    expect(mid.t).toBeCloseTo(0.5, 6);
    // how much of b's light shows, walking from a's centre to b's
    let prev = 0;
    for (let x = 0; x <= 30; x += 0.5) {
      const m = shoreLightMix(x, places)!;
      const share = m.b === 'b' ? (m.a === 'b' ? 1 : m.t) : 0;
      expect(share).toBeGreaterThanOrEqual(prev);
      expect(share - prev).toBeLessThan(0.1);
      prev = share;
    }
    expect(prev).toBe(1);
    expect(shoreLightMix(-15, places)).toMatchObject({ a: 'c', b: 'a' });
  });

  it('holds the end beach’s light past the shore’s ends, and none without beaches', () => {
    expect(shoreLightMix(500, places)).toEqual({ a: 'b', b: 'b', t: 0 });
    expect(shoreLightMix(-500, places)).toEqual({ a: 'c', b: 'c', t: 0 });
    expect(shoreLightMix(3, [])).toBeNull();
  });

  it('does not blend between two beaches at the same place', () => {
    expect(shoreLightMix(15, [{ x: 0, location: 'a' }, { x: 30, location: 'a' }])).toEqual({ a: 'a', b: 'a', t: 0 });
  });

  it('blends the light of two real places, ends exact', () => {
    // midday in one place, night in the other
    const now = new Date('2026-06-21T20:00:00Z');
    const [p, q] = [BEACHES[0], BEACHES.find((b) => Math.abs(b.lon - BEACHES[0].lon) > 90)!];
    const a = new LiveConditions(p).compute(now);
    const b = new LiveConditions(q).compute(now);
    expect(mixLive(a, b, 0)).toBe(a);
    expect(mixLive(a, b, 1)).toBe(b);
    const m = mixLive(a, b, 0.5);
    expect(m.sky.night).toBeCloseTo((a.sky.night + b.sky.night) / 2, 6);
    expect(Math.hypot(...m.sky.sun.dir)).toBeCloseTo(1, 6);
    expect(Math.hypot(...m.palette.sunDir)).toBeCloseTo(1, 6);
    for (const k of [0, 1, 2]) {
      const lo = Math.min(a.palette.fog[k], b.palette.fog[k]);
      const hi = Math.max(a.palette.fog[k], b.palette.fog[k]);
      expect(m.palette.fog[k]).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(m.palette.fog[k]).toBeLessThanOrEqual(hi + 1e-9);
    }
  });
});

describe('local weather setting', () => {
  it('is on by default with day light preselected', () => {
    expect(migrateSettings({})).toMatchObject({ localWeather: true, palette: 'day' });
  });

  it('carries over the old single light choice', () => {
    expect(migrateSettings({ palette: 'live' as never })).toMatchObject({ localWeather: true, palette: 'day' });
    expect(migrateSettings({ palette: 'cycle' as never })).toMatchObject({ localWeather: true, palette: 'day' });
    expect(migrateSettings({ palette: 'dusk' })).toMatchObject({ localWeather: false, palette: 'dusk' });
    expect(migrateSettings({ palette: 'night', localWeather: true })).toMatchObject({ localWeather: true, palette: 'night' });
  });
});
