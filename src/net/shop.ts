import { Capacitor } from '@capacitor/core';

import { DEV_AUTH, type Account } from './account';

// Buying from the shop. In the apps the purchase goes through Apple or Google
// (StoreKit 2 / Google Play Billing, via @capgo/native-purchases); we never
// see card details. The app hands the store's proof (a signed transaction on
// iOS, a purchase token on Android) to the server, which checks it with the
// store and adds what you bought to your bag. The web shop shows the same
// things but sends you to the app to buy them.

export interface ShopProduct {
  id: string;
  name: string;
  grants: { item: string; quantity: number }[];
  usd: number;
  blurb: string;
  featured: boolean;
  /** the store's own price for this person (currency and tax included), when the app knows it */
  price?: string;
}

export type ShopMode = 'native' | 'dev' | 'web';

/** In the apps: buy here. Development builds: a pretend store. The web: get the app. */
export function shopMode(): ShopMode {
  if (Capacitor.isNativePlatform()) return 'native';
  if (DEV_AUTH) return 'dev';
  return 'web';
}

const env = import.meta.env;
/** store pages for "get the app" (set at build time once the apps are listed) */
export const APP_LINKS = {
  ios: String(env.VITE_APP_STORE_URL ?? ''),
  android: String(env.VITE_PLAY_STORE_URL ?? ''),
};

const PENDING_KEY = 'beech.pendingPurchases.v1';
interface Pending {
  platform: 'ios' | 'android' | 'dev';
  productId: string;
  jws?: string;
  token?: string;
}
function readPending(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as Pending[];
  } catch {
    return [];
  }
}
function writePending(list: Pending[]): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: a failed hand-over is retried only this session */
  }
}

type Purchases = typeof import('@capgo/native-purchases').NativePurchases;
let plugin: Promise<Purchases> | null = null;
function native(): Promise<Purchases> {
  plugin ??= import('@capgo/native-purchases').then((m) => m.NativePurchases);
  return plugin;
}

export class ShopApi {
  constructor(private readonly account: Account) {}

  /** The products, with the store's local prices in the apps. */
  async products(): Promise<ShopProduct[]> {
    const res = await this.account.fetch('/api/store/products');
    if (!res.ok) throw new Error('the shop is closed right now');
    const list = ((await res.json()) as { products: ShopProduct[] }).products;
    if (shopMode() === 'native') {
      try {
        const p = await native();
        const { products } = await p.getProducts({ productIdentifiers: list.map((x) => x.id) });
        for (const sp of products) {
          const mine = list.find((x) => x.id === sp.identifier);
          if (mine) mine.price = sp.priceString;
        }
        // only what the store actually offers here can be bought
        return list.filter((x) => x.price);
      } catch {
        /* store unreachable: show US prices, buying will say why it can't */
      }
    }
    return list;
  }

  /**
   * Buy a product. The store takes the payment; then the server checks the
   * purchase and adds it to your bag. If the hand-over to the server fails
   * (offline), it's kept and retried (`retryPending`), so nothing paid for
   * is lost.
   */
  async buy(productId: string): Promise<'bought' | 'cancelled'> {
    const user = this.account.user;
    if (!user) throw new Error('sign in to buy');
    let pending: Pending;
    const mode = shopMode();
    if (mode === 'native') {
      const p = await native();
      let t;
      try {
        t = await p.purchaseProduct({
          productIdentifier: productId,
          // ties the purchase to this account (the server checks it); a UUID, no personal data
          appAccountToken: user.id,
          // Android: consume it, so the same thing can be bought again
          isConsumable: true,
        });
      } catch (e) {
        if (/cancel/i.test(String((e as Error)?.message ?? e))) return 'cancelled';
        throw e;
      }
      const ios = Capacitor.getPlatform() === 'ios';
      if (ios && !t.jwsRepresentation) throw new Error('the App Store did not return a signed purchase');
      if (!ios && !t.purchaseToken) throw new Error('Google Play did not return a purchase token');
      pending = ios ? { platform: 'ios', productId, jws: t.jwsRepresentation } : { platform: 'android', productId, token: t.purchaseToken };
    } else if (mode === 'dev') {
      pending = { platform: 'dev', productId, token: `dev-${crypto.randomUUID()}` };
    } else {
      throw new Error('buy in the beech app on iPhone or Android');
    }
    writePending([...readPending(), pending]);
    await this.deliver(pending);
    return 'bought';
  }

  private async deliver(p: Pending): Promise<void> {
    const res = await this.account.fetch('/api/store/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    // delivered (or never deliverable): stop retrying it
    if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429)) {
      writePending(readPending().filter((x) => !(x.jws === p.jws && x.token === p.token)));
    }
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(msg ?? 'the purchase could not be added to your bag yet; it will be retried');
    }
  }

  /** Hand any purchases the server hasn't confirmed yet over again (on sign-in, and when the shop opens). */
  async retryPending(): Promise<number> {
    let done = 0;
    for (const p of readPending()) {
      try {
        await this.deliver(p);
        done++;
      } catch {
        /* still offline, or the server said no: deliver() already dropped the hopeless ones */
      }
    }
    return done;
  }
}
