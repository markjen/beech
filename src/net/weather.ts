import { WEATHER } from '../config';
import { parseWeatherReport, setWeatherReport, type WeatherReport } from '../world/weather';

/**
 * Fetches the weather for every place from our server (GET /api/weather),
 * now and every 15 minutes while the app is open. The last report is kept
 * on the device so the sky is right from the first frame next time.
 * Production builds only (ACCOUNTS_ENABLED): the sandbox stays offline.
 */

const KEY = 'beech.weather';
const API = String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export function weatherUrl(base = API): string {
  return base ? `${base}/api/weather` : '/api/weather';
}

function loadCached(): WeatherReport | null {
  try {
    const raw = localStorage.getItem(KEY);
    const r = raw ? parseWeatherReport(JSON.parse(raw)) : null;
    return r && Date.now() - r.at < WEATHER.staleMs ? r : null;
  } catch {
    return null;
  }
}

function saveCached(r: WeatherReport): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* private mode or full: fine, next load fetches again */
  }
}

/** Starts fetching; `changed` runs after each new report. Returns a stop function. */
export function startWeather(changed: () => void, fetchImpl: typeof fetch = fetch): () => void {
  const cached = loadCached();
  if (cached) {
    setWeatherReport(cached);
    changed();
  }
  let stopped = false;
  let timer = 0;
  const tick = async () => {
    if (stopped) return;
    try {
      const res = await fetchImpl(weatherUrl(), { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const r = parseWeatherReport(await res.json());
        if (r && !stopped) {
          setWeatherReport(r);
          saveCached(r);
          changed();
        }
      }
    } catch {
      /* offline: keep what we have */
    }
    if (!stopped) timer = window.setTimeout(() => void tick(), WEATHER.refreshMs);
  };
  void tick();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}
