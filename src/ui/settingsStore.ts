import type { QualityTier } from '../config';

export type PaletteChoice = 'cycle' | 'dawn' | 'day' | 'golden' | 'dusk';

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
  palette: PaletteChoice;
  quality: QualityTier | 'auto';
  batterySaver: boolean;
  seenIntro: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  music: false,
  haptics: true,
  palette: 'cycle',
  quality: 'auto',
  batterySaver: false,
  seenIntro: false,
};

const KEY = 'beech.settings.v1';

/** Per-device preferences. Storage can be unavailable (private mode): fall back to defaults. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
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
