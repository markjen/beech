// Notifications for the inbox, on every client (docs/INBOX_NOTIFICATIONS.md,
// "Push"). One interface, three ways to reach the player:
//
// - web: Web Push through the service worker (public/sw.js), VAPID key from
//   GET /api/push/config. On iPhone this needs the site on the Home Screen.
// - ios / android: native push (@capacitor/push-notifications): APNs on iOS,
//   FCM on Android. Only in app builds made with the push setup in place
//   (they add "BeechPush/1" to the user agent: capacitor.config.ts), because
//   registering without it fails natively.
// - steam: there is no push service for Steam games, so the running app
//   (focused or not, minimised included) shows an OS notification itself
//   when the 30 s poll brings something new (window.beechSteam.notify).
//
// The server decides what is pushed and when (server/src/push.ts); this file
// only subscribes the device and reacts to taps.
import { getRuntime, steamBridge } from './runtime';
import type { Account } from '../net/account';

export type NotifyChannel = 'web' | 'native' | 'steam';
export type NotifyPrefs = { gifts: boolean; neighbors: boolean; invites: boolean };

/** this device's choice: notifications on or off (absent: never asked) */
const DEVICE_KEY = 'beech.notify.v1';
const ASKED_KEY = 'beech.notifyAsked.v1';
const nativePushBuild = () => typeof navigator !== 'undefined' && navigator.userAgent.includes('BeechPush/');

const store = {
  get: (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: forget it */
    }
  },
};

const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** the pushed kinds, and the setting each falls under (server/src/push.ts PUSH_KINDS) */
export const PUSHED_KINDS: Record<string, keyof NotifyPrefs> = {
  visit: 'gifts',
  gift: 'gifts',
  neighbor_request: 'neighbors',
  neighbor_linked: 'neighbors',
  invite_settled: 'invites',
};

function b64uToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export class Notifier {
  private config: Promise<{ web: string | null; ios: boolean; android: boolean } | null> | null = null;
  private nativeToken: string | null = null;
  private nativeListening = false;
  private prefsCache: NotifyPrefs | null = null;

  constructor(
    private readonly account: Account,
    private readonly openInbox: () => void,
  ) {}

  private serverConfig() {
    this.config ??= this.account
      .fetch('/api/push/config')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    return this.config;
  }

  /** how this device can be reached, or null when it can't */
  async channel(): Promise<NotifyChannel | null> {
    const rt = getRuntime();
    if (rt === 'steam') return steamBridge()?.notify ? 'steam' : null;
    const cfg = await this.serverConfig();
    if (!cfg) return null;
    if (rt === 'ios' || rt === 'android') return nativePushBuild() && cfg[rt] ? 'native' : null;
    if (!cfg.web || typeof navigator === 'undefined' || !('serviceWorker' in navigator) || typeof PushManager === 'undefined') return null;
    if (!import.meta.env.PROD) return null; // the service worker only runs in builds
    return 'web';
  }

  /** this device's switch */
  get on(): boolean {
    return store.get(DEVICE_KEY) === 'on';
  }

  /** the OS said no: the switch can't turn it on (the browser's or phone's settings can) */
  async blocked(): Promise<boolean> {
    const ch = await this.channel();
    if (ch === 'web') return typeof Notification !== 'undefined' && Notification.permission === 'denied';
    if (ch === 'native') {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      return (await PushNotifications.checkPermissions()).receive === 'denied';
    }
    return false;
  }

  /** Ask once, after the first thing lands in the inbox (never at start-up). */
  shouldAsk(): boolean {
    return store.get(DEVICE_KEY) === null && store.get(ASKED_KEY) === null;
  }
  markAsked(): void {
    store.set(ASKED_KEY, String(Date.now()));
  }

  /** Turn this device on: the OS permission, then the subscription. False if it didn't happen. */
  async enable(): Promise<boolean> {
    const ch = await this.channel();
    if (!ch) return false;
    let ok = false;
    try {
      if (ch === 'steam') ok = true;
      else if (ch === 'web') ok = await this.subscribeWeb(true);
      else ok = await this.subscribeNative(true);
    } catch {
      ok = false;
    }
    store.set(DEVICE_KEY, ok ? 'on' : 'off');
    return ok;
  }

  /** Turn this device off: the server forgets it. */
  async disable(): Promise<void> {
    store.set(DEVICE_KEY, 'off');
    const ch = await this.channel();
    try {
      if (ch === 'web') {
        const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
        if (sub) {
          await this.forget(sub.endpoint);
          await sub.unsubscribe();
        }
      } else if (ch === 'native' && this.nativeToken) {
        await this.forget(this.nativeToken);
        const { PushNotifications } = await import('@capacitor/push-notifications');
        await PushNotifications.unregister();
      }
    } catch {
      /* offline: signing out or the push service will clear it */
    }
  }

  /**
   * After sign-in (or start-up signed in): if this device is on, tell the
   * server again. Signing out removed the subscription with the session.
   */
  async resync(): Promise<void> {
    this.prefsCache = null;
    const ch = await this.channel();
    if (ch === 'native') await this.listenNative();
    if (!this.on || !this.account.user) return;
    try {
      if (ch === 'web') await this.subscribeWeb(false);
      else if (ch === 'native') await this.subscribeNative(false);
    } catch {
      /* next start-up tries again */
    }
  }

  private async post(body: Record<string, unknown>): Promise<boolean> {
    const res = await this.account.fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, tz: tz() }),
    });
    return res.ok;
  }
  private async forget(endpoint: string): Promise<void> {
    await this.account.fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
  }

  private async subscribeWeb(ask: boolean): Promise<boolean> {
    const cfg = await this.serverConfig();
    if (!cfg?.web) return false;
    if (Notification.permission !== 'granted') {
      if (!ask || (await Notification.requestPermission()) !== 'granted') return false;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(cfg.web) });
    const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    return this.post({ platform: 'web', endpoint: j.endpoint, keys: j.keys });
  }

  private async listenNative(): Promise<void> {
    if (this.nativeListening) return;
    this.nativeListening = true;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.addListener('registration', (t) => {
      this.nativeToken = t.value;
      if (this.on && this.account.user) void this.post({ platform: getRuntime(), endpoint: t.value });
    });
    // a tap on a push: open the inbox
    await PushNotifications.addListener('pushNotificationActionPerformed', () => this.openInbox());
  }

  private async subscribeNative(ask: boolean): Promise<boolean> {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await this.listenNative();
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') {
      if (!ask) return false;
      perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return false;
    }
    // the token arrives through the 'registration' listener, which posts it
    await PushNotifications.register();
    return true;
  }

  // ---- what the player wants pushed (stored on the server, for every device)

  async prefs(): Promise<NotifyPrefs | null> {
    if (this.prefsCache) return this.prefsCache;
    try {
      const r = await this.account.fetch('/api/notify-prefs');
      if (r.ok) this.prefsCache = (await r.json()) as NotifyPrefs;
    } catch {
      /* offline */
    }
    return this.prefsCache;
  }
  async setPref(k: keyof NotifyPrefs, on: boolean): Promise<NotifyPrefs | null> {
    const r = await this.account.fetch('/api/notify-prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [k]: on }),
    });
    if (r.ok) this.prefsCache = (await r.json()) as NotifyPrefs;
    return this.prefsCache;
  }

  /**
   * Steam: something new arrived (from the poll). Shown only while the game
   * isn't the window in front, for pushed kinds the player hasn't turned off.
   */
  async local(kind: string, text: string): Promise<void> {
    const steam = steamBridge();
    if (!steam?.notify || !this.on) return;
    if (typeof document !== 'undefined' && document.hasFocus() && !document.hidden) return;
    const pref = PUSHED_KINDS[kind];
    if (!pref) return;
    const prefs = await this.prefs();
    if (prefs && !prefs[pref]) return;
    steam.notify('beech', text);
  }
}

/** a tap on a notification while the app was closed (?inbox=1, web and Steam) */
export function openedFromNotification(): boolean {
  try {
    const u = new URL(location.href);
    if (u.searchParams.get('inbox') !== '1') return false;
    u.searchParams.delete('inbox');
    history.replaceState(history.state, '', u.toString());
    return true;
  } catch {
    return false;
  }
}
