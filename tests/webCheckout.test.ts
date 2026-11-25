import { describe, expect, it, vi } from 'vitest';
import { Account } from '../src/net/account';
import { ShopApi, webOrderFromUrl, withoutWebOrderParams } from '../src/net/shop';

describe('web checkout country', () => {
  it.each([
    ['en-US-u-hc-h12', 'US'],
    ['zh-Hant-TW', 'TW'],
    ['en-x-us', undefined],
    ['en', undefined],
    ['es-419', undefined],
  ])('sends only an explicit country region for %s', async (language, country) => {
    vi.stubGlobal('navigator', { language });
    try {
      const account = new Account();
      const fetch = vi.spyOn(account, 'fetch').mockResolvedValue(Response.json({ order: 'o1', url: 'https://example.test/' }));
      await new ShopApi(account).startWebCheckout('beach_1');
      expect(fetch).toHaveBeenCalledWith('/api/store/web-checkout', expect.objectContaining({
        body: JSON.stringify({ productId: 'beach_1', ...(country ? { country } : {}) }),
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// Coming back from Xsolla's Pay Station (docs/WEB_PAYMENTS.md): the return
// link carries our order id, plus parameters Xsolla adds.
describe('web checkout return link', () => {
  const id = '0ccaab2b-604d-425d-8288-0ce035b836b1';

  it('reads our order id, and nothing that is not one', () => {
    expect(webOrderFromUrl(`?web_order=${id}&status=done&invoice_id=1`)).toBe(id);
    expect(webOrderFromUrl('?web_order=../../admin')).toBeNull();
    expect(webOrderFromUrl('?visit=K7F2QX')).toBeNull();
  });

  it('removes the return parameters and keeps the rest', () => {
    expect(withoutWebOrderParams(`?web_order=${id}&user_id=u&foreignInvoice=f&invoice_id=1&status=done`)).toBe('');
    expect(withoutWebOrderParams(`?visit=K7F2QX&web_order=${id}`)).toBe('?visit=K7F2QX');
  });
});
