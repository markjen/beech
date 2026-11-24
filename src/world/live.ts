import { paletteAlong, paletteByName, tint, type Palette } from '../palette';
import { moonIllumination, moonPosition, sunPosition, type SkyPosition } from './astro';
import type { Beach } from './locations';
import { nextExtremes, tideHeight, tideRange, type TideExtreme } from './tides';

const RAD = Math.PI / 180;

/** Sky objects in scene space: unit vectors pointing *toward* them. */
export interface SkyObjects {
  sun: { dir: [number, number, number]; elevation: number };
  moon: { dir: [number, number, number]; elevation: number; fraction: number; phase: number };
  /** 0 = full day, 1 = full night */
  night: number;
}

export interface LiveState {
  palette: Palette;
  sky: SkyObjects;
  /** real tide height at the gauge (m, relative to mean sea level) */
  tide: number;
  /** compressed tide for the diorama (m) */
  simTide: number;
  rising: boolean;
  next: TideExtreme[];
  localTime: string;
}

/**
 * Scene orientation: the sea is toward −Z. Facing the sea, your right hand
 * points to −X. A compass bearing b maps to a horizontal scene direction by
 * its angle relative to the way the beach faces.
 */
export function sceneDirection(pos: SkyPosition, facing: number): [number, number, number] {
  const r = (pos.bearing - facing) * RAD;
  const e = pos.elevation * RAD;
  return [-Math.sin(r) * Math.cos(e), Math.sin(e), -Math.cos(r) * Math.cos(e)];
}

/**
 * Squash real tides (a few cm in the Mediterranean, several metres in the
 * English Channel) into what the 24 m diorama can show: big tides move the
 * waterline a lot, small ones a little, and high/low happen at the real times.
 */
export function diorama(tide: number): number {
  return Math.sign(tide) * 0.3 * (1 - Math.exp(-Math.abs(tide) / 1.0));
}

const EVENING: [number, string][] = [
  [-12, 'night'],
  [-4, 'dusk'],
  [5, 'golden'],
  [20, 'day'],
];
const MORNING: [number, string][] = [
  [-12, 'night'],
  [-3, 'dawn'],
  [5, 'dawn'],
  [18, 'day'],
];

/** Palette for a sun elevation: dawn colours in the morning, golden and dusk in the evening. */
export function paletteForSun(elevation: number, morning: boolean): Palette {
  return paletteAlong(morning ? MORNING : EVENING, elevation);
}

const clampElevation = (d: [number, number, number], minDeg: number): [number, number, number] => {
  const minY = Math.sin(minDeg * RAD);
  if (d[1] >= minY) return d;
  const h = Math.hypot(d[0], d[2]) || 1;
  const c = Math.cos(minDeg * RAD);
  return [(d[0] / h) * c, minY, (d[2] / h) * c];
};

const timeFormats = new Map<string, Intl.DateTimeFormat>();
const timeCache = new Map<string, { min: number; text: string }>();
export function formatLocalTime(date: Date, timeZone: string): string {
  const min = Math.floor(date.getTime() / 60000);
  const hit = timeCache.get(timeZone);
  if (hit && hit.min === min) return hit.text;
  let f = timeFormats.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' });
    } catch {
      f = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    timeFormats.set(timeZone, f);
  }
  const text = f.format(date);
  timeCache.set(timeZone, { min, text });
  return text;
}

/** Everything about "right now at this beach". Cheap enough to call every frame. */
export class LiveConditions {
  private extremesFor = 0;
  private extremes: TideExtreme[] = [];

  constructor(public beach: Beach) {}

  setBeach(b: Beach): void {
    this.beach = b;
    this.extremesFor = 0;
  }

  /** `fixed` = a palette name chosen in settings instead of the live sky. */
  compute(now: Date, fixed?: string): LiveState {
    const b = this.beach;
    const sunP = sunPosition(now, b.lat, b.lon);
    const moonP = moonPosition(now, b.lat, b.lon);
    const illum = moonIllumination(now);
    // morning = the sun is still climbing
    const later = sunPosition(new Date(now.getTime() + 600000), b.lat, b.lon);
    const morning = later.elevation > sunP.elevation;

    const sunDir = sceneDirection(sunP, b.facing);
    const moonDir = sceneDirection(moonP, b.facing);
    const night = Math.min(1, Math.max(0, (-sunP.elevation - 2) / 8));

    let p: Palette = fixed ? paletteByName(fixed) : paletteForSun(sunP.elevation, morning);
    p = { ...p };
    if (!fixed) {
      // light comes from the real sun (or the moon at night), kept a little
      // above the horizon so shading stays readable
      const moonUp = moonP.elevation > 0;
      const nightLight: [number, number, number] = moonUp ? clampElevation(moonDir, 25) : [0.25, 0.9, 0.35];
      const dayLight = clampElevation(sunDir, 12);
      const k = night;
      const l: [number, number, number] = [
        dayLight[0] * (1 - k) + nightLight[0] * k,
        dayLight[1] * (1 - k) + nightLight[1] * k,
        dayLight[2] * (1 - k) + nightLight[2] * k,
      ];
      p.sunDir = [-l[0], -l[1], -l[2]];
      // a brighter moon lights the night beach more
      const moonGain = moonUp ? 0.6 + 0.4 * illum.fraction : 0.55;
      p.sun = tint(p.sun, [p.sun[0] * moonGain, p.sun[1] * moonGain, p.sun[2] * moonGain], night);
    }
    // the beach's own sand and water, shifted by the current mood (the
    // ratio of this palette's colour to the daytime one)
    const day = paletteByName('day');
    const mood = (c: keyof Palette, col: [number, number, number]) => ratio(col, p[c] as Rgb, day[c] as Rgb);
    p.sandDry = tint(p.sandDry, mood('sandDry', b.sand), b.sandMix);
    p.sandWet = tint(p.sandWet, mood('sandWet', darken(b.sand, 0.78)), b.sandMix);
    p.sandDeep = tint(p.sandDeep, mood('sandDeep', darken(b.sand, 0.9)), b.sandMix);
    p.waterShallow = tint(p.waterShallow, mood('waterShallow', lighten(b.water, 0.4)), b.waterMix);
    p.waterDeep = tint(p.waterDeep, mood('waterDeep', b.water), b.waterMix);
    p.farOcean = tint(p.farOcean, mood('farOcean', b.water), b.waterMix * 0.8);

    const tide = tideHeight(b.tide, now);
    const soon = tideHeight(b.tide, new Date(now.getTime() + 600000));
    if (now.getTime() - this.extremesFor > 60000 || now.getTime() < this.extremesFor) {
      this.extremes = nextExtremes(b.tide, now, 2);
      this.extremesFor = now.getTime();
    }
    return {
      palette: p,
      sky: {
        sun: { dir: sunDir, elevation: sunP.elevation },
        moon: { dir: moonDir, elevation: moonP.elevation, fraction: illum.fraction, phase: illum.phase },
        night,
      },
      tide,
      simTide: diorama(tide),
      rising: soon > tide,
      next: this.extremes.filter((e) => e.time.getTime() > now.getTime()),
      localTime: formatLocalTime(now, b.timeZone),
    };
  }

  /** e.g. "6:42 am · tide rising · high 9:58 am" */
  describe(s: LiveState): string {
    const parts = [s.localTime];
    const range = tideRange(this.beach.tide);
    if (range < 0.15) parts.push('almost no tide');
    else parts.push(`tide ${s.rising ? 'rising' : 'falling'}`);
    const nx = s.next[0];
    if (nx && range >= 0.15) parts.push(`${nx.kind} ${formatLocalTime(nx.time, this.beach.timeZone)}`);
    return parts.join(' · ');
  }
}

type Rgb = [number, number, number];
/** col × (now / dayRef), per channel, clamped */
// square root: carry half the mood shift so warm light doesn't oversaturate
const ratio = (col: Rgb, now: Rgb, dayRef: Rgb): Rgb => [
  Math.min(1, col[0] * Math.sqrt(now[0] / Math.max(0.05, dayRef[0]))),
  Math.min(1, col[1] * Math.sqrt(now[1] / Math.max(0.05, dayRef[1]))),
  Math.min(1, col[2] * Math.sqrt(now[2] / Math.max(0.05, dayRef[2]))),
];
const darken = (a: [number, number, number], k: number): [number, number, number] => [a[0] * k, a[1] * k, a[2] * k];
const lighten = (a: [number, number, number], k: number): [number, number, number] => [
  a[0] + (1 - a[0]) * k,
  a[1] + (1 - a[1]) * k,
  a[2] + (1 - a[2]) * k,
];
