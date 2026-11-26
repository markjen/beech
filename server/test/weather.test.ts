import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { buildReport, createWeather } from '../src/weather.js';
import { placeCoords } from '../src/generated/catchup.js';
import { openTestDb } from './testDb.js';

const PLACES = [
  { id: 'bondi', lat: -33.9, lon: 151.3 },
  { id: 'brighton', lat: 50.8, lon: -0.14 },
];

const forecast = (temp: number) =>
  PLACES.map(() => ({
    current: { temperature_2m: temp, weather_code: 61, cloud_cover: 90, precipitation: 1.2, wind_speed_10m: 20.04, wind_direction_10m: 200.4 },
  }));
const marine = [{ current: { wave_height: 1.234 } }, { current: { wave_height: null } }];

function fakeFetch(calls: string[], answer: (url: string) => unknown | Error) {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    const a = answer(u);
    if (a instanceof Error) throw a;
    return new Response(JSON.stringify(a), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('weather', () => {
  it('turns Open-Meteo answers into one report per place', () => {
    const r = buildReport(PLACES, forecast(14.26), marine, 1000);
    expect(r.at).toBe(1000);
    expect(r.places.bondi).toEqual({ temp: 14.3, code: 61, cloud: 0.9, rain: 1.2, wind: 20, windDir: 200, wave: 1.23 });
    expect(r.places.brighton.wave).toBeNull();
  });

  it('skips places with missing fields and copes with no marine data', () => {
    const f = forecast(10);
    (f[1].current as Record<string, unknown>).temperature_2m = null;
    const r = buildReport(PLACES, f, null, 1);
    expect(Object.keys(r.places)).toEqual(['bondi']);
    expect(r.places.bondi.wave).toBeNull();
  });

  it('asks for every place in one request, and caches it', async () => {
    let t = 0;
    const calls: string[] = [];
    const w = createWeather({
      places: PLACES,
      now: () => t,
      fetch: fakeFetch(calls, (u) => (u.includes('marine') ? marine : forecast(20))),
    });
    const a = await w.get();
    expect(a?.places.bondi.temp).toBe(20);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('latitude=-33.9,50.8');
    t += 10 * 60 * 1000;
    await w.get();
    expect(calls).toHaveLength(2); // still fresh
    t += 6 * 60 * 1000;
    await w.get();
    expect(calls).toHaveLength(4); // 16 minutes: refetched
  });

  it('shares one fetch between requests arriving together', async () => {
    const calls: string[] = [];
    const w = createWeather({ places: PLACES, fetch: fakeFetch(calls, (u) => (u.includes('marine') ? marine : forecast(1))) });
    await Promise.all([w.get(), w.get(), w.get()]);
    expect(calls).toHaveLength(2);
  });

  it('keeps the old report while Open-Meteo is down, then gives up', async () => {
    let t = 0;
    let down = false;
    const calls: string[] = [];
    const w = createWeather({
      places: PLACES,
      now: () => t,
      fetch: fakeFetch(calls, (u) => (down ? new Error('down') : u.includes('marine') ? marine : forecast(5))),
    });
    expect((await w.get())?.places.bondi.temp).toBe(5);
    down = true;
    t += 20 * 60 * 1000;
    expect((await w.get())?.places.bondi.temp).toBe(5);
    t += 4 * 60 * 60 * 1000;
    expect(await w.get()).toBeNull();
  });

  it('uses the customer hosts and the key on a paid plan', async () => {
    const calls: string[] = [];
    const w = createWeather({ places: PLACES, apiKey: 'k&1', fetch: fakeFetch(calls, (u) => (u.includes('marine') ? marine : forecast(3))) });
    await w.get();
    expect(calls[0]).toMatch(/^https:\/\/customer-api\.open-meteo\.com\//);
    expect(calls[1]).toMatch(/^https:\/\/customer-marine-api\.open-meteo\.com\//);
    for (const c of calls) expect(c).toContain('apikey=k%261');
    const free: string[] = [];
    await createWeather({ places: PLACES, fetch: fakeFetch(free, (u) => (u.includes('marine') ? marine : forecast(3))) }).get();
    for (const c of free) expect(c).not.toContain('apikey');
  });

  it('backs off and logs when the answer has nothing usable', async () => {
    let t = 0;
    const calls: string[] = [];
    const logged: string[] = [];
    const w = createWeather({
      places: PLACES,
      now: () => t,
      log: (e) => logged.push(e.event),
      fetch: fakeFetch(calls, () => ({ error: true })),
    });
    expect(await w.get()).toBeNull();
    expect(logged).toEqual(['weather_fetch_failed']);
    t += 30_000;
    await w.get();
    expect(calls).toHaveLength(2); // no retry within a minute
    t += 31_000;
    await w.get();
    expect(calls).toHaveLength(4);
  });

  it('knows every place in the game', () => {
    const ids = placeCoords().map((p) => p.id);
    expect(ids).toContain('bondi');
    expect(ids.length).toBeGreaterThanOrEqual(30);
  });

  it('serves GET /weather, and 503 when there is none', async () => {
    const db = await openTestDb();
    const calls: string[] = [];
    let ok = true;
    const weather = createWeather({
      places: PLACES,
      fetch: fakeFetch(calls, (u) => (!ok ? new Error('x') : u.includes('marine') ? marine : forecast(9))),
    });
    const app = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: false, weather });
    const res = await app.request('/weather');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { places: Record<string, { temp: number }> };
    expect(body.places.brighton.temp).toBe(9);

    ok = false;
    const empty = createApp(db, {
      googleClientIds: [],
      appleClientIds: [],
      allowedOrigins: [],
      devAuth: false,
      weather: createWeather({ places: PLACES, fetch: fakeFetch([], () => new Error('down')) }),
    });
    expect((await empty.request('/weather')).status).toBe(503);
  });
});
