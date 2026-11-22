import { describe, expect, it } from 'vitest';
import { moonIllumination, sunPosition } from '../src/world/astro';

describe('sun and moon', () => {
  it('puts the summer-solstice noon sun high over Sydney, due north', () => {
    // local solar noon in Sydney (151.2 E) is about 01:57 UTC
    const p = sunPosition(new Date('2026-12-21T01:57:00Z'), -33.87, 151.21);
    expect(p.elevation).toBeGreaterThan(78);
    expect(p.elevation).toBeLessThan(81);
    expect(Math.min(p.bearing, 360 - p.bearing)).toBeLessThan(5);
  });

  it('has the sun near the horizon in the east at an equinox sunrise on the equator', () => {
    const p = sunPosition(new Date('2026-03-20T06:07:00Z'), 0, 0);
    expect(Math.abs(p.elevation)).toBeLessThan(1.5);
    expect(Math.abs(p.bearing - 90)).toBeLessThan(2);
  });

  it('knows a full moon from a new moon', () => {
    // full moon 2026-12-24, new moon 2026-12-09 (approximately)
    expect(moonIllumination(new Date('2026-12-24T01:00:00Z')).fraction).toBeGreaterThan(0.97);
    expect(moonIllumination(new Date('2026-12-09T00:00:00Z')).fraction).toBeLessThan(0.05);
  });
});
