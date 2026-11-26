// Real weather at every place a beach can sit at (src/world/locations.ts),
// for GET /api/weather. One request to Open-Meteo's forecast API and one to
// its marine API cover all the places at once (they take lists of
// coordinates). The answer is kept for 15 minutes and shared by every
// player, so the upstream load doesn't grow with players, and the app never
// talks to a third party: no player's location or IP leaves our server.
//
// Open-Meteo: https://open-meteo.com (CC-BY 4.0 data). Its free API is for
// non-commercial use; with OPEN_METEO_API_KEY set (a paid plan), requests go
// to the customer endpoints with the key instead.
import { placeCoords } from './generated/catchup.js';

/** One place's weather (the same shape as PlaceWeather in src/world/weather.ts). */
export interface PlaceWeather {
  temp: number;
  code: number;
  cloud: number;
  rain: number;
  wind: number;
  windDir: number;
  wave: number | null;
}

export interface WeatherReport {
  at: number;
  places: Record<string, PlaceWeather>;
}

export interface WeatherOptions {
  fetch?: typeof fetch;
  now?: () => number;
  /** how long a report is served before refetching (ms) */
  ttlMs?: number;
  /** after a failed fetch, keep serving the old report this long (ms) */
  staleMs?: number;
  /** wait at most this long for Open-Meteo (ms) */
  timeoutMs?: number;
  places?: { id: string; lat: number; lon: number }[];
  /** Open-Meteo API key (paid plan): uses the customer-* hosts */
  apiKey?: string;
  /** told about each failed fetch */
  log?: (event: { event: string; error: string }) => void;
}

const hosts = (apiKey: string | undefined) =>
  apiKey
    ? { forecast: 'https://customer-api.open-meteo.com/v1/forecast', marine: 'https://customer-marine-api.open-meteo.com/v1/marine' }
    : { forecast: 'https://api.open-meteo.com/v1/forecast', marine: 'https://marine-api.open-meteo.com/v1/marine' };
const FORECAST_FIELDS = 'temperature_2m,weather_code,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m';

type Current = Record<string, number | null | undefined>;
const currentOf = (x: unknown): Current | undefined =>
  x && typeof x === 'object' ? ((x as { current?: Current }).current ?? undefined) : undefined;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Builds a report from Open-Meteo's two answers (lists in the order of `places`). */
export function buildReport(
  places: { id: string }[],
  forecast: unknown,
  marine: unknown,
  at: number,
): WeatherReport {
  // one place comes back as an object, several as a list
  const f = Array.isArray(forecast) ? forecast : [forecast];
  const m = Array.isArray(marine) ? marine : marine ? [marine] : [];
  const out: Record<string, PlaceWeather> = {};
  places.forEach((p, i) => {
    const c = currentOf(f[i]);
    if (!c) return;
    const { temperature_2m: temp, weather_code: code, cloud_cover: cloud, precipitation: rain } = c;
    const { wind_speed_10m: wind, wind_direction_10m: windDir } = c;
    if (!finite(temp) || !finite(code) || !finite(cloud) || !finite(wind) || !finite(windDir)) return;
    const wave = currentOf(m[i])?.wave_height;
    out[p.id] = {
      temp: Math.round(temp * 10) / 10,
      code,
      cloud: Math.min(1, Math.max(0, cloud / 100)),
      rain: finite(rain) ? Math.max(0, rain) : 0,
      wind: Math.round(wind * 10) / 10,
      windDir: Math.round(windDir),
      wave: finite(wave) ? Math.round(wave * 100) / 100 : null,
    };
  });
  return { at, places: out };
}

/** The cached, shared weather; `get()` refetches when the report is old. */
export function createWeather(opts: WeatherOptions = {}) {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? 15 * 60 * 1000;
  const stale = opts.staleMs ?? 3 * 60 * 60 * 1000;
  const timeout = opts.timeoutMs ?? 8000;
  const places = opts.places ?? placeCoords();
  const { forecast: FORECAST, marine: MARINE } = hosts(opts.apiKey);
  const key = opts.apiKey ? `&apikey=${encodeURIComponent(opts.apiKey)}` : '';
  let report: WeatherReport | null = null;
  let inFlight: Promise<WeatherReport | null> | null = null;
  let failedAt = -Infinity;

  const getJson = async (url: string): Promise<unknown> => {
    const res = await doFetch(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    return res.json();
  };

  const refresh = async (): Promise<WeatherReport | null> => {
    const lat = places.map((p) => p.lat).join(',');
    const lon = places.map((p) => p.lon).join(',');
    const q = `latitude=${lat}&longitude=${lon}&timezone=GMT${key}`;
    try {
      const [forecast, marine] = await Promise.all([
        getJson(`${FORECAST}?${q}&current=${FORECAST_FIELDS}`),
        // the sea model is a bonus: without it the beaches keep their usual swell
        getJson(`${MARINE}?${q}&current=wave_height`).catch(() => null),
      ]);
      const r = buildReport(places, forecast, marine, now());
      if (!Object.keys(r.places).length) throw new Error('no usable places in the answer');
      report = r;
      return report;
    } catch (e) {
      failedAt = now();
      opts.log?.({ event: 'weather_fetch_failed', error: String(e) });
      return report;
    }
  };

  return {
    /** The current report: cached, refreshed when old, the old one while Open-Meteo is down. */
    async get(): Promise<WeatherReport | null> {
      const t = now();
      const fresh = report && t - report.at < ttl;
      // after a failure, wait a minute before trying again
      if (fresh || t - failedAt < 60_000) return report && t - report.at < stale ? report : null;
      inFlight ??= refresh().finally(() => {
        inFlight = null;
      });
      const r = await inFlight;
      return r && now() - r.at < stale ? r : null;
    },
  };
}
