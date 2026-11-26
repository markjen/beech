// Beech bucks: prices, list values and sharing a price out (docs/BEECH_BUCKS.md).
import { describe, expect, it } from 'vitest';
import { listBucks, shareOut, splitEvenly, tradeable, unitsOf } from '../src/bucks.js';
import { PACKS, PRODUCTS, bucksIn, storeProductById } from '../src/products.js';

describe('beech bucks', () => {
  it('every price is whole beech bucks; packs carry a growing bonus, so bigger packs cost less per buck', () => {
    for (const p of [...PRODUCTS, ...PACKS]) expect(Number.isInteger(p.bucks), p.id).toBe(true);
    // base rate 10¢ a buck on the smallest pack; the bonus grows with the pack
    expect(bucksIn(PACKS[0])).toBe(Math.round(PACKS[0].usd * 10));
    const perBuck = PACKS.map((p) => p.usd / bucksIn(p));
    for (let i = 1; i < perBuck.length; i++) expect(perBuck[i], PACKS[i].id).toBeLessThan(perBuck[i - 1]);
    expect(storeProductById('bucks_30')?.bucks).toBe(33);
    expect(storeProductById('bucks_200')?.bucks).toBe(280);
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
