import { Capacitor } from '@capacitor/core';

import { isMobileApp, isSteam, steamBridge } from '../platform/runtime';
import { DEV_AUTH, type Account } from './account';
import { reportError, reportEvent } from './telemetry';

// Buying from the shop. In the apps the purchase goes through Apple or Google
// (StoreKit 2 / Google Play Billing, via @capgo/native-purchases); on Steam it
// goes through Steam Wallet (ISteamMicroTxn); we never see card details. On
// the web, when the server has web checkout switched on, you pay on Xsolla's
// Pay Station page (Xsolla is the merchant of record; docs/WEB_PAYMENTS.md)
// and Xsolla tells the server, which adds the item to your bag; otherwise the
// web shop sends you to the app.

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

/** A beech-buck pack: what real money buys (docs/BEECH_BUCKS.md). */
export interface ShopPack {
  id: string;
  name: string;
  usd: number;
  /** beech bucks it gives */
  bucks: number;
  blurb: string;
  featured: boolean;
  /** the store's own price for this person, when the app knows it */
  price?: string;
}

/** Something the shop sells for beech bucks. */
export interface ShopOffer {
  id: string;
  name: string;
  grants: { item: string; quantity: number }[];
  /** price in beech bucks (0: free) */
  bucks: number;
  blurb: string;
  featured: boolean;
}

/** A thing in your bag, and what each of its units trades in for (newest first). */
export interface BagEntry {
  item: string;
  owned: number;
  placed: number;
  free: number;
  values: number[];
}

export type ShopMode = 'native' | 'steam' | 'dev' | 'web';

/** In the mobile apps: StoreKit/Play. On Steam: Steam Wallet. Dev builds: pretend store. Web: Xsolla or app links. */
export function shopMode(): ShopMode {
  if (isSteam()) return 'steam';
  if (isMobileApp()) return 'native';
  if (DEV_AUTH) return 'dev';
  return 'web';
}

/**
 * Gift card and promo codes, and spending the credit they give: the web
 * (and development builds) only. In the iOS, Android, and Steam apps, digital
 * items must be bought through the platform store (App Store guideline 3.1.1,
 * Google Play's payments policy, Steamworks microtransaction rules), so those
 * builds show neither the code fields nor "Buy with credit".
 */
export function codesAllowed(mode: ShopMode = shopMode()): boolean {
  return mode !== 'native' && mode !== 'steam';
}

const env = import.meta.env;
/** store pages for "get the app" (set at build time once the apps are listed) */
export const APP_LINKS = {
  ios: String(env.VITE_APP_STORE_URL ?? ''),
  android: String(env.VITE_PLAY_STORE_URL ?? ''),
};

/** Web orders started here and not yet seen paid (checked again on return and when the shop opens). */
const WEB_ORDERS_KEY = 'beech.webOrders.v1';
function readWebOrders(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(WEB_ORDERS_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-20) : [];
  } catch {
    return [];
  }
}
function writeWebOrders(list: string[]): void {
  try {
    localStorage.setItem(WEB_ORDERS_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: the return link still carries the order id */
  }
}

export interface WebOrder {
  id: string;
  productId: string;
  status: 'created' | 'paid' | 'refunded' | 'canceled' | 'expired';
  grants: { item: string; quantity: number }[];
}

/** The `?web_order=` id Pay Station sends the player back with, or null. */
export function webOrderFromUrl(search: string): string | null {
  const id = new URLSearchParams(search).get('web_order') ?? '';
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** The query string without the return parameters (ours, and the ones Xsolla adds). */
export function withoutWebOrderParams(search: string): string {
  const q = new URLSearchParams(search);
  for (const k of ['web_order', 'user_id', 'foreignInvoice', 'invoice_id', 'status']) q.delete(k);
  const s = q.toString();
  return s ? `?${s}` : '';
}

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

const PENDING_STEAM_KEY = 'beech.pendingSteamOrders.v1';
function readPendingSteam(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_STEAM_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-20) : [];
  } catch {
    return [];
  }
}
function writePendingSteam(list: string[]): void {
  try {
    localStorage.setItem(PENDING_STEAM_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked */
  }
}

type Purchases = typeof import('@capgo/native-purchases').NativePurchases;
let plugin: Promise<{ purchases: Purchases }> | null = null;
/**
 * The store plugin, boxed. A Capacitor plugin is a Proxy that answers every
 * property, `then` included, so a promise (or async function) that resolves
 * with it bare never settles in the apps: the shop hung on "Opening the
 * shop…". Unbox it after the await: `(await native()).purchases`.
 */
function native(): Promise<{ purchases: Purchases }> {
  plugin ??= import('@capgo/native-purchases').then((m) => {
    // Finish purchases only after the server has confirmed them (see buy()):
    // the plugin's default consumes a consumable the moment Play reports it
    // bought, before the grant is checked — so a failed hand-over meant
    // paid and nothing granted, with nothing left to recover. The
    // capacitor.config value is the real switch (it applies from plugin
    // load); this call is a backup. Best effort: a plugin without
    // configure() must not break the shop.
    void m.NativePurchases.configure({ autoFinishTransactions: false }).catch(() => {});
    return { purchases: m.NativePurchases };
  });
  return plugin;
}

export class ShopApi {
  /** the server takes card payments on the web (Xsolla); learned from the product list */
  webCheckout = false;
  private readonly creditRequests = new Map<string, string>();

  constructor(private readonly account: Account) {}

  /**
   * The shop (docs/BEECH_BUCKS.md): beech-buck packs for real money, with the
   * store's local prices in the apps, and what beech bucks buy.
   * `storePacksAvailable` is false in the apps when the store offers none of
   * the packs (they aren't created there yet) — the packs list is empty
   * then, and the UI says so instead of showing a bare heading.
   */
  async catalog(): Promise<{ packs: ShopPack[]; offers: ShopOffer[]; storePacksAvailable: boolean }> {
    const res = await this.account.fetch('/api/store/catalog');
    if (!res.ok) throw new Error('the shop is closed right now');
    const data = (await res.json()) as { packs: ShopPack[]; offers: ShopOffer[]; webCheckout?: boolean };
    this.webCheckout = !!data.webCheckout;
    let packs = data.packs;
    let storePacksAvailable = true;
    if (shopMode() === 'native') {
      try {
        const p = (await native()).purchases;
        const { products } = await p.getProducts({ productIdentifiers: packs.map((x) => x.id) });
        for (const sp of products) {
          const mine = packs.find((x) => x.id === sp.identifier);
          if (mine) mine.price = sp.priceString;
        }
        // only what the store actually offers here can be bought
        packs = packs.filter((x) => x.price);
        storePacksAvailable = packs.length > 0;
      } catch (e) {
        reportError('shop', e, { source: 'shop:getProducts' });
        /* store unreachable: show US prices, buying will say why it can't */
      }
    }
    return { packs, offers: data.offers, storePacksAvailable };
  }

  /** Your beech bucks (and any owed after a refund). */
  async bucks(): Promise<{ bucks: number; debt: number }> {
    const res = await this.account.fetch('/api/credit');
    if (!res.ok) throw new Error('could not read your beech bucks');
    const d = (await res.json()) as { bucks?: number; debt?: number };
    return { bucks: d.bucks ?? 0, debt: d.debt ?? 0 };
  }

  /**
   * Buy a basket of offers with beech bucks, in one go ("buy what's missing").
   * The request ID is kept for that basket until a receipt comes back or the
   * server says no: if the answer is lost (offline, a timeout, a 5xx), trying
   * again sends the same ID, and the server answers with the first receipt
   * instead of charging twice (PR #118 review).
   */
  async buyBasket(lines: { product: string; quantity: number }[]): Promise<{ paid: number; bucks: number }> {
    const key = 'beech.basketRequest.v1:' + JSON.stringify([this.account.user?.id, lines.map((l) => [l.product, l.quantity])]);
    let requestId = this.creditRequests.get(key);
    try {
      requestId ??= sessionStorage.getItem(key) ?? undefined;
    } catch { /* storage blocked */ }
    requestId ??= crypto.randomUUID();
    this.creditRequests.set(key, requestId);
    try { sessionStorage.setItem(key, requestId); } catch { /* storage blocked */ }
    const clearRequest = () => {
      this.creditRequests.delete(key);
      try { sessionStorage.removeItem(key); } catch { /* storage blocked */ }
    };
    // a network failure throws here and keeps the ID for the retry
    const res = await this.account.fetch('/api/store/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ basket: lines, requestId }),
    });
    if (!res.ok) {
      // a definite no (not enough beech bucks, gone from the shop, a bad basket): a new try is a new purchase
      if (res.status < 500 && res.status !== 429) clearRequest();
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(msg ?? 'that did not go through');
    }
    const receipt = (await res.json()) as { paid: number; bucks: number };
    clearRequest();
    return receipt;
  }

  /** What's in your bag and what each thing trades in for. */
  async bag(): Promise<BagEntry[]> {
    const res = await this.account.fetch('/api/bag');
    if (!res.ok) throw new Error('could not read your bag');
    return ((await res.json()) as { items: BagEntry[] }).items;
  }

  /** Trade one (or more) of a thing in for its beech bucks. */
  async tradeIn(item: string, quantity = 1): Promise<{ credited: number; bucks: number }> {
    const res = await this.account.fetch('/api/bag/trade-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item, quantity }),
    });
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(msg ?? 'that did not go through');
    }
    return (await res.json()) as { credited: number; bucks: number };
  }

  /** The products, with the store's local prices in the apps (the shop before beech bucks). */
  async products(): Promise<ShopProduct[]> {
    const res = await this.account.fetch('/api/store/products');
    if (!res.ok) throw new Error('the shop is closed right now');
    const data = (await res.json()) as { products: ShopProduct[]; webCheckout?: boolean };
    const list = data.products;
    this.webCheckout = !!data.webCheckout;
    if (shopMode() === 'native') {
      try {
        const p = (await native()).purchases;
        const { products } = await p.getProducts({ productIdentifiers: list.map((x) => x.id) });
        for (const sp of products) {
          const mine = list.find((x) => x.id === sp.identifier);
          if (mine) mine.price = sp.priceString;
        }
        // only what the store actually offers here can be bought; free
        // things are claimed from the server, with no store involved
        return list.filter((x) => x.price || x.usd === 0);
      } catch (e) {
        reportError('shop', e, { source: 'shop:getProducts' });
        /* store unreachable: show US prices, buying will say why it can't */
      }
    }
    return list;
  }

  /**
   * Buy a product. The store takes the payment; then the server checks the
   * purchase and adds it to your bag. If the hand-over to the server fails
   * (offline), it's kept and retried (`retryPending`), so nothing paid for
   * is lost. The purchase is finished with the store (consumed on Android,
   * finished on iOS) only after the server confirms it — finishing earlier
   * would leave a paid purchase with no grant and nothing to recover.
   * 'pending' is a payment the store hasn't completed yet (for example a
   * cash payment): the bucks arrive when it completes, and the recovery in
   * `retryPending()` hands it over then.
   */
  async buy(productId: string): Promise<'bought' | 'cancelled' | 'pending'> {
    const user = this.account.user;
    if (!user) throw new Error('sign in to buy');
    let pending: Pending;
    // the store's answer, kept so the purchase can be finished with the
    // store once the server confirms it (native mode only)
    let bought: { transactionId?: string; purchaseToken?: string } | undefined;
    const mode = shopMode();
    if (mode === 'steam') {
      return this.buyOnSteam(productId);
    }
    if (mode === 'native') {
      const p = (await native()).purchases;
      let t;
      try {
        t = await p.purchaseProduct({
          productIdentifier: productId,
          // ties the purchase to this account (the server checks it); a UUID, no personal data
          appAccountToken: user.id,
          // Android: consume it, so the same thing can be bought again —
          // but only after the server confirms it (finishStorePurchase):
          // with autoFinishTransactions off, this flag keeps the plugin
          // from consuming it the moment Play reports it bought.
          isConsumable: true,
          autoAcknowledgePurchases: false,
        });
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (/cancel/i.test(msg)) {
          reportEvent('purchase_cancel', { product: productId });
          return 'cancelled';
        }
        if (/pending/i.test(msg)) {
          reportEvent('purchase_pending', { product: productId });
          return 'pending';
        }
        reportError('shop', e, { source: 'shop:purchase', meta: { product: productId } });
        throw e;
      }
      const ios = Capacitor.getPlatform() === 'ios';
      if (ios && !t.jwsRepresentation) {
        const err = new Error('the App Store did not return a signed purchase');
        reportError('shop', err, { source: 'shop:purchase', meta: { product: productId } });
        throw err;
      }
      if (!ios && !t.purchaseToken) {
        const err = new Error('Google Play did not return a purchase token');
        reportError('shop', err, { source: 'shop:purchase', meta: { product: productId } });
        throw err;
      }
      pending = ios ? { platform: 'ios', productId, jws: t.jwsRepresentation } : { platform: 'android', productId, token: t.purchaseToken };
      bought = t;
    } else if (mode === 'dev') {
      pending = { platform: 'dev', productId, token: `dev-${crypto.randomUUID()}` };
    } else {
      throw new Error('buy in the beech app on iPhone or Android');
    }
    writePending([...readPending(), pending]);
    await this.deliver(pending);
    if (mode === 'native' && bought) {
      // the server confirmed it: finish the purchase with the store, so the
      // same consumable can be bought again. A failure here is not fatal —
      // the grant is recorded, and the recovery finishes it later.
      await this.finishStorePurchase(bought).catch((e) => reportError('shop', e, { source: 'shop:finish', meta: { product: productId } }));
    }
    reportEvent('purchase_success', { product: productId, mode });
    return 'bought';
  }

  /**
   * Finish a native purchase with the store, after the server confirmed it:
   * consume it on Android (acknowledges it and frees it for re-purchase),
   * finish the StoreKit transaction on iOS. Never called before `deliver()`
   * succeeds — an unfinished purchase is what the recovery can still save.
   */
  private async finishStorePurchase(t: { transactionId?: string; purchaseToken?: string }): Promise<void> {
    const p = (await native()).purchases;
    if (Capacitor.getPlatform() === 'android') {
      if (!t.purchaseToken) throw new Error('no purchase token to consume');
      await p.consumePurchase({ purchaseToken: t.purchaseToken });
      return;
    }
    if (!t.transactionId) throw new Error('no transaction to finish');
    await p.finishTransaction({ transactionId: t.transactionId });
  }

  private async buyOnSteam(productId: string): Promise<'bought' | 'cancelled'> {
    const steam = steamBridge();
    if (!steam) throw new Error('Steam is not running');
    const initRes = await this.account.fetch('/api/store/steam/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId }),
    });
    if (!initRes.ok) {
      const msg = ((await initRes.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(msg ?? 'Steam checkout could not be started');
    }
    const { orderId } = (await initRes.json()) as { orderId: string };
    writePendingSteam([...readPendingSteam().filter((x) => x !== orderId), orderId]);

    const authorized = await new Promise<boolean>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        unsub();
        reject(new Error('Steam Wallet authorization timed out'));
      }, 5 * 60 * 1000);
      const unsub = steam.onMicroTxnResponse((ev) => {
        if (ev.orderId !== orderId) return;
        window.clearTimeout(timer);
        unsub();
        resolve(ev.authorized);
      });
    });

    if (!authorized) {
      writePendingSteam(readPendingSteam().filter((x) => x !== orderId));
      void this.account.fetch('/api/store/steam/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      return 'cancelled';
    }

    await this.finalizeSteamOrder(orderId);
    return 'bought';
  }

  private async finalizeSteamOrder(orderId: string): Promise<void> {
    const res = await this.account.fetch('/api/store/steam/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId }),
    });
    // Drop the pending order only on terminal failures. 402 means Steam
    // could not finalize the purchase yet (transient — the order is still
    // open), so keep it pending and let retryPending() try again instead
    // of losing the purchase.
    const terminal = res.status === 400 || res.status === 404 || res.status === 409;
    if (res.ok || terminal) {
      writePendingSteam(readPendingSteam().filter((x) => x !== orderId));
    }
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(msg ?? 'the Steam purchase could not be finalized yet; it will be retried');
    }
  }

  private async deliver(p: Pending): Promise<void> {
    let res: Response;
    try {
      res = await this.account.fetch('/api/store/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      });
    } catch (e) {
      reportError('shop', e, { source: 'shop:deliver', meta: { product: p.productId, platform: p.platform } });
      throw e;
    }
    // delivered (or never deliverable): stop retrying it
    if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429)) {
      writePending(readPending().filter((x) => !(x.jws === p.jws && x.token === p.token)));
    }
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      const err = new Error(msg ?? 'the purchase could not be added to your bag yet; it will be retried');
      reportError('shop', err, { source: 'shop:deliver', meta: { product: p.productId, platform: p.platform, status: res.status } });
      throw err;
    }
  }

  /** Hand any purchases the server hasn't confirmed yet over again (on sign-in, and when the shop opens). */
  async retryPending(): Promise<number> {
    let done = 0;
    for (const p of readPending()) {
      try {
        await this.deliver(p);
        done++;
        // Android: the token is in the record — finish it now that the
        // server confirmed it. iOS finishes through recoverUnfinished()
        // below (the record holds the signed transaction, not its id).
        if (shopMode() === 'native' && p.platform === 'android' && p.token) {
          try {
            await (await native()).purchases.consumePurchase({ purchaseToken: p.token });
          } catch {
            /* granted but not consumed: the recovery finishes it */
          }
        }
      } catch {
        /* still offline, or the server said no: deliver() already dropped the hopeless ones */
      }
    }
    for (const orderId of readPendingSteam()) {
      try {
        await this.finalizeSteamOrder(orderId);
        done++;
      } catch {
        /* still offline or not finalized yet */
      }
    }
    done += await this.recoverUnfinished();
    return done;
  }

  /**
   * Purchases the store still holds as unfinished — the app was killed, or
   * the hand-over was lost before the server confirmed it. Each one is
   * handed over and then finished, so nothing paid for is lost. Native apps
   * only (the web mock answers with no transactions). Runs on sign-in and
   * when the shop opens, through retryPending(). A transaction the server
   * won't confirm stays unfinished and is tried again next time; Google
   * refunds unacknowledged purchases after three days, so a stranded one
   * never silently keeps the player's money.
   */
  async recoverUnfinished(): Promise<number> {
    if (shopMode() !== 'native') return 0;
    let transactions: { productIdentifier: string; purchaseToken?: string; jwsRepresentation?: string; transactionId: string }[];
    try {
      ({ transactions } = await (await native()).purchases.getUnfinishedTransactions());
    } catch (e) {
      reportError('shop', e, { source: 'shop:unfinished' });
      return 0;
    }
    let done = 0;
    for (const t of transactions ?? []) {
      const ios = Capacitor.getPlatform() === 'ios';
      if (ios && !t.jwsRepresentation) continue;
      if (!ios && !t.purchaseToken) continue;
      const pending: Pending = ios
        ? { platform: 'ios', productId: t.productIdentifier, jws: t.jwsRepresentation }
        : { platform: 'android', productId: t.productIdentifier, token: t.purchaseToken };
      try {
        await this.deliver(pending);
      } catch {
        // still unverified (the server said no, or offline): leave it
        // unfinished so the next recovery tries again
        continue;
      }
      try {
        await this.finishStorePurchase(t);
        done++;
      } catch {
        // granted but not finished: the next recovery finishes it
      }
    }
    return done;
  }

  // --- web checkout (docs/WEB_PAYMENTS.md): the browser only, never the apps ---
  /**
   * Start paying for a product on the web. Returns the Pay Station page to
   * send the player to; the server prices it, and grants it when Xsolla
   * says it's paid. The order id is remembered so the bag can be refreshed
   * when it lands, even if the return link is lost.
   */
  async startWebCheckout(productId: string): Promise<string> {
    if (shopMode() !== 'web') throw new Error('buy in the beech app');
    // An explicit locale region is the fallback for buyers without IPv4.
    const country = (() => {
      try {
        const region = new Intl.Locale(navigator.language).region;
        return region && /^[A-Z]{2}$/.test(region) ? region : undefined;
      } catch {
        return undefined;
      }
    })();
    const res = await this.account.fetch('/api/store/web-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, ...(country ? { country } : {}) }),
    });
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      const err = new Error(msg ?? 'the checkout could not be opened');
      reportError('shop', err, { source: 'shop:webCheckout', meta: { product: productId, status: res.status } });
      throw err;
    }
    const { order, url } = (await res.json()) as { order: string; url: string };
    writeWebOrders([...readWebOrders().filter((x) => x !== order), order]);
    return url;
  }

  /** One of your web orders, or null if the server doesn't know it. */
  async webOrder(id: string): Promise<WebOrder | null> {
    const res = await this.account.fetch(`/api/store/web-orders/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('could not check that order');
    return ((await res.json()) as { order: WebOrder }).order;
  }

  /**
   * Wait for a web order to be paid (Xsolla's webhook can land a little
   * after the player is sent back). Returns the order once settled, or
   * whatever it was when time ran out.
   */
  async waitForWebOrder(id: string, timeoutMs = 60000, everyMs = 2000): Promise<WebOrder | null> {
    const end = Date.now() + timeoutMs;
    let o: WebOrder | null = null;
    for (;;) {
      try {
        o = await this.webOrder(id);
      } catch {
        /* offline for a moment: keep trying */
      }
      if (!o || o.status !== 'created' || Date.now() >= end) break;
      await new Promise((r) => setTimeout(r, everyMs));
    }
    if (o && o.status !== 'created') writeWebOrders(readWebOrders().filter((x) => x !== id));
    if (!o) writeWebOrders(readWebOrders().filter((x) => x !== id));
    return o;
  }

  /** Check remembered web orders once (when the shop opens): how many turned out paid. */
  async checkWebOrders(): Promise<number> {
    let paid = 0;
    for (const id of readWebOrders()) {
      try {
        const o = await this.webOrder(id);
        if (o?.status === 'paid') paid++;
        if (!o || o.status !== 'created') writeWebOrders(readWebOrders().filter((x) => x !== id));
      } catch {
        /* try again next time */
      }
    }
    return paid;
  }

  // --- gift cards, promo codes, credit (docs/GIFT_CARDS_PROMOS.md) ---
  // Credit comes only from gift cards (redeemed server-side) and is spent
  // server-side too: the price always comes from the server's product list,
  // and a promo code is validated there, so nothing here can set a price.
  /** Account credit from gift cards, in USD cents. */
  async credit(): Promise<number> {
    const res = await this.account.fetch('/api/credit');
    if (!res.ok) throw new Error('could not read your credit');
    return ((await res.json()) as { creditCents: number }).creditCents;
  }

  /** Redeem a gift card code into account credit. */
  async redeemGiftCard(code: string): Promise<{ creditedCents: number; creditCents: number; credited: number; bucks: number }> {
    const res = await this.account.fetch('/api/gift-cards/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(msg ?? 'that code did not work');
    }
    return (await res.json()) as { creditedCents: number; creditCents: number; credited: number; bucks: number };
  }

  /** Promo codes loaded onto your account, and the best bonus bb for each pack. */
  async myPromos(): Promise<{
    promos: { code: string; kind: 'percent' | 'fixed'; value: number; appliesTo: string | null; status: string; bonusBucks: number; expiresAt: number | null }[];
    packBonuses: Record<string, { code: string; bonusBucks: number }>;
  }> {
    const res = await this.account.fetch('/api/promo-codes/mine');
    if (!res.ok) throw new Error('could not load your promo codes');
    return (await res.json()) as {
      promos: { code: string; kind: 'percent' | 'fixed'; value: number; appliesTo: string | null; status: string; bonusBucks: number; expiresAt: number | null }[];
      packBonuses: Record<string, { code: string; bonusBucks: number }>;
    };
  }

  /** Load a promo code onto your account (used automatically on your next matching bb pack purchase). */
  async loadPromo(code: string): Promise<{
    promo: { code: string; kind: 'percent' | 'fixed'; value: number; appliesTo: string | null; status: string };
    promos: { code: string; kind: 'percent' | 'fixed'; value: number; appliesTo: string | null; status: string; bonusBucks: number; expiresAt: number | null }[];
    packBonuses: Record<string, { code: string; bonusBucks: number }>;
  }> {
    const res = await this.account.fetch('/api/promo-codes/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(msg ?? 'that code did not work');
    }
    return (await res.json()) as {
      promo: { code: string; kind: 'percent' | 'fixed'; value: number; appliesTo: string | null; status: string };
      promos: { code: string; kind: 'percent' | 'fixed'; value: number; appliesTo: string | null; status: string; bonusBucks: number; expiresAt: number | null }[];
      packBonuses: Record<string, { code: string; bonusBucks: number }>;
    };
  }

  /** What a product costs with a promo code, before buying. */
  async quote(
    productId: string,
    promoCode?: string,
  ): Promise<{ priceCents: number; discountCents: number; finalCents: number; price: number; final: number; promo?: string }> {
    const res = await this.account.fetch('/api/store/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, ...(promoCode ? { promoCode } : {}) }),
    });
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(msg ?? 'could not price that');
    }
    return (await res.json()) as { priceCents: number; discountCents: number; finalCents: number; price: number; final: number; promo?: string };
  }

  /** Buy a product with account credit, with an optional promo code. */
  buyWithCredit(productId: string, promoCode?: string) {
    return this.creditPurchase(productId, promoCode, false);
  }

  claimFree(productId: string) {
    return this.creditPurchase(productId, undefined, true);
  }

  private async creditPurchase(productId: string, promoCode: string | undefined, freeOnly: boolean) {
    const prefix = freeOnly ? 'beech.freeClaim.v1:' : 'beech.creditRequest.v1:';
    const key = prefix + JSON.stringify([this.account.user?.id, productId, promoCode]);
    let requestId = this.creditRequests.get(key);
    try {
      requestId ??= sessionStorage.getItem(key) ?? undefined;
    } catch { /* storage blocked */ }
    requestId ??= crypto.randomUUID();
    this.creditRequests.set(key, requestId);
    try { sessionStorage.setItem(key, requestId); } catch { /* storage blocked */ }
    const clearRequest = () => {
      this.creditRequests.delete(key);
      try { sessionStorage.removeItem(key); } catch { /* storage blocked */ }
    };
    const res = await this.account.fetch('/api/store/credit-purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, requestId, ...(promoCode ? { promoCode } : {}), ...(freeOnly ? { freeOnly } : {}) }),
    });
    if (!res.ok) {
      if (res.status < 500 && res.status !== 429) clearRequest();
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(msg ?? 'the credit purchase did not go through');
    }
    const receipt = (await res.json()) as { paidCents: number; discountCents: number; creditCents: number; paid: number; discount: number; bucks: number };
    clearRequest();
    return receipt;
  }
}
