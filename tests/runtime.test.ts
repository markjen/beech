import { afterEach, describe, expect, it } from 'vitest';
import { getRuntime, isMobileApp, isPackagedApp, isSteam, steamBridge, type BeechSteamBridge } from '../src/platform/runtime';

const fakeBridge: BeechSteamBridge = {
  platform: 'linux',
  steamDeck: true,
  steamReady: true,
  getAuthTicket: async () => ({ ticketHex: 'abcd', steamId: '76561198000000000', personaName: 'Tester' }),
  onMicroTxnResponse: () => () => {},
  unlockAchievement: () => {},
  setRichPresence: () => {},
  openExternal: () => {},
  toggleFullscreen: async () => true,
  isFullscreen: async () => true,
  quit: () => {},
  saveBeachFile: async () => true,
};

afterEach(() => {
  delete (globalThis as { window?: { beechSteam?: BeechSteamBridge } }).window;
});

describe('runtime detection', () => {
  it('defaults to web when neither Steam nor Capacitor native is present', () => {
    expect(steamBridge()).toBeNull();
    expect(getRuntime()).toBe('web');
    expect(isSteam()).toBe(false);
    expect(isMobileApp()).toBe(false);
    expect(isPackagedApp()).toBe(false);
  });

  it('detects Steam when window.beechSteam is injected by Electron preload', () => {
    (globalThis as unknown as { window: { beechSteam?: BeechSteamBridge } }).window = { beechSteam: fakeBridge };
    expect(steamBridge()).toBe(fakeBridge);
    expect(getRuntime()).toBe('steam');
    expect(isSteam()).toBe(true);
    expect(isMobileApp()).toBe(false);
    expect(isPackagedApp()).toBe(true);
  });
});
