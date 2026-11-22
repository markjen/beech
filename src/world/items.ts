// The item catalog: everything that can be in an inventory.
//
// Today every item is free and unlimited (rocks and driftwood). The fields
// below are there for what's planned: shop items, items that are only around
// for a while, and items won from mystery boxes or the claw machine, in
// rarer tiers. The server's inventory table stores what a person owns of the
// non-free ones (see docs/BACKEND.md); free items need no record.

import type { ObjectKind } from '../sim/objects';

export type Rarity = 'common' | 'rare' | 'legendary' | 'unique';
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
  /** random size range when placed (rock radius / driftwood length, metres) */
  size: [number, number];
  /** number of shape variants */
  variants: number;
  /** only obtainable between these dates (ISO), for time-limited items */
  available?: { from?: string; until?: string };
  /** price in the future shop's currency; unset for free items */
  price?: number;
}

export const ITEMS: Item[] = [
  { id: 'rock', name: 'Rock', kind: 'rock', rarity: 'common', source: 'free', unlimited: true, size: [0.25, 0.6], variants: 8 },
  { id: 'driftwood', name: 'Driftwood', kind: 'driftwood', rarity: 'common', source: 'free', unlimited: true, size: [0.9, 2.2], variants: 6 },
];

export const itemById = (id: string): Item | undefined => ITEMS.find((i) => i.id === id);

/** Is the item obtainable at this moment (for time-limited items)? */
export function isAvailable(item: Item, now: Date): boolean {
  const t = now.getTime();
  if (item.available?.from && t < Date.parse(item.available.from)) return false;
  if (item.available?.until && t >= Date.parse(item.available.until)) return false;
  return true;
}

/** A random placement of an item: size, shape variant and turn. */
export function rollPlacement(item: Item, rand: () => number = Math.random): { size: number; variant: number; angle: number } {
  const [lo, hi] = item.size;
  // more small ones than big ones
  const size = lo + (hi - lo) * Math.pow(rand(), 1.6);
  return { size, variant: 1 + Math.floor(rand() * item.variants), angle: rand() * Math.PI * 2 };
}
