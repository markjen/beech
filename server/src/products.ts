// What the shop sells. Every product is a consumable in-app purchase with the
// same id in App Store Connect and Google Play Console (Play allows letters,
// numbers, _ and .). Buying one adds its `grants` to your bag (inventory),
// so the server is the record of what you own, on every device.
//
// Prices are set in the stores (per country); `usd` is the US price tier to
// pick there, and what the web shows before the store's own price loads.
// The pricing plan and the reasoning are in docs/PRICING.md.
//
// Item ids must exist in the app's catalog (src/world/items.ts, or EXTRAS
// for an extra beach); tests/items.test.ts keeps the two in step.

export interface Product {
  id: string;
  /** stable integer itemid sent to Steam ISteamMicroTxn/InitTxn */
  steamItemId: number;
  name: string;
  /** what you get */
  grants: { item: string; quantity: number }[];
  /** US price tier (USD) to set in both stores */
  usd: number;
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
    blurb: 'Two extra beaches, a lighthouse, a beach hut, a parasol and two tiki torches',
    featured: true,
  },
  { id: 'beach_1', steamItemId: 1002, name: 'Extra beach', grants: [{ item: 'beach', quantity: 1 }], usd: 2.99, blurb: 'A whole new beach of your own, anywhere on the shore' },
  { id: 'beach_3', steamItemId: 1003, name: 'Three extra beaches', grants: [{ item: 'beach', quantity: 3 }], usd: 6.99, blurb: 'Three new beaches (save 22%)' },
  { id: 'item_lighthouse', steamItemId: 1004, name: 'Lighthouse', grants: [{ item: 'lighthouse', quantity: 1 }], usd: 2.99, blurb: 'A striped lighthouse whose lamp shines at night' },
  { id: 'item_beachhut', steamItemId: 1005, name: 'Beach hut', grants: [{ item: 'beachhut', quantity: 1 }], usd: 2.99, blurb: 'A painted hut on stilts' },
  { id: 'item_sandcastle', steamItemId: 1006, name: 'Sandcastle', grants: [{ item: 'sandcastle', quantity: 1 }], usd: 1.99, blurb: 'Turrets, battlements and a flag' },
  { id: 'item_surfboard', steamItemId: 1007, name: 'Surfboard', grants: [{ item: 'surfboard', quantity: 1 }], usd: 1.49, blurb: 'Stuck upright in the sand' },
  { id: 'item_tikitorch', steamItemId: 1008, name: 'Tiki torches', grants: [{ item: 'tikitorch', quantity: 2 }], usd: 1.49, blurb: 'A pair, with flames that flicker' },
  { id: 'item_parasol', steamItemId: 1009, name: 'Parasol', grants: [{ item: 'parasol', quantity: 1 }], usd: 0.99, blurb: 'Red and white stripes' },
  { id: 'item_deckchair', steamItemId: 1010, name: 'Deckchair', grants: [{ item: 'deckchair', quantity: 1 }], usd: 0.99, blurb: 'Striped canvas, facing the sea' },
  { id: 'item_palmtree', steamItemId: 1011, name: 'Palm tree', grants: [{ item: 'palmtree', quantity: 1 }], usd: 2.99, blurb: 'A tall palm with spreading fronds' },
  { id: 'item_lifeguardtower', steamItemId: 1012, name: 'Lifeguard tower', grants: [{ item: 'lifeguardtower', quantity: 1 }], usd: 2.99, blurb: 'A tower, a cabin and a ramp, watching over the beach' },
  { id: 'item_bonfire', steamItemId: 1013, name: 'Bonfire', grants: [{ item: 'bonfire', quantity: 1 }], usd: 1.49, blurb: 'Stones, logs and a flickering flame' },
  { id: 'item_hammock', steamItemId: 1014, name: 'Hammock', grants: [{ item: 'hammock', quantity: 1 }], usd: 1.49, blurb: 'Two posts and a slung cloth, made for naps' },
  { id: 'item_towel', steamItemId: 1015, name: 'Beach towel', grants: [{ item: 'towel', quantity: 1 }], usd: 0.99, blurb: 'Striped, lying flat on the sand' },
  { id: 'food_pack_10', steamItemId: 1016, name: 'Beach snacks (10)', grants: [{ item: 'crab-treat', quantity: 10 }], usd: 0.99, blurb: 'Ten treats to attract and feed beach animals' },
  { id: 'food_pack_35', steamItemId: 1017, name: 'Beach snacks (35)', grants: [{ item: 'crab-treat', quantity: 35 }], usd: 2.99, blurb: 'Thirty-five treats to attract and feed beach animals' },
];

export const productById = (id: string): Product | undefined => PRODUCTS.find((p) => p.id === id);
