import { describe, expect, it } from 'vitest';
import { diorama, LiveConditions, sceneDirection, tideWaveScale } from '../src/world/live';
import { BEACHES, beachById, defaultBeach, nearestBeach } from '../src/world/locations';

describe('real-world beach', () => {
  it('points the sea direction at -Z and the right hand at -X', () => {
    const out = sceneDirection({ bearing: 115, elevation: 0 }, 115);
    expect(out[2]).toBeCloseTo(-1, 6);
    const right = sceneDirection({ bearing: 205, elevation: 0 }, 115);
    expect(right[0]).toBeCloseTo(-1, 6);
    const up = sceneDirection({ bearing: 0, elevation: 90 }, 115);
    expect(up[1]).toBeCloseTo(1, 6);
  });

  it('squashes big tides more than small ones but keeps their sign', () => {
    expect(diorama(0)).toBe(0);
    expect(diorama(-0.2)).toBeLessThan(0);
    expect(diorama(3)).toBeLessThan(0.3);
    expect(diorama(3) / 3).toBeLessThan(diorama(0.3) / 0.3);
  });

  it('scales default waves stronger at high tide and weaker at low tide', () => {
    expect(tideWaveScale(0.9, 1.0, 1.0)).toBeGreaterThan(0.9);
    expect(tideWaveScale(0.9, -1.0, 1.0)).toBeLessThan(0.9);
    expect(tideWaveScale(0.9, 0, 1.0)).toBeCloseTo(0.9, 6);
    // beaches with almost no tide stay at their baseline
    expect(tideWaveScale(0.45, 0.05, 0.08)).toBe(0.45);
    // live schedule follows actual high and low tide extremes
    const brighton = beachById('brighton')!;
    const live = new LiveConditions(brighton);
    const s0 = live.compute(new Date('2026-11-22T12:00:00Z'));
    const high = s0.next.find((e) => e.kind === 'high')!;
    const low = s0.next.find((e) => e.kind === 'low')!;
    expect(live.compute(high.time).waves).toBeGreaterThan(brighton.waves);
    expect(live.compute(low.time).waves).toBeLessThan(brighton.waves);
  });

  it('every beach has tide data from a nearby gauge', () => {
    for (const b of BEACHES) {
      expect(b.tide.M2, b.id).toBeTruthy();
      expect(b.gaugeKm, b.id).toBeLessThan(70);
      expect(b.waves).toBeLessThanOrEqual(1.2);
    }
  });

  it('is night in Brighton at 10 pm and day at noon', () => {
    const live = new LiveConditions(beachById('brighton')!);
    expect(live.compute(new Date('2026-11-22T22:00:00Z')).sky.night).toBeGreaterThan(0.9);
    expect(live.compute(new Date('2026-11-22T12:00:00Z')).sky.night).toBe(0);
  });

  it('finds the nearest beach and has a default', () => {
    expect(nearestBeach(-33.9, 151.2).id).toBe('bondi');
    expect(nearestBeach(51.5, -0.1).id).toBe('brighton');
    expect(defaultBeach()).toBeTruthy();
  });

  it('describes the moment', () => {
    const live = new LiveConditions(beachById('waikiki')!);
    const s = live.compute(new Date('2026-11-22T22:00:00Z'));
    expect(live.describe(s)).toMatch(/tide (rising|falling)/);
  });
});
