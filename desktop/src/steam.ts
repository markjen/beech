// Thin wrapper around steamworks.js so the Electron main process stays clean
// and degrades gracefully when launched locally without Steam running.

export interface SteamAuthTicketResult {
  ticketHex: string;
  steamId: string;
  personaName: string;
}

export interface MicroTxnCallbackEvent {
  appId: number;
  orderId: string;
  authorized: boolean;
}

type SteamClient = {
  localplayer: {
    getSteamId(): { steamId64: bigint };
    getName(): string;
    setRichPresence(key: string, value: string): void;
  };
  auth: {
    getAuthTicketForWebApi(identity?: string): Promise<{ getBytes(): Buffer; cancel(): void }>;
  };
  achievement: {
    activate(name: string): boolean;
  };
  overlay: {
    activateToWebPage(url: string): void;
  };
  utils: {
    isSteamRunningOnSteamDeck?: () => boolean;
  };
  callback: {
    register(cb: number, fn: (data: { app_id: number; order_id: bigint; authorized: boolean }) => void): { disconnect(): void };
    SteamCallback: { MicroTxnAuthorizationResponse: number };
  };
};

type SteamworksModule = {
  init(appId?: number): SteamClient;
  restartAppIfNecessary(appId: number): boolean;
  electronEnableSteamOverlay(disableEachFrame?: boolean): void;
};

let client: SteamClient | null = null;
let microTxnListeners: Array<(ev: MicroTxnCallbackEvent) => void> = [];

/**
 * Initialize Steamworks BEFORE `app.whenReady()` and `BrowserWindow` creation
 * so the Steam Overlay hooks into Chromium's GPU process reliably.
 */
export function initSteam(appId: number | null, requireRestart: boolean): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sw = require('steamworks.js') as SteamworksModule;
    if (requireRestart && appId && sw.restartAppIfNecessary(appId)) {
      return false; // Steam is re-launching us; caller should exit immediately
    }
    client = appId ? sw.init(appId) : sw.init();
    sw.electronEnableSteamOverlay();
    if (client.callback?.SteamCallback?.MicroTxnAuthorizationResponse !== undefined) {
      client.callback.register(client.callback.SteamCallback.MicroTxnAuthorizationResponse, (data) => {
        const ev: MicroTxnCallbackEvent = {
          appId: Number(data.app_id),
          orderId: String(data.order_id),
          authorized: Boolean(data.authorized),
        };
        for (const fn of microTxnListeners) fn(ev);
      });
    }
    return true;
  } catch (err) {
    console.warn('[steam] Steamworks unavailable (offline or dev launch):', (err as Error)?.message ?? err);
    client = null;
    return true;
  }
}

export function isSteamReady(): boolean {
  return client !== null;
}

export function isSteamDeck(): boolean {
  if (process.env.SteamDeck === '1') return true;
  try {
    return Boolean(client?.utils?.isSteamRunningOnSteamDeck?.());
  } catch {
    return false;
  }
}

export async function getAuthTicket(identity = 'beech'): Promise<SteamAuthTicketResult> {
  if (!client) throw new Error('Steam is not running');
  const ticket = await client.auth.getAuthTicketForWebApi(identity);
  const ticketHex = ticket.getBytes().toString('hex');
  const steamId = client.localplayer.getSteamId().steamId64.toString();
  const personaName = client.localplayer.getName() ?? '';
  return { ticketHex, steamId, personaName };
}

export function onMicroTxnResponse(fn: (ev: MicroTxnCallbackEvent) => void): () => void {
  microTxnListeners.push(fn);
  return () => {
    microTxnListeners = microTxnListeners.filter((x) => x !== fn);
  };
}

export function unlockAchievement(id: string): void {
  try {
    client?.achievement.activate(id);
  } catch {
    /* ignore */
  }
}

export function setRichPresence(key: string, value: string): void {
  try {
    client?.localplayer.setRichPresence(key, value);
  } catch {
    /* ignore */
  }
}

export function openOverlayUrl(url: string): boolean {
  if (!client) return false;
  try {
    client.overlay.activateToWebPage(url);
    return true;
  } catch {
    return false;
  }
}
