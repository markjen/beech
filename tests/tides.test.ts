import { describe, expect, it } from 'vitest';
import honolulu from './fixtures/noaa-honolulu-20261122.json';
import santaMonica from './fixtures/noaa-santamonica-20261122.json';
import stations from '../src/world/tideStations.json';
import { nextExtremes, speed, tideHeight, type Constituents } from '../src/world/tides';

type Pred = { predictions: { t: string; v: string }[] };

function compare(fixture: Pred, cons: Constituents) {
  let se = 0;
  let n = 0;
  let maxErr = 0;
  for (const p of fixture.predictions) {
    const t = new Date(p.t.replace(' ', 'T') + ':00Z');
    const err = tideHeight(cons, t) - Number(p.v);
    se += err * err;
    maxErr = Math.max(maxErr, Math.abs(err));
    n++;
  }
  return { rms: Math.sqrt(se / n), maxErr };
}

describe('tide engine', () => {
  it('has the textbook constituent speeds', () => {
    expect(speed('M2')).toBeCloseTo(28.9841042, 5);
    expect(speed('S2')).toBeCloseTo(30.0, 5);
    expect(speed('K1')).toBeCloseTo(15.0410686, 5);
    expect(speed('O1')).toBeCloseTo(13.9430356, 5);
    expect(speed('N2')).toBeCloseTo(28.4397295, 5);
  });

  it('matches NOAA predictions at Honolulu using the TICON gauge for Waikiki', () => {
    const { rms } = compare(honolulu as Pred, stations.stations.waikiki.cons as unknown as Constituents);
    console.log('Honolulu rms', rms.toFixed(3));
    expect(rms).toBeLessThan(0.04);
  });

  it('matches NOAA predictions at Santa Monica', () => {
    const { rms } = compare(santaMonica as Pred, stations.stations.santamonica.cons as unknown as Constituents);
    console.log('Santa Monica rms', rms.toFixed(3));
    expect(rms).toBeLessThan(0.08);
  });

  it('finds alternating highs and lows', () => {
    const ex = nextExtremes(stations.stations.bondi.cons as unknown as Constituents, new Date('2026-11-22T00:00:00Z'), 4);
    expect(ex).toHaveLength(4);
    for (let i = 1; i < ex.length; i++) {
      expect(ex[i].kind).not.toBe(ex[i - 1].kind);
      const gapH = (ex[i].time.getTime() - ex[i - 1].time.getTime()) / 3600000;
      expect(gapH).toBeGreaterThan(4);
      expect(gapH).toBeLessThan(8);
    }
  });
});

describe('tide times', () => {
  it('predicts Honolulu highs and lows within 20 minutes of NOAA', async () => {
    const hilo = (await import('./fixtures/noaa-honolulu-hilo-20261122.json')).default as {
      predictions: { t: string; type: 'H' | 'L' }[];
    };
    const cons = stations.stations.waikiki.cons as unknown as Constituents;
    const ours = nextExtremes(cons, new Date('2026-11-22T00:00:00Z'), 10);
    const start = new Date('2026-11-22T00:00:00Z').getTime();
    let checked = 0;
    for (const p of hilo.predictions) {
      const t = new Date(p.t.replace(' ', 'T') + ':00Z').getTime();
      if (t - start > 24 * 3600000) continue; // nextExtremes looks 26 h ahead
      checked++;
      const match = ours.find((e) => e.kind === (p.type === 'H' ? 'high' : 'low') && Math.abs(e.time.getTime() - t) < 3 * 3600000);
      expect(match, `no ${p.type} near ${p.t}`).toBeTruthy();
      expect(Math.abs(match!.time.getTime() - t) / 60000).toBeLessThan(20);
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});
