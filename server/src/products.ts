// What the shop sells (docs/SAND_BUCKS.md).
//
// PRODUCTS are the shop's offers, bought with sand bucks (`bucks`). Real
// money only buys PACKS of sand bucks: consumable in-app purchases with the
// same id in App Store Connect, Google Play Console, Steam and Xsolla. A
// pack's grant is the pseudo-item `bucks`, which goes to the balance, not
// the bag.
//
// The old app versions in the stores still sell PRODUCTS for real money
// (`usd`, the price tier set in the stores): their receipts keep granting
// the things, until those products are taken off sale. The pricing plan is
// docs/PRICING.md.
//
// Item ids must exist in the app's catalog (src/world/items.ts, or EXTRAS
// for an extra beach); tests/items.test.ts keeps the two in step.

import { PETS } from './petCatalog.js';

export interface Product {
  id: string;
  /** stable integer itemid sent to Steam ISteamMicroTxn/InitTxn (packs, and the old item products) */
  steamItemId?: number;
  /**
   * sold only for sand bucks: not in any store, Steam or web checkout, and not
   * listed for the app versions that sold things for real money
   */
  bucksOnly?: boolean;
  name: string;
  /** what you get */
  grants: { item: string; quantity: number }[];
  /** US price tier (USD) to set in the stores: a pack's price, or an old app's price for an offer */
  usd: number;
  /** price in sand bucks (offers; a pack: how many it gives) */
  bucks: number;
  /** short line for the shop */
  blurb: string;
  /** shown first, and marked as the best value */
  featured?: boolean;
}

export const PRODUCTS: Product[] = [
  {
    id: 'pack_founder',
    steamItemId: 1001,
    name: "Founder's pack",
    grants: [
      { item: 'beach', quantity: 2 },
      { item: 'lighthouse', quantity: 1 },
      { item: 'beachhut', quantity: 1 },
      { item: 'parasol', quantity: 1 },
      { item: 'tikitorch', quantity: 2 },
    ],
    usd: 9.99,
    bucks: 100,
    blurb: 'Two extra beaches, a lighthouse, a beach hut, a parasol and two tiki torches',
    featured: true,
  },
  { id: 'beach_1', steamItemId: 1002, name: 'Extra beach', grants: [{ item: 'beach', quantity: 1 }], usd: 2.99, bucks: 30, blurb: 'A whole new beach of your own, anywhere on the shore' },
  { id: 'beach_3', steamItemId: 1003, name: 'Three extra beaches', grants: [{ item: 'beach', quantity: 3 }], usd: 6.99, bucks: 70, blurb: 'Three new beaches (save 22%)' },
  { id: 'item_lighthouse', steamItemId: 1004, name: 'Lighthouse', grants: [{ item: 'lighthouse', quantity: 1 }], usd: 2.99, bucks: 30, blurb: 'A striped lighthouse whose lamp shines at night' },
  { id: 'item_beachhut', steamItemId: 1005, name: 'Beach hut', grants: [{ item: 'beachhut', quantity: 1 }], usd: 2.99, bucks: 30, blurb: 'A painted hut on stilts' },
  { id: 'item_sandcastle', steamItemId: 1006, name: 'Sandcastle', grants: [{ item: 'sandcastle', quantity: 1 }], usd: 1.99, bucks: 20, blurb: 'Turrets, battlements and a flag' },
  { id: 'item_surfboard', steamItemId: 1007, name: 'Surfboard', grants: [{ item: 'surfboard', quantity: 1 }], usd: 1.49, bucks: 15, blurb: 'Stuck upright in the sand' },
  { id: 'item_tikitorch', steamItemId: 1008, name: 'Tiki torches', grants: [{ item: 'tikitorch', quantity: 2 }], usd: 1.49, bucks: 15, blurb: 'A pair, with flames that flicker' },
  { id: 'item_parasol', steamItemId: 1009, name: 'Parasol', grants: [{ item: 'parasol', quantity: 1 }], usd: 0.99, bucks: 10, blurb: 'Red and white stripes' },
  { id: 'item_deckchair', steamItemId: 1010, name: 'Deckchair', grants: [{ item: 'deckchair', quantity: 1 }], usd: 0.99, bucks: 10, blurb: 'Striped canvas, facing the sea' },
  { id: 'item_palmtree', steamItemId: 1011, name: 'Palm tree', grants: [{ item: 'palmtree', quantity: 1 }], usd: 2.99, bucks: 30, blurb: 'A tall palm with spreading fronds' },
  { id: 'item_lifeguardtower', steamItemId: 1012, name: 'Lifeguard tower', grants: [{ item: 'lifeguardtower', quantity: 1 }], usd: 2.99, bucks: 30, blurb: 'A tower, a cabin and a ramp, watching over the beach' },
  { id: 'item_bonfire', steamItemId: 1013, name: 'Bonfire', grants: [{ item: 'bonfire', quantity: 1 }], usd: 1.49, bucks: 15, blurb: 'Stones, logs and a flickering flame' },
  { id: 'item_hammock', steamItemId: 1014, name: 'Hammock', grants: [{ item: 'hammock', quantity: 1 }], usd: 1.49, bucks: 15, blurb: 'Two posts and a slung cloth, made for naps' },
  { id: 'item_towel', steamItemId: 1015, name: 'Beach towel', grants: [{ item: 'towel', quantity: 1 }], usd: 0.99, bucks: 10, blurb: 'Striped, lying flat on the sand' },
  { id: 'food_pack_10', steamItemId: 1016, name: 'Beach snacks (10)', grants: [{ item: 'crab-treat', quantity: 10 }], usd: 0.99, bucks: 10, blurb: 'Ten treats to attract and feed beach animals' },
  { id: 'food_pack_35', steamItemId: 1017, name: 'Beach snacks (35)', grants: [{ item: 'crab-treat', quantity: 35 }], usd: 2.99, bucks: 30, blurb: 'Thirty-five treats to attract and feed beach animals' },
  { id: 'item_pier', bucksOnly: true, name: 'Pier', grants: [{ item: 'pier', quantity: 1 }], usd: 2.99, bucks: 30, blurb: 'A timber pier out over the water, for the middle of three of your beaches side by side' },
  // pets: one product per species, priced from the pet table (docs/PETS.md).
  // Sand bucks only; the crab keeps its old store listing for old app versions.
  ...PETS.map((p): Product => ({
    id: p.product,
    ...(p.legacySteamItemId ? { steamItemId: p.legacySteamItemId } : { bucksOnly: true }),
    name: `Pet ${p.name.toLowerCase()}`,
    grants: [{ item: p.item, quantity: 1 }],
    usd: p.legacySteamItemId ? 1.99 : p.bucks / 10,
    bucks: p.bucks,
    blurb: p.blurb,
  })),
];

export const productById = (id: string): Product | undefined => PRODUCTS.find((p) => p.id === id);

/**
 * Sand-buck packs: what real money buys (docs/SAND_BUCKS.md). 1 sand buck =
 * 10¢ at the base rate; bigger packs carry a bonus, so the price per buck
 * falls as the pack grows (10: 9.90¢, 33: 9.06¢, 60: 8.32¢, 130: 7.68¢,
 * 280: 7.14¢). The id is the price tier, not the grant: the ids are the
 * product ids in the stores, Xsolla and Steam, so they stay put while the
 * grant (and the name) carries the bonus.
 */
export const PACKS: Product[] = [
  { id: 'bucks_10', steamItemId: 1101, name: '10 sand bucks', grants: [{ item: 'bucks', quantity: 10 }], usd: 0.99, bucks: 10, blurb: 'Enough for a parasol or a deckchair' },
  { id: 'bucks_30', steamItemId: 1102, name: '33 sand bucks', grants: [{ item: 'bucks', quantity: 33 }], usd: 2.99, bucks: 33, blurb: 'A lighthouse, or an extra beach — plus 3 free' },
  { id: 'bucks_50', steamItemId: 1103, name: '60 sand bucks', grants: [{ item: 'bucks', quantity: 60 }], usd: 4.99, bucks: 60, blurb: 'A centrepiece and a few things around it — plus 10 free' },
  { id: 'bucks_100', steamItemId: 1104, name: '130 sand bucks', grants: [{ item: 'bucks', quantity: 130 }], usd: 9.99, bucks: 130, blurb: 'The Founder’s pack, or a whole new build — plus 30 free' },
  { id: 'bucks_200', steamItemId: 1105, name: '280 sand bucks', grants: [{ item: 'bucks', quantity: 280 }], usd: 19.99, bucks: 280, blurb: 'For a stretch of shore — plus 80 free, the best value per buck', featured: true },
];
export const packById = (id: string): Product | undefined => PACKS.find((p) => p.id === id);
/** What a real-money receipt can be for: a pack, or (from an old app version) an offer. */
export const storeProductById = (id: string): Product | undefined => packById(id) ?? productById(id);
/** What real money can start a purchase of (stores, Steam, card): packs, and the old item products. */
export const realMoneyProductById = (id: string): Product | undefined => {
  const p = storeProductById(id);
  return p && !p.bucksOnly ? p : undefined;
};
/** sand bucks a real-money product gives (0 for an old app's offer, which gives things) */
export const bucksIn = (p: Product): number => p.grants.filter((g) => g.item === 'bucks').reduce((t, g) => t + g.quantity, 0);

/** One line of a "buy what's missing" basket (docs/COPY_BEACH.md). */
export interface BasketLine {
  product: string;
  /** how many times to buy it */
  quantity: number;
  /** the item it covers */
  item: string;
  /** price of one, in sand bucks */
  bucks: number;
}

/**
 * What to buy so a copy fits (docs/COPY_BEACH.md, "Buy what's missing").
 * For each short item: the single-item product that grants it (the smallest
 * grant, so the basket buys no more than it needs), bought
 * ceil(missing / grant) times. Packs are never suggested. Items no product
 * sells (claw, vending, dig finds) come back in `notForSale`. `beach`: the
 * copy goes onto a new beach and there's no room for one. `priceOf` is the
 * shop's price in sand bucks, or null when a product is off sale.
 */
export function copyBasket(
  short: { item: string; need: number; have: number }[],
  beach: boolean,
  priceOf: (p: Product) => number | null = (p) => p.bucks,
  products: Product[] = PRODUCTS,
): { lines: BasketLine[]; bucks: number; notForSale: { item: string; missing: number }[] } {
  const wants = short.map((s) => ({ item: s.item, missing: Math.max(0, s.need - s.have) })).filter((w) => w.missing > 0);
  if (beach) wants.unshift({ item: 'beach', missing: 1 });
  const lines: BasketLine[] = [];
  const notForSale: { item: string; missing: number }[] = [];
  for (const w of wants) {
    const best = products
      .filter((p) => p.grants.length === 1 && p.grants[0].item === w.item && p.grants[0].quantity > 0)
      .map((p) => ({ p, bucks: priceOf(p) }))
      .filter((o): o is { p: Product; bucks: number } => o.bucks !== null)
      .sort((a, b) => a.p.grants[0].quantity - b.p.grants[0].quantity || a.bucks - b.bucks)[0];
    if (!best) {
      notForSale.push(w);
      continue;
    }
    lines.push({ product: best.p.id, quantity: Math.ceil(w.missing / best.p.grants[0].quantity), item: w.item, bucks: best.bucks });
  }
  return { lines, bucks: lines.reduce((t, l) => t + l.bucks * l.quantity, 0), notForSale };
}
