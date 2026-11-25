import type { QualityTier } from '../config';

/** wave strength (beach settings): calm and gentle quiet the swell, surf lifts it */
export type WaveStrength = 'calm' | 'gentle' | 'lively' | 'surf';
export const WAVE_STRENGTHS: WaveStrength[] = ['calm', 'gentle', 'lively', 'surf'];

/** a pinned mood, used when local weather is off */
export type PaletteChoice = 'dawn' | 'day' | 'golden' | 'dusk' | 'night';

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
  /** the sky and light follow the real place of the beach in the middle of the view */
  localWeather: boolean;
  /** the light to use when local weather is off */
  palette: PaletteChoice;
  /** beach id (src/world/locations.ts); unset = pick from the device's time zone */
  beach?: string;
  quality: QualityTier | 'auto';
  batterySaver: boolean;
  seenIntro: boolean;
  /** ambient / TV: hide the controls when idle, keep the screen awake */
  ambient: boolean;
  /** tier picked by the first-launch benchmark (used when quality is 'auto') */
  benchTier?: QualityTier;
  /** last size picked for each item, 0..1 across its range */
  itemSizes?: Record<string, number>;
  /** wave strength (unset: lively, the beach's own swell) */
  waves?: WaveStrength;
  /** the top-left status pane: two lines, everything, or tucked away to an i */
  statusPane?: 'default' | 'expanded' | 'closed';
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  music: false,
  haptics: true,
  localWeather: true,
  palette: 'day',
  quality: 'auto',
  batterySaver: false,
  seenIntro: false,
  ambient: false,
};

const KEY = 'beech.settings.v1';

/** Per-device preferences. Storage can be unavailable (private mode): fall back to defaults. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      return migrateSettings(JSON.parse(raw) as Partial<Settings>);
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * Older builds had one "light" choice: 'live' (or the even older 'cycle')
 * followed the real sun, anything else pinned a mood. That became the local
 * weather switch plus a pinned light for when it's off.
 */
export function migrateSettings(raw: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  const old = raw.palette as string | undefined;
  if (old === 'live' || old === 'cycle') {
    s.localWeather = raw.localWeather ?? true;
    s.palette = DEFAULT_SETTINGS.palette;
  } else if (old && raw.localWeather === undefined) {
    s.localWeather = false;
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
