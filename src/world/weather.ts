import { WEATHER } from '../config';
import { tint, WEATHER_COLORS, type Palette, type RGB } from '../palette';

/**
 * Real weather at each place, from Open-Meteo via our server
 * (server/src/weather.ts, GET /api/weather). The server asks for every place
 * at once every 15 minutes and keeps the answer, so the app never talks to a
 * third party and the player's location never leaves the device.
 *
 * Plain TypeScript (no DOM): the sky and the swell read it every frame.
 */

/** One place's weather right now (the server's JSON, per place id). */
export interface PlaceWeather {
  /** air temperature, °C */
  temp: number;
  /** WMO weather code */
  code: number;
  /** cloud cover 0..1 */
  cloud: number;
  /** precipitation in the last hour, mm */
  rain: number;
  /** wind speed at 10 m, km/h */
  wind: number;
  /** where the wind blows from, compass degrees */
  windDir: number;
  /** significant wave height offshore, m (null when the sea model has no cell there) */
  wave: number | null;
}

export interface WeatherReport {
  /** when the server fetched it (ms since epoch) */
  at: number;
  places: Record<string, PlaceWeather>;
}

export type SkyKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

/** WMO code → what the sky is doing. */
export function skyKind(code: number): SkyKind {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 45 || code === 48) return 'fog';
  if (code === 3) return 'cloudy';
  if (code === 2) return 'partly';
  return 'clear';
}

/** How the weather looks, each 0..1; what the sky, light and rain draw from. */
export interface WeatherLook {
  /** grey sky, flat light */
  overcast: number;
  /** sea fog: the horizon closes in */
  fog: number;
  /** rain (or snow) falling */
  rain: number;
  /** the falling stuff is snow */
  snow: boolean;
  /** storm darkness on top of overcast */
  storm: number;
  /** wind, for slanting the rain and drifting the clouds (−1..1: + blows to screen right) */
  wind: number;
  /** cloud puffs on the sky backdrop */
  clouds: number;
}

export const CLEAR_LOOK: WeatherLook = { overcast: 0, fog: 0, rain: 0, snow: false, storm: 0, wind: 0, clouds: 0 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The look of a place's weather. `facing` is the compass bearing of the sea,
 * so wind across the beach slants the rain the right way.
 */
export function weatherLook(w: PlaceWeather | undefined, facing = 180): WeatherLook {
  if (!w) return CLEAR_LOOK;
  const kind = skyKind(w.code);
  const wet = kind === 'drizzle' || kind === 'rain' || kind === 'snow' || kind === 'storm';
  const rainAmount = 1 - Math.exp(-Math.max(0, w.rain) / 1.5);
  const rain = wet
    ? clamp01(Math.max(kind === 'drizzle' ? 0.25 : kind === 'storm' ? 0.8 : 0.45, rainAmount))
    : 0;
  const overcast = clamp01(
    Math.max(
      (w.cloud - 0.35) / 0.6,
      kind === 'cloudy' ? 0.7 : 0,
      kind === 'fog' ? 0.6 : 0,
      wet ? 0.75 : 0,
      kind === 'storm' ? 1 : 0,
    ),
  );
  // wind blowing toward: bearing + 180. Facing the sea, a bearing 90° clockwise
  // of `facing` is on your right (screen right).
  const toward = (w.windDir + 180 - facing) * (Math.PI / 180);
  const strength = clamp01(w.wind / WEATHER.windFull);
  return {
    overcast,
    fog: kind === 'fog' ? 1 : 0,
    rain,
    snow: kind === 'snow',
    storm: kind === 'storm' ? 1 : 0,
    wind: Math.sin(toward) * strength,
    // a scatter of clouds in a part-cloudy sky; a solid deck reads as overcast instead
    clouds: clamp01(w.cloud * 1.2) * (1 - overcast * 0.85),
  };
}

/** Linear mix of two looks (along the shore, and easing to a new report). */
export function mixLook(a: WeatherLook, b: WeatherLook, t: number): WeatherLook {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    overcast: l(a.overcast, b.overcast),
    fog: l(a.fog, b.fog),
    rain: l(a.rain, b.rain),
    // the falling kind comes from whichever side has something falling
    snow: a.rain < 0.02 ? b.snow : b.rain < 0.02 ? a.snow : t < 0.5 ? a.snow : b.snow,
    storm: l(a.storm, b.storm),
    wind: l(a.wind, b.wind),
    clouds: l(a.clouds, b.clouds),
  };
}

const grey = (c: RGB): number => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
/** towards its own grey, then towards a colour, keeping some brightness */
const greyOut = (c: RGB, to: RGB, amount: number, light: number): RGB => {
  const g = grey(c);
  return tint(tint(c, [g, g, g], amount), scale(to, light), amount * 0.6);
};

/**
 * The palette under this weather. `night` (0..1) keeps night skies dark:
 * cloud at night only hides the stars and the moon's light.
 */
export function applyWeather(p: Palette, look: WeatherLook, night: number): Palette {
  if (look.overcast < 0.01 && look.fog < 0.01) return p;
  const o = look.overcast;
  const day = 1 - night;
  // how bright the grey is: the sky's own brightness (dawn and dusk stay dim)
  const light = Math.min(1, grey(p.skyBottom) * 1.25);
  const sky = tint(WEATHER_COLORS.overcastSky, WEATHER_COLORS.stormSky, look.storm);
  const out: Palette = { ...p };
  out.skyTop = greyOut(p.skyTop, sky, o * (0.4 + 0.5 * day), light);
  out.skyBottom = greyOut(p.skyBottom, WEATHER_COLORS.overcastHorizon, o * (0.35 + 0.5 * day), light);
  out.fog = greyOut(p.fog, WEATHER_COLORS.overcastHorizon, o * 0.7, light);
  // flat light: less direct sun, more of the sky's even glow
  const dim = 1 - WEATHER.overcastDim * o - 0.15 * look.storm;
  const sunGrey = grey(p.sun);
  out.sun = scale(tint(p.sun, [sunGrey, sunGrey, sunGrey], o * (1 - WEATHER.overcastKeep)), dim);
  out.ambient = tint(p.ambient, scale(out.skyBottom, 0.9), o * 0.35 * day);
  out.farOcean = greyOut(p.farOcean, WEATHER_COLORS.greySea, o * 0.5, light);
  out.waterDeep = greyOut(p.waterDeep, WEATHER_COLORS.greySea, o * 0.35, light);
  out.waterShallow = greyOut(p.waterShallow, WEATHER_COLORS.greySea, o * 0.2, light);
  if (look.fog > 0.01) {
    const f = look.fog * (0.5 + 0.4 * day);
    out.skyBottom = tint(out.skyBottom, scale(WEATHER_COLORS.fog, light), f);
    out.fog = tint(out.fog, scale(WEATHER_COLORS.fog, light), f);
    out.farOcean = tint(out.farOcean, out.fog, f * 0.7);
    out.skyTop = tint(out.skyTop, out.skyBottom, f * 0.5);
  }
  return out;
}

/**
 * The swell scale at a place: the beach's usual swell, pulled toward the
 * measured offshore wave height, plus a little chop from an onshore wind.
 * Stays inside the range the sim is tuned for.
 */
export function weatherWaves(base: number, w: PlaceWeather | undefined, facing: number): number {
  if (!w) return base;
  let v = base;
  if (w.wave !== null && Number.isFinite(w.wave)) {
    const measured = WEATHER.waveBase + WEATHER.waveK * Math.sqrt(Math.max(0, w.wave));
    v = base + (measured - base) * WEATHER.waveTrust;
  }
  // onshore: the wind comes from the sea, i.e. from the way the beach faces
  const onshore = Math.cos((w.windDir - facing) * (Math.PI / 180));
  v += WEATHER.windChop * Math.max(0, onshore) * clamp01(w.wind / WEATHER.windFull);
  return Math.min(WEATHER.waveMax, Math.max(WEATHER.waveMin, v));
}

const GLYPH: Record<SkyKind, string> = {
  clear: '☀',
  partly: '⛅',
  cloudy: '☁',
  fog: '≋',
  drizzle: '☂',
  rain: '☂',
  snow: '❄',
  storm: '☈',
};

const WORD: Record<SkyKind, string> = {
  clear: 'clear',
  partly: 'some cloud',
  cloudy: 'overcast',
  fog: 'fog',
  drizzle: 'drizzle',
  rain: 'rain',
  snow: 'snow',
  storm: 'thunder',
};

/** Fahrenheit for the US and a few others, Celsius elsewhere. */
export function usesFahrenheit(locale: string | undefined): boolean {
  return /-(US|LR|MM|BS|BZ|KY|PW|FM|MH)\b/i.test(locale ?? '');
}

export function formatTemp(c: number, fahrenheit: boolean): string {
  return fahrenheit ? `${Math.round(c * 1.8 + 32)}°F` : `${Math.round(c)}°C`;
}

/** The sky glyph; `night` swaps the clear-sky sun for a moon. */
export function weatherGlyph(w: PlaceWeather, night = false): string {
  const kind = skyKind(w.code);
  return night && (kind === 'clear' || kind === 'partly') ? '☾' : GLYPH[kind];
}

/** e.g. "rain 14°C" */
export function weatherText(w: PlaceWeather, fahrenheit: boolean): string {
  return `${WORD[skyKind(w.code)]} ${formatTemp(w.temp, fahrenheit)}`;
}

/** e.g. "☂ rain 14°C" */
export function describeWeather(w: PlaceWeather, fahrenheit: boolean, night = false): string {
  return `${weatherGlyph(w, night)} ${weatherText(w, fahrenheit)}`;
}

/**
 * A made-up report with the same weather everywhere, for screenshots and
 * tests (`?wx=<WMO code>` in the URL). Never sent anywhere.
 */
export function fakeReport(ids: readonly string[], code: number, now = Date.now()): WeatherReport {
  const kind = skyKind(code);
  const wet = kind === 'rain' || kind === 'drizzle' || kind === 'snow' || kind === 'storm';
  const w: PlaceWeather = {
    temp: kind === 'snow' ? -2 : 16,
    code,
    cloud: kind === 'clear' ? 0.05 : kind === 'partly' ? 0.45 : 0.95,
    rain: wet ? (kind === 'drizzle' ? 0.3 : kind === 'storm' ? 6 : 2) : 0,
    wind: kind === 'storm' ? 45 : 18,
    windDir: 250,
    wave: kind === 'storm' ? 2.5 : 1,
  };
  return { at: now, places: Object.fromEntries(ids.map((id) => [id, w])) };
}

/** Short, for lists: "☂ 14°". */
export function shortWeather(w: PlaceWeather, fahrenheit: boolean): string {
  const t = fahrenheit ? Math.round(w.temp * 1.8 + 32) : Math.round(w.temp);
  return `${GLYPH[skyKind(w.code)]} ${t}°`;
}

// ------------------------------------------------------------ the report
// One report for every place, shared by the live beach, the shore's other
// places and the place picker. Unset (the sandbox build, or offline) means
// fair weather everywhere: the game looks as it always did.

let report: WeatherReport | null = null;
let version = 0;

export function setWeatherReport(r: WeatherReport | null): void {
  report = r;
  version++;
}

/** bumps whenever the report changes (cheap change detection) */
export function weatherVersion(): number {
  return version;
}

/** The weather at a place, or undefined if unknown or too old. */
export function weatherFor(id: string | undefined, now = Date.now()): PlaceWeather | undefined {
  if (!report || !id) return undefined;
  if (now - report.at > WEATHER.staleMs) return undefined;
  return report.places[id];
}

/** Checks a server answer; anything malformed is dropped, place by place. */
export function parseWeatherReport(raw: unknown): WeatherReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { at?: unknown; places?: unknown };
  if (typeof r.at !== 'number' || !r.places || typeof r.places !== 'object') return null;
  const places: Record<string, PlaceWeather> = {};
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  for (const [id, v] of Object.entries(r.places as Record<string, unknown>)) {
    const w = v as Partial<PlaceWeather> | null;
    if (!w || !num(w.temp) || !num(w.code) || !num(w.cloud) || !num(w.rain) || !num(w.wind) || !num(w.windDir)) continue;
    places[id] = {
      temp: w.temp!,
      code: w.code!,
      cloud: clamp01(w.cloud!),
      rain: Math.max(0, w.rain!),
      wind: Math.max(0, w.wind!),
      windDir: w.windDir!,
      wave: num(w.wave) ? Math.max(0, w.wave as number) : null,
    };
  }
  return { at: r.at, places };
}
