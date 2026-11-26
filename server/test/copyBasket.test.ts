// "Buy what's missing" for a beach copy (docs/COPY_BEACH.md).
import { describe, expect, it } from 'vitest';
import { copyBasket, PRODUCTS } from '../src/products.js';

const short = (item: string, need: number, have = 0) => ({ item, need, have });

describe('copyBasket', () => {
  it('buys exactly what is missing, one single-item product per item', () => {
    const b = copyBasket([short('lighthouse', 2, 1), short('parasol', 1)], false);
    expect(b.lines).toEqual([
      { product: 'item_lighthouse', quantity: 1, item: 'lighthouse', bucks: 30 },
      { product: 'item_parasol', quantity: 1, item: 'parasol', bucks: 10 },
    ]);
    expect(b.bucks).toBe(40);
    expect(b.notForSale).toEqual([]);
  });

  it('rounds up for things sold in pairs', () => {
    expect(copyBasket([short('tikitorch', 3)], false).lines).toEqual([{ product: 'item_tikitorch', quantity: 2, item: 'tikitorch', bucks: 15 }]);
  });

  it('never suggests a pack, and picks one extra beach for a new beach with no room', () => {
    const b = copyBasket([short('beachhut', 1)], true);
    expect(b.lines.map((l) => l.product)).toEqual(['beach_1', 'item_beachhut']);
    expect(b.lines.some((l) => l.product === 'pack_founder')).toBe(false);
  });

  it('lists what no product sells, and skips products that are off sale', () => {
    const b = copyBasket([short('conch', 2), short('palmtree', 1)], false, (p) => (p.id === 'item_palmtree' ? null : p.bucks));
    expect(b.lines).toEqual([]);
    expect(b.notForSale).toEqual([
      { item: 'conch', missing: 2 },
      { item: 'palmtree', missing: 1 },
    ]);
  });

  it('every shop centrepiece can be bought on its own', () => {
    for (const p of PRODUCTS.filter((x) => x.id.startsWith('item_'))) {
      const item = p.grants[0].item;
      expect(copyBasket([short(item, 1)], false).lines[0]?.product, item).toBe(p.id);
    }
  });
});
