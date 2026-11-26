// The shop in the apps: a Capacitor plugin is a Proxy that answers every
// property, `then` included, so handing it through a promise bare never
// settles. The shop hung on "Opening the shop…" on Android because of it.
// And a purchase is finished with the store only after the server confirms
// it: the plugin's default consumes a consumable the moment Play reports it
// bought, before the grant is checked, so a failed hand-over meant paid and
// nothing granted, with nothing left to recover.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import type { Account } from '../src/net/account';

const calls: { method: string; args: unknown }[] = [];
const sequence: string[] = [];
let productPrices: Record<string, string> = { bucks_100: '€1,09' };
let purchaseResult: Record<string, unknown> = { transactionId: 'GPA.1', purchaseToken: 'tok-1', productIdentifier: 'bucks_100' };
let purchaseError: Error | null = null;
let unfinished: Record<string, unknown>[] = [];
let deliverStatus = 200;

// like registerPlugin() on a native platform: any property is a native
// method, and an unknown one (`then`) rejects without ever answering
const pluginProxy = new Proxy(
  {},
  {
    get: (_, prop) => {
      if (prop === 'configure')
        return async (...args: unknown[]) => {
          calls.push({ method: 'configure', args });
        };
      if (prop === 'getProducts')
        return async ({ productIdentifiers }: { productIdentifiers: string[] }) => {
          calls.push({ method: 'getProducts', args: productIdentifiers });
          return {
            products: productIdentifiers
              .filter((id) => productPrices[id])
              .map((id) => ({ identifier: id, priceString: productPrices[id] })),
          };
        };
      if (prop === 'purchaseProduct')
        return async (opts: unknown) => {
          calls.push({ method: 'purchaseProduct', args: opts });
          if (purchaseError) throw purchaseError;
          return purchaseResult;
        };
      if (prop === 'consumePurchase')
        return async (opts: unknown) => {
          calls.push({ method: 'consumePurchase', args: opts });
          sequence.push('consume');
        };
      if (prop === 'finishTransaction')
        return async (opts: unknown) => {
          calls.push({ method: 'finishTransaction', args: opts });
          sequence.push('finish');
        };
      if (prop === 'getUnfinishedTransactions')
        return async () => {
          calls.push({ method: 'getUnfinishedTransactions', args: undefined });
          return { transactions: unfinished };
        };
      return () => Promise.reject(new Error(`${String(prop)}() is not implemented on android`));
    },
  },
);
vi.mock('@capgo/native-purchases', () => ({ NativePurchases: pluginProxy }));
vi.mock('../src/platform/runtime', async (orig) => ({
  ...(await orig<typeof import('../src/platform/runtime')>()),
  isMobileApp: () => true,
  isSteam: () => false,
}));

const { ShopApi } = await import('../src/net/shop');

const fetchCalls: { url: string; body: unknown }[] = [];
function testAccount(): Account {
  return {
    user: { id: 'u1' },
    fetch: (async (url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      fetchCalls.push({ url, body });
      if (url === '/api/store/catalog')
        return new Response(
          JSON.stringify({
            packs: [
              { id: 'bucks_100', name: '130 sand bucks', blurb: '', usd: 9.99, bucks: 130, featured: false },
              { id: 'bucks_30', name: '33 sand bucks', blurb: '', usd: 2.99, bucks: 33, featured: false },
            ],
            offers: [],
          }),
        );
      if (url === '/api/store/purchase') {
        sequence.push('deliver');
        return new Response(JSON.stringify({ already: false }), { status: deliverStatus });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as Account['fetch'],
  } as unknown as Account;
}

describe('the shop in the apps', () => {
  beforeEach(() => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    calls.length = 0;
    sequence.length = 0;
    fetchCalls.length = 0;
    productPrices = { bucks_100: '€1,09' };
    purchaseResult = { transactionId: 'GPA.1', purchaseToken: 'tok-1', productIdentifier: 'bucks_100' };
    purchaseError = null;
    unfinished = [];
    deliverStatus = 200;
  });

  it('opens with the store prices', async () => {
    const catalog = new ShopApi(testAccount()).catalog();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('the shop never opened')), 1000));
    const { packs, storePacksAvailable } = (await Promise.race([catalog, timeout])) as Awaited<typeof catalog>;
    expect(packs.map((p) => p.price)).toEqual(['€1,09']);
    expect(storePacksAvailable).toBe(true);
  });

  it('says so when the store offers none of the packs', async () => {
    productPrices = {};
    const { packs, storePacksAvailable } = await new ShopApi(testAccount()).catalog();
    expect(packs).toEqual([]);
    expect(storePacksAvailable).toBe(false);
  });

  it('buys a pack: the store is asked not to finish it, the server confirms it, then it is consumed', async () => {
    const api = new ShopApi(testAccount());
    expect(await api.buy('bucks_100')).toBe('bought');
    const purchase = calls.find((c) => c.method === 'purchaseProduct');
    expect(purchase?.args).toMatchObject({
      productIdentifier: 'bucks_100',
      appAccountToken: 'u1',
      isConsumable: true,
      autoAcknowledgePurchases: false,
    });
    expect(fetchCalls).toContainEqual(
      expect.objectContaining({ url: '/api/store/purchase', body: expect.objectContaining({ platform: 'android', productId: 'bucks_100', token: 'tok-1' }) }),
    );
    expect(calls.find((c) => c.method === 'consumePurchase')?.args).toEqual({ purchaseToken: 'tok-1' });
    // the grant comes before the consume: the server confirms first
    expect(sequence).toEqual(['deliver', 'consume']);
  });

  it('a failed hand-over does not consume the purchase', async () => {
    deliverStatus = 500;
    const api = new ShopApi(testAccount());
    await expect(api.buy('bucks_100')).rejects.toThrow();
    expect(calls.some((c) => c.method === 'consumePurchase')).toBe(false);
  });

  it('a pending purchase is a pending outcome, not an error', async () => {
    purchaseError = new Error('Purchase is pending');
    const api = new ShopApi(testAccount());
    expect(await api.buy('bucks_100')).toBe('pending');
    expect(calls.some((c) => c.method === 'consumePurchase')).toBe(false);
    expect(fetchCalls.some((f) => f.url === '/api/store/purchase')).toBe(false);
  });

  it('a cancelled purchase is a cancelled outcome', async () => {
    purchaseError = new Error('User cancelled the purchase');
    const api = new ShopApi(testAccount());
    expect(await api.buy('bucks_100')).toBe('cancelled');
  });

  it('unfinished purchases are handed over and consumed on the next shop visit', async () => {
    unfinished = [{ transactionId: 'GPA.9', purchaseToken: 'tok-9', productIdentifier: 'bucks_30' }];
    const api = new ShopApi(testAccount());
    expect(await api.retryPending()).toBe(1);
    expect(fetchCalls).toContainEqual(
      expect.objectContaining({ url: '/api/store/purchase', body: expect.objectContaining({ platform: 'android', productId: 'bucks_30', token: 'tok-9' }) }),
    );
    expect(calls.find((c) => c.method === 'consumePurchase')?.args).toEqual({ purchaseToken: 'tok-9' });
  });

  it('an unfinished purchase the server rejects stays unfinished', async () => {
    unfinished = [{ transactionId: 'GPA.9', purchaseToken: 'tok-9', productIdentifier: 'bucks_30' }];
    deliverStatus = 402;
    const api = new ShopApi(testAccount());
    expect(await api.retryPending()).toBe(0);
    expect(calls.some((c) => c.method === 'consumePurchase')).toBe(false);
  });
});
