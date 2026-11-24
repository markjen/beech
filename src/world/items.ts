// The item catalog: everything that can be in an inventory.
//
// Today every item is free and unlimited (rocks and driftwood). The fields
// below are there for what's planned: shop items, items that are only around
// for a while, and items won from mystery boxes or the claw machine, in
// rarer tiers. The server's inventory table stores what a person owns of the
// non-free ones (see docs/BACKEND.md); free items need no record.

import type { ObjectKind } from '../sim/objects';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'unique';
/** how you get it */
export type ItemSource = 'free' | 'shop' | 'event' | 'pull';

export interface Item {
  id: string;
  name: string;
  /** how the simulation treats it */
  kind: ObjectKind;
  rarity: Rarity;
  source: ItemSource;
  /** free items are never used up */
  unlimited: boolean;
  /** size range you can pick from (rock radius / driftwood length, metres) */
  size: [number, number];
  /** fixed size (the slider is hidden) */
  fixedSize?: boolean;
  /** number of shape variants */
  variants: number;
  /** only obtainable between these dates (ISO), for time-limited items */
  available?: { from?: string; until?: string };
  /** store product that sells it (src/world/products.ts); unset for free and prize items */
  product?: string;
}

export const ITEMS: Item[] = [
  { id: 'rock', name: 'Rock', kind: 'rock', rarity: 'common', source: 'free', unlimited: true, size: [0.12, 1.3], variants: 8 },
  { id: 'driftwood', name: 'Driftwood', kind: 'driftwood', rarity: 'common', source: 'free', unlimited: true, size: [0.5, 3.2], variants: 6 },
  { id: 'shell', name: 'Shell', kind: 'shell', rarity: 'common', source: 'free', unlimited: true, size: [0.05, 0.5], variants: 8 },
  { id: 'seaglass', name: 'Sea glass', kind: 'seaglass', rarity: 'common', source: 'free', unlimited: true, size: [0.05, 0.16], variants: 4 },
  // wash-ashore finds: the sea brings these in on its own (washIn in
  // src/sim/objects.ts). Pick one up and put it down and it's yours.
  { id: 'trash', name: 'Trash', kind: 'trash', rarity: 'common', source: 'free', unlimited: true, size: [0.08, 0.25], variants: 3 },
  { id: 'seaweed', name: 'Seaweed', kind: 'seaweed', rarity: 'common', source: 'free', unlimited: true, size: [0.15, 0.6], variants: 3 },
  { id: 'cowrie', name: 'Cowrie', kind: 'shell', rarity: 'rare', source: 'free', unlimited: true, size: [0.05, 0.2], variants: 3 },
  { id: 'flag', name: 'Flag', kind: 'flag', rarity: 'common', source: 'free', unlimited: true, size: [0.4, 0.4], variants: 4, fixedSize: true },
  // won from the claw machine (server/src/pulls.ts); you can place as many as you own
  { id: 'conch', name: 'Conch', kind: 'conch', rarity: 'common', source: 'pull', unlimited: false, size: [0.1, 0.35], variants: 3 },
  { id: 'sanddollar', name: 'Sand dollar', kind: 'sanddollar', rarity: 'common', source: 'pull', unlimited: false, size: [0.06, 0.16], variants: 2 },
  { id: 'starfish', name: 'Starfish', kind: 'starfish', rarity: 'rare', source: 'pull', unlimited: false, size: [0.08, 0.26], variants: 3 },
  // from the shop (the claw machine gives everyone one as a starter gift)
  { id: 'deckchair', name: 'Deckchair', kind: 'deckchair', rarity: 'rare', source: 'shop', unlimited: false, size: [1, 1], variants: 3, fixedSize: true, product: 'item_deckchair' },
  { id: 'parasol', name: 'Parasol', kind: 'parasol', rarity: 'rare', source: 'shop', unlimited: false, size: [1, 1], variants: 1, fixedSize: true, product: 'item_parasol' },
  { id: 'surfboard', name: 'Surfboard', kind: 'surfboard', rarity: 'rare', source: 'shop', unlimited: false, size: [1, 1], variants: 1, fixedSize: true, product: 'item_surfboard' },
  { id: 'tikitorch', name: 'Tiki torch', kind: 'tikitorch', rarity: 'rare', source: 'shop', unlimited: false, size: [1, 1], variants: 1, fixedSize: true, product: 'item_tikitorch' },
  { id: 'sandcastle', name: 'Sandcastle', kind: 'sandcastle', rarity: 'legendary', source: 'shop', unlimited: false, size: [1, 1], variants: 1, fixedSize: true, product: 'item_sandcastle' },
  { id: 'beachhut', name: 'Beach hut', kind: 'beachhut', rarity: 'legendary', source: 'shop', unlimited: false, size: [1, 1], variants: 1, fixedSize: true, product: 'item_beachhut' },
  { id: 'lighthouse', name: 'Lighthouse', kind: 'lighthouse', rarity: 'legendary', source: 'shop', unlimited: false, size: [1, 1], variants: 1, fixedSize: true, product: 'item_lighthouse' },
  { id: 'bottle', name: 'Message in a bottle', kind: 'bottle', rarity: 'legendary', source: 'pull', unlimited: false, size: [0.22, 0.45], variants: 2 },
  // Week 1 of the vending machine ("First light", server/src/vending.ts).
  // New ids on familiar kinds: they behave like the kind, but each has its
  // own look (src/palette.ts ITEM_LOOKS) — colour, finish and, for the
  // golden sand dollar, a glow — so they read as prizes on the beach, not
  // as the free kind. A set's items stay in the catalog after their week
  // ends, so what someone won stays theirs.
  { id: 'pink-shell', name: 'Pink shell', kind: 'shell', rarity: 'common', source: 'pull', unlimited: false, size: [0.05, 0.5], variants: 8 },
  { id: 'blue-seaglass', name: 'Blue sea glass', kind: 'seaglass', rarity: 'common', source: 'pull', unlimited: false, size: [0.05, 0.16], variants: 4 },
  { id: 'pebble', name: 'Pebble', kind: 'rock', rarity: 'common', source: 'pull', unlimited: false, size: [0.05, 0.25], variants: 8 },
  { id: 'spiral-conch', name: 'Spiral conch', kind: 'conch', rarity: 'uncommon', source: 'pull', unlimited: false, size: [0.1, 0.35], variants: 3 },
  { id: 'gold-sanddollar', name: 'Golden sand dollar', kind: 'sanddollar', rarity: 'uncommon', source: 'pull', unlimited: false, size: [0.32, 0.85], variants: 2 },
  { id: 'sunset-starfish', name: 'Sunset starfish', kind: 'starfish', rarity: 'rare', source: 'pull', unlimited: false, size: [0.08, 0.26], variants: 3 },
  { id: 'green-bottle', name: 'Green bottle', kind: 'bottle', rarity: 'rare', source: 'pull', unlimited: false, size: [0.22, 0.45], variants: 2 },
  { id: 'nautilus', name: 'Nautilus', kind: 'nautilus', rarity: 'unique', source: 'pull', unlimited: false, size: [0.12, 0.3], variants: 3 },
  // Week 2 of the vending machine ("Beach day", server/src/vending.ts).
  // Three genuinely new kinds this time, so each has its own look from
  // its kind palette (src/palette.ts) — no ITEM_LOOKS needed.
  { id: 'beach-ball', name: 'Beach ball', kind: 'beachball', rarity: 'common', source: 'pull', unlimited: false, size: [0.25, 0.6], variants: 3 },
  { id: 'sandals', name: 'Sandals', kind: 'sandals', rarity: 'uncommon', source: 'pull', unlimited: false, size: [0.15, 0.35], variants: 2 },
  { id: 'bucket', name: 'Bucket', kind: 'bucket', rarity: 'rare', source: 'pull', unlimited: false, size: [0.2, 0.4], variants: 2 },
];

export const itemById = (id: string): Item | undefined => ITEMS.find((i) => i.id === id);

/**
 * Things you can own that aren't placed on the sand. An extra beach is used
 * from the beaches list (see docs/MULTI_BEACH.md, not built yet).
 */
export interface Extra {
  id: string;
  name: string;
  rarity: Rarity;
  /** what it's for, shown in the bag */
  note: string;
}

export const EXTRAS: Extra[] = [
  { id: 'beach', name: 'Extra beach', rarity: 'legendary', note: 'A second beach of your own. Coming soon: set it up next to yours, or anywhere on the shore.' },
];

export const extraById = (id: string): Extra | undefined => EXTRAS.find((e) => e.id === id);

/** Display name of anything you can win or own. */
export const prizeName = (id: string): string => itemById(id)?.name ?? extraById(id)?.name ?? id;

/** Is the item obtainable at this moment (for time-limited items)? */
export function isAvailable(item: Item, now: Date): boolean {
  const t = now.getTime();
  if (item.available?.from && t < Date.parse(item.available.from)) return false;
  if (item.available?.until && t >= Date.parse(item.available.until)) return false;
  return true;
}

/** Default slider position (0 = smallest, 1 = largest). */
export const DEFAULT_SIZE = 0.35;

/**
 * A placement of an item: the size you picked (0..1 across its range) with a
 * little natural variation, plus a random shape variant and turn.
 */
export function rollPlacement(
  item: Item,
  size01 = DEFAULT_SIZE,
  rand: () => number = Math.random,
): { size: number; variant: number; angle: number } {
  const [lo, hi] = item.size;
  const t = Math.min(1, Math.max(0, size01));
  // sizes feel even across the slider (a 2x step anywhere looks the same)
  const base = lo * Math.pow(hi / lo, t);
  const size = Math.min(hi, Math.max(lo, base * (0.92 + rand() * 0.16)));
  // built things face the sea (more or less); everything else lands any way round
  const angle = item.source === 'shop' ? (rand() - 0.5) * 0.6 : rand() * Math.PI * 2;
  return { size, variant: 1 + Math.floor(rand() * item.variants), angle };
}
