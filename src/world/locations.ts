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
export const REGIONS = ['Oceania', 'Asia', 'Africa & Middle East', 'Europe', 'North America', 'Caribbean & Central America', 'South America'] as const;
export type Region = (typeof REGIONS)[number];

export interface Beach {
  id: string;
  name: string;
  place: string;
  /** grouping for the place picker */
  region: Region;
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
  { id: 'bondi', region: 'Oceania', name: 'Bondi Beach', place: 'Sydney', lat: -33.8915, lon: 151.2767, timeZone: 'Australia/Sydney', facing: 115, waves: 1.05, sand: hex('#f2d9a8'), sandMix: 0.5, water: hex('#2aa7c0'), waterMix: 0.3 },
  { id: 'waikiki', region: 'Oceania', name: 'Waikīkī', place: 'Honolulu', lat: 21.2766, lon: -157.8278, timeZone: 'Pacific/Honolulu', facing: 200, waves: 0.75, sand: hex('#f6e6c6'), sandMix: 0.5, water: hex('#22c4c9'), waterMix: 0.45 },
  { id: 'santamonica', region: 'North America', name: 'Santa Monica', place: 'Los Angeles', lat: 34.0095, lon: -118.497, timeZone: 'America/Los_Angeles', facing: 220, waves: 0.9, sand: hex('#e8d2a6'), sandMix: 0.45, water: hex('#3b8fa6'), waterMix: 0.35 },
  { id: 'southbeach', region: 'North America', name: 'South Beach', place: 'Miami', lat: 25.7826, lon: -80.13, timeZone: 'America/New_York', facing: 90, waves: 0.6, sand: hex('#f7ecd6'), sandMix: 0.55, water: hex('#36d0c4'), waterMix: 0.45 },
  { id: 'copacabana', region: 'South America', name: 'Copacabana', place: 'Rio de Janeiro', lat: -22.9711, lon: -43.1822, timeZone: 'America/Sao_Paulo', facing: 150, waves: 0.95, sand: hex('#f4e4c4'), sandMix: 0.5, water: hex('#2f9fb0'), waterMix: 0.35 },
  { id: 'brighton', region: 'Europe', name: 'Brighton Beach', place: 'England', lat: 50.8197, lon: -0.1372, timeZone: 'Europe/London', facing: 180, waves: 0.8, sand: hex('#b9a890'), sandMix: 0.6, water: hex('#5f8f8e'), waterMix: 0.5 },
  { id: 'biarritz', region: 'Europe', name: 'Grande Plage', place: 'Biarritz', lat: 43.4832, lon: -1.5586, timeZone: 'Europe/Paris', facing: 300, waves: 1.15, sand: hex('#e9cfa0'), sandMix: 0.45, water: hex('#2f7f9c'), waterMix: 0.35 },
  { id: 'campsbay', region: 'Africa & Middle East', name: 'Camps Bay', place: 'Cape Town', lat: -33.951, lon: 18.377, timeZone: 'Africa/Johannesburg', facing: 270, waves: 1.05, sand: hex('#f8f1e2'), sandMix: 0.6, water: hex('#2b8f9e'), waterMix: 0.4 },
  { id: 'patong', region: 'Asia', name: 'Patong Beach', place: 'Phuket', lat: 7.8961, lon: 98.296, timeZone: 'Asia/Bangkok', facing: 260, waves: 0.7, sand: hex('#f1dfbd'), sandMix: 0.45, water: hex('#2fb3b0'), waterMix: 0.4 },
  { id: 'kuta', region: 'Asia', name: 'Kuta Beach', place: 'Bali', lat: -8.718, lon: 115.1686, timeZone: 'Asia/Makassar', facing: 250, waves: 1.0, sand: hex('#e2c896'), sandMix: 0.45, water: hex('#2a9fb6'), waterMix: 0.35 },
  { id: 'nice', region: 'Europe', name: 'Promenade des Anglais', place: 'Nice', lat: 43.6947, lon: 7.265, timeZone: 'Europe/Paris', facing: 180, waves: 0.45, sand: hex('#c9bfae'), sandMix: 0.6, water: hex('#1f8fc0'), waterMix: 0.5 },
  { id: 'kamakura', region: 'Asia', name: 'Yuigahama', place: 'Kamakura', lat: 35.3106, lon: 139.543, timeZone: 'Asia/Tokyo', facing: 180, waves: 0.85, sand: hex('#9c8a78'), sandMix: 0.55, water: hex('#3b8597'), waterMix: 0.35 },
  { id: 'piha', region: 'Oceania', name: 'Piha', place: 'Auckland', lat: -36.954, lon: 174.468, timeZone: 'Pacific/Auckland', facing: 270, waves: 1.15, sand: hex('#4f4a49'), sandMix: 0.7, water: hex('#2f7d88'), waterMix: 0.35 },
  // added 2026-11-26
  { id: 'whitehaven', region: 'Oceania', name: 'Whitehaven Beach', place: 'Whitsundays', lat: -20.2826, lon: 149.0386, timeZone: 'Australia/Brisbane', facing: 120, waves: 0.5, sand: hex('#fbfaf5'), sandMix: 0.7, water: hex('#2fc6d0'), waterMix: 0.5 },
  { id: 'surfers', region: 'Oceania', name: 'Surfers Paradise', place: 'Gold Coast', lat: -28.0023, lon: 153.431, timeZone: 'Australia/Brisbane', facing: 90, waves: 1.05, sand: hex('#f3dfb6'), sandMix: 0.5, water: hex('#2a9fbe'), waterMix: 0.35 },
  { id: 'cable', region: 'Oceania', name: 'Cable Beach', place: 'Broome', lat: -17.933, lon: 122.21, timeZone: 'Australia/Perth', facing: 270, waves: 0.6, sand: hex('#f3dcb3'), sandMix: 0.5, water: hex('#3bb3b3'), waterMix: 0.45 },
  { id: 'railay', region: 'Asia', name: 'Railay West', place: 'Krabi', lat: 8.0115, lon: 98.8378, timeZone: 'Asia/Bangkok', facing: 250, waves: 0.45, sand: hex('#f3e6c8'), sandMix: 0.5, water: hex('#33b8b0'), waterMix: 0.45 },
  { id: 'haeundae', region: 'Asia', name: 'Haeundae', place: 'Busan', lat: 35.1587, lon: 129.1604, timeZone: 'Asia/Seoul', facing: 160, waves: 0.7, sand: hex('#d9c7a4'), sandMix: 0.5, water: hex('#3a8fa6'), waterMix: 0.35 },
  { id: 'anse', region: 'Africa & Middle East', name: "Anse Source d'Argent", place: 'La Digue', lat: -4.3707, lon: 55.8247, timeZone: 'Indian/Mahe', facing: 250, waves: 0.4, sand: hex('#f7efe0'), sandMix: 0.6, water: hex('#3dd0c8'), waterMix: 0.5 },
  { id: 'nungwi', region: 'Africa & Middle East', name: 'Nungwi', place: 'Zanzibar', lat: -5.727, lon: 39.295, timeZone: 'Africa/Dar_es_Salaam', facing: 270, waves: 0.5, sand: hex('#faf3e3'), sandMix: 0.6, water: hex('#36c9c4'), waterMix: 0.5 },
  { id: 'sylt', region: 'Europe', name: 'Westerland', place: 'Sylt', lat: 54.9079, lon: 8.303, timeZone: 'Europe/Berlin', facing: 270, waves: 0.9, sand: hex('#e8dcc0'), sandMix: 0.55, water: hex('#5f8a8c'), waterMix: 0.5 },
  { id: 'scheveningen', region: 'Europe', name: 'Scheveningen', place: 'The Hague', lat: 52.1113, lon: 4.2797, timeZone: 'Europe/Amsterdam', facing: 300, waves: 0.75, sand: hex('#e3d4b4'), sandMix: 0.5, water: hex('#5e8584'), waterMix: 0.5 },
  { id: 'fistral', region: 'Europe', name: 'Fistral Beach', place: 'Newquay', lat: 50.4168, lon: -5.1, timeZone: 'Europe/London', facing: 300, waves: 1.1, sand: hex('#e6d3a9'), sandMix: 0.5, water: hex('#3d8696'), waterMix: 0.4 },
  { id: 'nazare', region: 'Europe', name: 'Praia da Nazaré', place: 'Portugal', lat: 39.6012, lon: -9.0736, timeZone: 'Europe/Lisbon', facing: 270, waves: 1.15, sand: hex('#e9d6ae'), sandMix: 0.5, water: hex('#2f7f96'), waterMix: 0.35 },
  { id: 'marinha', region: 'Europe', name: 'Praia da Marinha', place: 'Algarve', lat: 37.0899, lon: -8.4123, timeZone: 'Europe/Lisbon', facing: 180, waves: 0.6, sand: hex('#e7c58f'), sandMix: 0.55, water: hex('#2aa6b8'), waterMix: 0.45 },
  { id: 'barceloneta', region: 'Europe', name: 'Barceloneta', place: 'Barcelona', lat: 41.3784, lon: 2.1925, timeZone: 'Europe/Madrid', facing: 135, waves: 0.5, sand: hex('#dcc59a'), sandMix: 0.5, water: hex('#2f95b8'), waterMix: 0.4 },
  { id: 'zlatnirat', region: 'Europe', name: 'Zlatni Rat', place: 'Brač', lat: 43.2558, lon: 16.6339, timeZone: 'Europe/Zagreb', facing: 180, waves: 0.4, sand: hex('#ddd6c8'), sandMix: 0.6, water: hex('#1d9fc8'), waterMix: 0.55 },
  { id: 'tofino', region: 'North America', name: 'Long Beach', place: 'Tofino', lat: 49.03, lon: -125.68, timeZone: 'America/Vancouver', facing: 225, waves: 1.15, sand: hex('#cbbb9c'), sandMix: 0.5, water: hex('#3f7a84'), waterMix: 0.4 },
  { id: 'cannon', region: 'North America', name: 'Cannon Beach', place: 'Oregon', lat: 45.8918, lon: -123.9615, timeZone: 'America/Los_Angeles', facing: 270, waves: 1.1, sand: hex('#c9b89a'), sandMix: 0.5, water: hex('#4a7f8a'), waterMix: 0.4 },
  { id: 'huntington', region: 'North America', name: 'Huntington Beach', place: 'California', lat: 33.6553, lon: -118.003, timeZone: 'America/Los_Angeles', facing: 210, waves: 1.0, sand: hex('#e4cfa3'), sandMix: 0.45, water: hex('#3a8ea4'), waterMix: 0.35 },
  { id: 'capecod', region: 'North America', name: 'Coast Guard Beach', place: 'Cape Cod', lat: 41.8395, lon: -69.9435, timeZone: 'America/New_York', facing: 90, waves: 0.9, sand: hex('#e2d1ad'), sandMix: 0.5, water: hex('#3e7f8e'), waterMix: 0.4 },
  { id: 'cancun', region: 'Caribbean & Central America', name: 'Playa Delfines', place: 'Cancún', lat: 21.06, lon: -86.78, timeZone: 'America/Cancun', facing: 90, waves: 0.6, sand: hex('#faf5e8'), sandMix: 0.6, water: hex('#33d0c8'), waterMix: 0.55 },
  { id: 'zicatela', region: 'Caribbean & Central America', name: 'Zicatela', place: 'Puerto Escondido', lat: 15.853, lon: -97.056, timeZone: 'America/Mexico_City', facing: 200, waves: 1.15, sand: hex('#e0c595'), sandMix: 0.5, water: hex('#2b8fab'), waterMix: 0.35 },
  { id: 'vinadelmar', region: 'South America', name: 'Viña del Mar', place: 'Chile', lat: -33.015, lon: -71.553, timeZone: 'America/Santiago', facing: 280, waves: 1.0, sand: hex('#c9b693'), sandMix: 0.5, water: hex('#3a7f90'), waterMix: 0.35 },
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
