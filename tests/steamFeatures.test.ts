import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyDeadzone } from '../src/input/gamepad';
import type { BeechSteamBridge } from '../src/platform/runtime';
import { resetSteamFeatureState, unlockSteamAchievement, updateSteamRichPresence } from '../src/platform/steamFeatures';

afterEach(() => {
  delete (globalThis as { window?: { beechSteam?: BeechSteamBridge } }).window;
  resetSteamFeatureState();
});

describe('Steam achievements & Rich Presence', () => {
  it('deduplicates achievement unlocks and Rich Presence updates per session', () => {
    const unlockAchievement = vi.fn();
    const setRichPresence = vi.fn();
    (globalThis as unknown as { window: { beechSteam?: Partial<BeechSteamBridge> } }).window = {
      beechSteam: { unlockAchievement, setRichPresence },
    };

    unlockSteamAchievement('FIRST_DIG');
    unlockSteamAchievement('FIRST_DIG');
    unlockSteamAchievement('CHAIR_VIEW');
    expect(unlockAchievement).toHaveBeenCalledTimes(2);
    expect(unlockAchievement).toHaveBeenNthCalledWith(1, 'FIRST_DIG');
    expect(unlockAchievement).toHaveBeenNthCalledWith(2, 'CHAIR_VIEW');

    updateSteamRichPresence('Bondi', 'diorama');
    updateSteamRichPresence('Bondi', 'diorama');
    updateSteamRichPresence('Bondi', 'chair');
    expect(setRichPresence).toHaveBeenCalledTimes(4);
    expect(setRichPresence).toHaveBeenNthCalledWith(1, 'beach', 'Bondi');
    expect(setRichPresence).toHaveBeenNthCalledWith(2, 'steam_display', '#Status_AtBeach');
    expect(setRichPresence).toHaveBeenNthCalledWith(3, 'beach', 'Bondi');
    expect(setRichPresence).toHaveBeenNthCalledWith(4, 'steam_display', '#Status_Chair');
  });

  it('is a safe no-op outside Steam', () => {
    expect(() => unlockSteamAchievement('FIRST_DIG')).not.toThrow();
    expect(() => updateSteamRichPresence('Waikiki', 'diorama')).not.toThrow();
  });
});

describe('gamepad deadzone', () => {
  it('zeroes small stick noise and rescales smoothly to [-1, 1]', () => {
    expect(applyDeadzone(0.1)).toBe(0);
    expect(applyDeadzone(-0.18)).toBe(0);
    expect(applyDeadzone(1)).toBeCloseTo(1, 5);
    expect(applyDeadzone(-1)).toBeCloseTo(-1, 5);
    expect(applyDeadzone(0.59)).toBeCloseTo(0.5, 2);
  });
});
