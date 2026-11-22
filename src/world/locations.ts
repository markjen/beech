import type { RGB } from '../palette';
import stationsJson from './tideStations.json';
import type { Constituents } from './tides';

/**
 * Real beaches. `facing` is the compass bearing you look along when you stand
 * on the sand facing the sea (it orients the sun and moon in the scene).
 * Tide constants come from the nearest coastal gauge in TICON-3 (see
 * scripts/extract-tides.mjs). Looks are gentle tints over the palette, so
 * every beach still feels like the same toy.
 */
export interface Beach {
  id: string;
  name: string;
  place: string;
  lat: number;
  lon: number;
  timeZone: string;
  facing: number;
  /** multiplies the swell height (keep within ~0.4..1.15 for the sim) */
  waves: number;
  /** sand colour tint (dry), mixed into the palette */
  sand: RGB;
  /** how strongly the tint applies (0..1) */
  sandMix: number;
  /** water colour tint */
  water: RGB;
  waterMix: number;
  tide: Constituents;
  gaugeKm: number;
}

const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

type StationsFile = { stations: Record<string, { gauge: { km: number }; cons: Record<string, [number, number]> }> };
const STATIONS = (stationsJson as unknown as StationsFile).stations;

type BeachSpec = Omit<Beach, 'tide' | 'gaugeKm'>;

const SPECS: BeachSpec[] = [
  { id: 'bondi', name: 'Bondi Beach', place: 'Sydney', lat: -33.8915, lon: 151.2767, timeZone: 'Australia/Sydney', facing: 115, waves: 1.05, sand: hex('#f2d9a8'), sandMix: 0.5, water: hex('#2aa7c0'), waterMix: 0.3 },
  { id: 'waikiki', name: 'Waikīkī', place: 'Honolulu', lat: 21.2766, lon: -157.8278, timeZone: 'Pacific/Honolulu', facing: 200, waves: 0.75, sand: hex('#f6e6c6'), sandMix: 0.5, water: hex('#22c4c9'), waterMix: 0.45 },
  { id: 'santamonica', name: 'Santa Monica', place: 'Los Angeles', lat: 34.0095, lon: -118.497, timeZone: 'America/Los_Angeles', facing: 220, waves: 0.9, sand: hex('#e8d2a6'), sandMix: 0.45, water: hex('#3b8fa6'), waterMix: 0.35 },
  { id: 'southbeach', name: 'South Beach', place: 'Miami', lat: 25.7826, lon: -80.13, timeZone: 'America/New_York', facing: 90, waves: 0.6, sand: hex('#f7ecd6'), sandMix: 0.55, water: hex('#36d0c4'), waterMix: 0.45 },
  { id: 'copacabana', name: 'Copacabana', place: 'Rio de Janeiro', lat: -22.9711, lon: -43.1822, timeZone: 'America/Sao_Paulo', facing: 150, waves: 0.95, sand: hex('#f4e4c4'), sandMix: 0.5, water: hex('#2f9fb0'), waterMix: 0.35 },
  { id: 'brighton', name: 'Brighton Beach', place: 'England', lat: 50.8197, lon: -0.1372, timeZone: 'Europe/London', facing: 180, waves: 0.8, sand: hex('#b9a890'), sandMix: 0.6, water: hex('#5f8f8e'), waterMix: 0.5 },
  { id: 'biarritz', name: 'Grande Plage', place: 'Biarritz', lat: 43.4832, lon: -1.5586, timeZone: 'Europe/Paris', facing: 300, waves: 1.15, sand: hex('#e9cfa0'), sandMix: 0.45, water: hex('#2f7f9c'), waterMix: 0.35 },
  { id: 'campsbay', name: 'Camps Bay', place: 'Cape Town', lat: -33.951, lon: 18.377, timeZone: 'Africa/Johannesburg', facing: 270, waves: 1.05, sand: hex('#f8f1e2'), sandMix: 0.6, water: hex('#2b8f9e'), waterMix: 0.4 },
  { id: 'patong', name: 'Patong Beach', place: 'Phuket', lat: 7.8961, lon: 98.296, timeZone: 'Asia/Bangkok', facing: 260, waves: 0.7, sand: hex('#f1dfbd'), sandMix: 0.45, water: hex('#2fb3b0'), waterMix: 0.4 },
  { id: 'kuta', name: 'Kuta Beach', place: 'Bali', lat: -8.718, lon: 115.1686, timeZone: 'Asia/Makassar', facing: 250, waves: 1.0, sand: hex('#e2c896'), sandMix: 0.45, water: hex('#2a9fb6'), waterMix: 0.35 },
  { id: 'nice', name: 'Promenade des Anglais', place: 'Nice', lat: 43.6947, lon: 7.265, timeZone: 'Europe/Paris', facing: 180, waves: 0.45, sand: hex('#c9bfae'), sandMix: 0.6, water: hex('#1f8fc0'), waterMix: 0.5 },
  { id: 'kamakura', name: 'Yuigahama', place: 'Kamakura', lat: 35.3106, lon: 139.543, timeZone: 'Asia/Tokyo', facing: 180, waves: 0.85, sand: hex('#9c8a78'), sandMix: 0.55, water: hex('#3b8597'), waterMix: 0.35 },
  { id: 'piha', name: 'Piha', place: 'Auckland', lat: -36.954, lon: 174.468, timeZone: 'Pacific/Auckland', facing: 270, waves: 1.15, sand: hex('#4f4a49'), sandMix: 0.7, water: hex('#2f7d88'), waterMix: 0.35 },
];

export const BEACHES: Beach[] = SPECS.map((s) => ({
  ...s,
  tide: STATIONS[s.id].cons as Constituents,
  gaugeKm: STATIONS[s.id].gauge.km,
}));

export function beachById(id: string | undefined | null): Beach | undefined {
  return BEACHES.find((b) => b.id === id);
}

/** UTC offset (minutes) of a time zone at a moment. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
  } catch {
    return 0;
  }
}

/**
 * Default beach for this device: same time zone if we have one, otherwise
 * the closest UTC offset (so it's daytime at the beach when it's daytime here).
 */
export function defaultBeach(now = new Date()): Beach {
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* ignore */
  }
  const same = BEACHES.find((b) => b.timeZone === zone);
  if (same) return same;
  const mine = -now.getTimezoneOffset();
  let best = BEACHES[0];
  let bestD = Infinity;
  for (const b of BEACHES) {
    let d = Math.abs(zoneOffsetMinutes(b.timeZone, now) - mine);
    d = Math.min(d, 24 * 60 - d);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** Nearest beach to a lat/lon (great-circle distance). */
export function nearestBeach(lat: number, lon: number): Beach {
  const r = Math.PI / 180;
  let best = BEACHES[0];
  let bestD = Infinity;
  for (const b of BEACHES) {
    const x =
      Math.sin(((b.lat - lat) * r) / 2) ** 2 +
      Math.cos(lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - lon) * r) / 2) ** 2;
    if (x < bestD) {
      bestD = x;
      best = b;
    }
  }
  return best;
}
