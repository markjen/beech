import { afterEach, describe, expect, it } from 'vitest';
import { WEATHER } from '../src/config';
import { paletteByName } from '../src/palette';
import { LiveConditions } from '../src/world/live';
import { BEACHES, beachById } from '../src/world/locations';
import {
  applyWeather,
  CLEAR_LOOK,
  describeWeather,
  fakeReport,
  mixLook,
  parseWeatherReport,
  setWeatherReport,
  skyKind,
  usesFahrenheit,
  weatherFor,
  weatherLook,
  weatherWaves,
  type PlaceWeather,
} from '../src/world/weather';

const base: PlaceWeather = { temp: 18, code: 0, cloud: 0.1, rain: 0, wind: 10, windDir: 0, wave: 1 };
const grey = (c: number[]) => Math.max(...c) - Math.min(...c);

afterEach(() => setWeatherReport(null));

describe('real weather', () => {
  it('reads WMO codes', () => {
    expect(skyKind(0)).toBe('clear');
    expect(skyKind(2)).toBe('partly');
    expect(skyKind(3)).toBe('cloudy');
    expect(skyKind(45)).toBe('fog');
    expect(skyKind(53)).toBe('drizzle');
    expect(skyKind(63)).toBe('rain');
    expect(skyKind(81)).toBe('rain');
    expect(skyKind(73)).toBe('snow');
    expect(skyKind(86)).toBe('snow');
    expect(skyKind(95)).toBe('storm');
  });

  it('clear skies look clear, rain looks wet and grey', () => {
    expect(weatherLook(undefined)).toEqual(CLEAR_LOOK);
    const clear = weatherLook(base);
    expect(clear.overcast).toBe(0);
    expect(clear.rain).toBe(0);
    const rain = weatherLook({ ...base, code: 63, cloud: 1, rain: 3 });
    expect(rain.overcast).toBeGreaterThan(0.7);
    expect(rain.rain).toBeGreaterThan(0.6);
    expect(rain.snow).toBe(false);
    expect(weatherLook({ ...base, code: 73, cloud: 1, rain: 1 }).snow).toBe(true);
    expect(weatherLook({ ...base, code: 45 }).fog).toBe(1);
  });

  it('slants rain with the wind across the beach', () => {
    // beach faces south (180): wind from the east (90) blows to the west, which is on your right
    expect(weatherLook({ ...base, wind: 40, windDir: 90 }, 180).wind).toBeGreaterThan(0.5);
    expect(weatherLook({ ...base, wind: 40, windDir: 270 }, 180).wind).toBeLessThan(-0.5);
    // straight onshore: no slant
    expect(Math.abs(weatherLook({ ...base, wind: 40, windDir: 180 }, 180).wind)).toBeLessThan(1e-9);
  });

  it('keeps the falling kind while easing in or out', () => {
    const snow = weatherLook({ ...base, code: 73, cloud: 1, rain: 1 });
    expect(mixLook(CLEAR_LOOK, snow, 0.1).snow).toBe(true);
    expect(mixLook(snow, CLEAR_LOOK, 0.9).snow).toBe(true);
  });

  it('greys the day sky and flattens the light under cloud', () => {
    const day = paletteByName('day');
    expect(applyWeather(day, CLEAR_LOOK, 0)).toBe(day);
    const o = applyWeather(day, weatherLook({ ...base, code: 3, cloud: 1 }), 0);
    expect(grey(o.skyTop)).toBeLessThan(grey(day.skyTop));
    expect(o.sun[0] + o.sun[1] + o.sun[2]).toBeLessThan(day.sun[0] + day.sun[1] + day.sun[2]);
    for (const c of [o.skyTop, o.skyBottom, o.sun, o.fog, o.farOcean]) for (const v of c) expect(v).toBeGreaterThanOrEqual(0);
    // night stays dark under cloud
    const night = paletteByName('night');
    const n = applyWeather(night, weatherLook({ ...base, code: 3, cloud: 1 }), 1);
    expect(n.skyTop[0] + n.skyTop[1] + n.skyTop[2]).toBeLessThan(1.2);
  });

  it('follows the measured sea, within the range the sim is tuned for', () => {
    const flat = weatherWaves(1, { ...base, wave: 0.05 }, 180);
    const big = weatherWaves(0.5, { ...base, wave: 4 }, 180);
    expect(flat).toBeLessThan(0.8);
    expect(big).toBeGreaterThan(0.9);
    for (const wave of [0, 0.3, 1, 2, 3, 6, 12]) {
      for (const b of BEACHES) {
        const v = weatherWaves(b.waves, { ...base, wave, wind: 80, windDir: b.facing }, b.facing);
        expect(v).toBeGreaterThanOrEqual(WEATHER.waveMin);
        expect(v).toBeLessThanOrEqual(WEATHER.waveMax);
      }
    }
    // an onshore wind adds chop, an offshore one doesn't
    const on = weatherWaves(0.8, { ...base, wave: null, wind: 45, windDir: 180 }, 180);
    const off = weatherWaves(0.8, { ...base, wave: null, wind: 45, windDir: 0 }, 180);
    expect(on).toBeGreaterThan(off);
    expect(off).toBe(0.8);
    expect(weatherWaves(0.7, undefined, 0)).toBe(0.7);
  });

  it('checks server answers place by place', () => {
    expect(parseWeatherReport(null)).toBeNull();
    expect(parseWeatherReport({ places: {} })).toBeNull();
    const r = parseWeatherReport({
      at: 5,
      places: { bondi: { ...base, cloud: 3, wave: null }, bad: { temp: 'hot' }, nul: null },
    });
    expect(Object.keys(r!.places)).toEqual(['bondi']);
    expect(r!.places.bondi.cloud).toBe(1);
    expect(r!.places.bondi.wave).toBeNull();
  });

  it('ignores a stale report', () => {
    setWeatherReport({ at: 0, places: { bondi: base } });
    expect(weatherFor('bondi', 1000)).toEqual(base);
    expect(weatherFor('bondi', WEATHER.staleMs + 1)).toBeUndefined();
    expect(weatherFor(undefined, 0)).toBeUndefined();
  });

  it('says it in words, in the local unit', () => {
    expect(usesFahrenheit('en-US')).toBe(true);
    expect(usesFahrenheit('en-GB')).toBe(false);
    expect(usesFahrenheit(undefined)).toBe(false);
    expect(describeWeather({ ...base, code: 63, temp: 14.4 }, false)).toBe('☂ rain 14°C');
    expect(describeWeather({ ...base, temp: 20 }, true, true)).toBe('☾ clear 68°F');
  });

  it('reaches the live beach: grey light and the real sea', () => {
    const b = beachById('brighton')!;
    const now = new Date('2026-06-21T12:00:00Z');
    const lc = new LiveConditions(b);
    const before = lc.compute(now);
    expect(before.weather).toBeUndefined();
    setWeatherReport(fakeReport([b.id], 63, now.getTime()));
    const after = lc.compute(now);
    expect(after.weather?.code).toBe(63);
    // the first report shows at once
    expect(after.look.rain).toBeGreaterThan(0.4);
    expect(grey(after.palette.skyTop)).toBeLessThan(grey(before.palette.skyTop));
    // a chosen palette stays as chosen, but the sea is still the real one
    const fixed = lc.compute(now, 'golden');
    expect(fixed.look).toEqual(CLEAR_LOOK);
    expect(fixed.waves).toBe(after.waves);
  });
});
