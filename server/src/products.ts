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
  { id: 'beach_1', name: 'Extra beach', grants: [{ item: 'beach', quantity: 1 }], usd: 2.99, blurb: 'A whole new beach of your own, anywhere on the shore' },
  { id: 'beach_3', name: 'Three extra beaches', grants: [{ item: 'beach', quantity: 3 }], usd: 6.99, blurb: 'Three new beaches (save 22%)' },
  { id: 'item_lighthouse', name: 'Lighthouse', grants: [{ item: 'lighthouse', quantity: 1 }], usd: 2.99, blurb: 'A striped lighthouse whose lamp shines at night' },
  { id: 'item_beachhut', name: 'Beach hut', grants: [{ item: 'beachhut', quantity: 1 }], usd: 2.99, blurb: 'A painted hut on stilts' },
  { id: 'item_sandcastle', name: 'Sandcastle', grants: [{ item: 'sandcastle', quantity: 1 }], usd: 1.99, blurb: 'Turrets, battlements and a flag' },
  { id: 'item_surfboard', name: 'Surfboard', grants: [{ item: 'surfboard', quantity: 1 }], usd: 1.49, blurb: 'Stuck upright in the sand' },
  { id: 'item_tikitorch', name: 'Tiki torches', grants: [{ item: 'tikitorch', quantity: 2 }], usd: 1.49, blurb: 'A pair, with flames that flicker' },
  { id: 'item_parasol', name: 'Parasol', grants: [{ item: 'parasol', quantity: 1 }], usd: 0.99, blurb: 'Red and white stripes' },
  { id: 'item_deckchair', name: 'Deckchair', grants: [{ item: 'deckchair', quantity: 1 }], usd: 0.99, blurb: 'Striped canvas, facing the sea' },
];

export const productById = (id: string): Product | undefined => PRODUCTS.find((p) => p.id === id);
