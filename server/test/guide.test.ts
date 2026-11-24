import { describe, expect, it } from 'vitest';
import { FREE_ITEMS } from '../src/checkpoints.js';
import { WASH_ASHORE_ITEMS, guideHtml } from '../src/guide.js';
import { displayName } from '../src/prizeNames.js';
import { PRODUCTS } from '../src/products.js';
import { POOLS } from '../src/pulls.js';
import { VENDING_SETS } from '../src/vending.js';
import { EXTRAS, ITEMS } from '../../src/world/items.js';

// The guide's full catalog (server/src/guide.ts, #catalog): every group
// is built at runtime from the pools, sets, products and free items, so
// a new item joins its group on its own — footprints (PR #81, free)
// needs no change here when it merges. The mirrors the guide reads
// (server/src/prizeNames.ts) are kept in step by tests/items.test.ts.
describe('the guide catalog', () => {
  const GUIDE_NOW = Date.parse('2026-11-24T12:00:00Z');
  const catalogSection = (html: string) => {
    const start = html.indexOf('<h2 id="catalog">');
    const end = html.indexOf('<h2 ', start + 1);
    return html.slice(start, end === -1 ? undefined : end);
  };
  const groupSection = (catalog: string, heading: string) => {
    const start = catalog.indexOf(`<h3>${heading}</h3>`);
    if (start === -1) return '';
    const end = catalog.indexOf('<h3>', start + 1);
    return catalog.slice(start, end === -1 ? undefined : end);
  };

  it('lists every catalog item and extra by name', () => {
    const catalog = catalogSection(guideHtml(GUIDE_NOW));
    expect(catalog.length).toBeGreaterThan(0);
    for (const item of ITEMS) expect(catalog, item.id).toContain(item.name);
    for (const extra of EXTRAS) expect(catalog, extra.id).toContain(extra.name);
  });

  it('groups items by how you get them', () => {
    const catalog = catalogSection(guideHtml(GUIDE_NOW));
    const free = groupSection(catalog, 'Free, from your bag');
    for (const id of FREE_ITEMS) expect(free, id).toContain(displayName(id));
    expect(free).not.toContain('Lighthouse');
    const wash = groupSection(catalog, 'Washed ashore');
    for (const id of WASH_ASHORE_ITEMS) expect(wash, id).toContain(displayName(id));
    expect(wash).not.toContain('Rock');
    expect(wash).not.toContain('Flag');
    const claw = groupSection(catalog, 'From the claw machine');
    for (const list of Object.values(POOLS.daily.items)) for (const id of list) expect(claw, id).toContain(displayName(id));
    for (const set of VENDING_SETS) {
      expect(catalog).toContain(`Week ${set.week}: ${set.name}`);
      for (const list of Object.values(set.items)) for (const id of list) expect(catalog, id).toContain(displayName(id));
    }
    const shop = groupSection(catalog, 'From the shop');
    for (const item of ITEMS.filter((i) => i.source === 'shop')) {
      expect(shop, item.id).toContain(item.name);
      const product = PRODUCTS.find((p) => p.id === item.product)!;
      expect(shop, item.id).toContain(`$${product.usd.toFixed(2)}`);
    }
    const extras = groupSection(catalog, 'Extras');
    expect(extras).toContain('Extra beach');
    expect(extras).toContain('$2.99');
  });

  it('never mentions the claw’s starter gifts', () => {
    expect(guideHtml(GUIDE_NOW).toLowerCase()).not.toContain('starter');
  });
});
