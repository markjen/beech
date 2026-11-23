import { describe, expect, it } from 'vitest';
import { webOrderFromUrl, withoutWebOrderParams } from '../src/net/shop';

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
