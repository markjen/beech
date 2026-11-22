import type { QualityTier } from '../config';

/** 'live' follows the real sun at the chosen beach; the others pin a mood */
export type PaletteChoice = 'live' | 'dawn' | 'day' | 'golden' | 'dusk' | 'night';

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
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
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  music: false,
  haptics: true,
  palette: 'live',
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
      const s = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
      // older builds had a 20-minute "cycle"; it became the live sky
      if ((s.palette as string) === 'cycle') s.palette = 'live';
      return s;
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
