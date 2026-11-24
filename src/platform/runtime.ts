import { Capacitor } from '@capacitor/core';

export type Runtime = 'web' | 'ios' | 'android' | 'steam';

export interface SteamAuthTicket {
  ticketHex: string;
  steamId: string;
  personaName: string;
}

export interface SteamMicroTxnResponse {
  appId: number;
  orderId: string;
  authorized: boolean;
}

/** Narrow IPC bridge exposed by desktop/src/preload.ts on `window.beechSteam`. */
export interface BeechSteamBridge {
  readonly platform: 'win32' | 'linux' | 'darwin' | string;
  readonly steamDeck: boolean;
  readonly steamReady: boolean;
  getAuthTicket(): Promise<SteamAuthTicket>;
  onMicroTxnResponse(cb: (res: SteamMicroTxnResponse) => void): () => void;
  unlockAchievement(id: string): void;
  setRichPresence(key: string, value: string): void;
  openExternal(url: string): void;
  toggleFullscreen(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  quit(): void;
  saveBeachFile(suggestedName: string, text: string): Promise<boolean>;
}

declare global {
  interface Window {
    beechSteam?: BeechSteamBridge;
  }
}

export function steamBridge(): BeechSteamBridge | null {
  return typeof window !== 'undefined' && window.beechSteam ? window.beechSteam : null;
}

export function getRuntime(): Runtime {
  if (steamBridge() || import.meta.env.VITE_PLATFORM === 'steam') return 'steam';
  if (Capacitor.isNativePlatform()) {
    return Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
  }
  return 'web';
}

export function isSteam(): boolean {
  return getRuntime() === 'steam';
}

/** True for the Capacitor iOS and Android apps (not Steam, not browser). */
export function isMobileApp(): boolean {
  const r = getRuntime();
  return r === 'ios' || r === 'android';
}

/** True for any store-packaged build (iOS, Android, or Steam) that ships its own dist/. */
export function isPackagedApp(): boolean {
  return getRuntime() !== 'web';
}
