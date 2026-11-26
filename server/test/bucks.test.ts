// Sand bucks: prices, list values and sharing a price out (docs/SAND_BUCKS.md).
import { describe, expect, it } from 'vitest';
import { listBucks, shareOut, splitEvenly, tradeable, unitsOf } from '../src/bucks.js';
import { PACKS, PRODUCTS, bucksIn, storeProductById } from '../src/products.js';

describe('sand bucks', () => {
  it('every price is whole sand bucks, at 10 cents a buck, and packs give what they cost', () => {
    for (const p of [...PRODUCTS, ...PACKS]) expect(Number.isInteger(p.bucks), p.id).toBe(true);
    for (const p of PACKS) expect(bucksIn(p), p.id).toBe(Math.round(p.usd * 10));
    expect(storeProductById('bucks_30')?.bucks).toBe(30);
    expect(storeProductById('item_lighthouse')?.bucks).toBe(30); // an old app's receipt
  });

  it('list values: the shop price (a pair shared), else by rarity; none for snacks, the pet and free things', () => {
    expect(listBucks('lighthouse')).toBe(30);
    expect(listBucks('parasol')).toBe(10);
    expect(listBucks('beach')).toBe(30);
    expect(listBucks('tikitorch')).toBe(8);
    expect(listBucks('conch')).toBe(5);
    expect(listBucks('starfish')).toBe(15);
    expect(listBucks('bottle')).toBe(30);
    for (const id of ['crab-treat', 'pet-crab', 'rock', 'shell', 'nope']) expect(tradeable(id), id).toBe(false);
  });

  it('shares a price out exactly, by weight, in whole bucks', () => {
    expect(shareOut(450, [300, 150])).toEqual([300, 150]);
    expect(shareOut(150, [1, 1])).toEqual([80, 70]);
    expect(splitEvenly(100, 3)).toEqual([40, 30, 30]);
    // the Founder's pack: 100 bucks over what it holds, by list value
    const founder = PRODUCTS.find((p) => p.id === 'pack_founder')!;
    const units = unitsOf(founder.grants);
    const v = shareOut(1000, units.map((u) => listBucks(u) ?? 1));
    expect(v.reduce((t, x) => t + x, 0)).toBe(1000);
    expect(v.every((x) => x % 10 === 0)).toBe(true);
    expect(v[units.indexOf('lighthouse')]).toBeGreaterThan(v[units.indexOf('parasol')]);
  });
});
