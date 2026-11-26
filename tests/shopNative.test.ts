// The shop in the apps: a Capacitor plugin is a Proxy that answers every
// property, `then` included, so handing it through a promise bare never
// settles. The shop hung on "Opening the shop…" on Android because of it.
import { describe, expect, it, vi } from 'vitest';
import type { Account } from '../src/net/account';

// like registerPlugin() on a native platform: any property is a native
// method, and an unknown one (`then`) rejects without ever answering
const pluginProxy = new Proxy(
  {},
  {
    get: (_, prop) =>
      prop === 'getProducts'
        ? async () => ({ products: [{ identifier: 'bucks_100', priceString: '€1,09' }] })
        : () => Promise.reject(new Error(`${String(prop)}() is not implemented on android`)),
  },
);
vi.mock('@capgo/native-purchases', () => ({ NativePurchases: pluginProxy }));
vi.mock('../src/platform/runtime', async (orig) => ({
  ...(await orig<typeof import('../src/platform/runtime')>()),
  isMobileApp: () => true,
  isSteam: () => false,
}));

const { ShopApi } = await import('../src/net/shop');

describe('the shop in the apps', () => {
  it('opens with the store prices', async () => {
    const account = {
      user: { id: 'u1' },
      fetch: async () =>
        new Response(JSON.stringify({ packs: [{ id: 'bucks_100', name: '100', blurb: '', usd: 0.99, featured: false }], offers: [] })),
    } as unknown as Account;
    const catalog = new ShopApi(account).catalog();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('the shop never opened')), 1000));
    const { packs } = (await Promise.race([catalog, timeout])) as Awaited<typeof catalog>;
    expect(packs.map((p) => p.price)).toEqual(['€1,09']);
  });
});
