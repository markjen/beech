// Sand bucks and trade-ins (docs/SAND_BUCKS.md): the pure parts. The
// balance is kept in users.credit_cents at 10 cents a sand buck, so every
// amount here in cents is a whole number of bucks (a multiple of 10).

import { catalogItemById } from './itemCatalog.js';
import { PET_ITEMS } from './petCatalog.js';
import { PRODUCTS, type Product } from './products.js';

/** cents in one sand buck */
export const BUCK = 10;
export const bucksToCents = (bucks: number): number => Math.round(bucks) * BUCK;
export const centsToBucks = (cents: number): number => Math.floor(cents / BUCK);
/** a cents amount as whole bucks: rounded to the nearest buck */
export const roundToBuck = (cents: number): number => Math.round(cents / BUCK) * BUCK;

/** trade-in value by rarity, for things no shop sells (claw, vending, digging) */
export const RARITY_BUCKS: Record<string, number> = { common: 5, uncommon: 10, rare: 15, legendary: 30 };

/** Things that can't be traded in: eaten, adopted, or one of a kind. */
const NOT_TRADEABLE = new Set(['crab-treat', ...PET_ITEMS, 'bucks']);

/**
 * An item's list value in sand bucks: what one costs on its own in the shop
 * (a pair's price shared out), else by its rarity; null when it has none
 * (free things, snacks, the pet, one-of-a-kind items).
 */
export function listBucks(item: string, products: Product[] = PRODUCTS): number | null {
  if (NOT_TRADEABLE.has(item)) return null;
  const single = products
    .filter((p) => p.grants.length === 1 && p.grants[0].item === item && p.grants[0].quantity > 0)
    .map((p) => p.bucks / p.grants[0].quantity)
    .sort((a, b) => b - a)[0];
  if (single !== undefined) return Math.round(single);
  const c = catalogItemById(item);
  if (!c || c.source === 'free') return null;
  return RARITY_BUCKS[c.rarity] ?? null;
}

/** Can this item be traded in at all? */
export const tradeable = (item: string): boolean => listBucks(item) !== null;

/**
 * Share a price paid (cents, whole bucks) out over parts in proportion to
 * their weights (each part's own price), as whole bucks that add up exactly
 * (largest remainder; ties to the earlier part). Zero weights share equally.
 */
export function shareOut(paidCents: number, weights: number[]): number[] {
  const paid = centsToBucks(paidCents);
  if (!weights.length) return [];
  const w = weights.every((x) => x <= 0) ? weights.map(() => 1) : weights.map((x) => Math.max(0, x));
  const total = w.reduce((t, x) => t + x, 0);
  const exact = w.map((x) => (paid * x) / total);
  const out = exact.map((x) => Math.floor(x));
  let left = paid - out.reduce((t, x) => t + x, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out.map((x) => x * BUCK);
}

/** A share (cents, whole bucks) split over `n` units as evenly as whole bucks allow. */
export function splitEvenly(cents: number, n: number): number[] {
  return n <= 0 ? [] : shareOut(cents, Array.from({ length: n }, () => 1));
}

/** A product's grants as one entry per unit (a pair of tiki torches is two units). */
export function unitsOf(grants: { item: string; quantity: number }[]): string[] {
  return grants.flatMap((g) => Array.from({ length: g.quantity }, () => g.item));
}
