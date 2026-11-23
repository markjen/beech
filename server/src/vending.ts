// Vending machine: one free ball a day, from a weekly set of items.
//
// A set is data: one entry per week, in `VENDING_SETS` below. The machine
// always shows the latest set whose start has passed, so a new week is a
// data-only change (add an entry, plus catalog rows for any new items) and
// a missed week just keeps the last set running instead of breaking the
// machine. Past sets' items stay in the app's catalog forever: what someone
// won stays theirs and stays placeable. The exact weekly process is in
// docs/VENDING_MACHINE.md.
//
// The draw happens here on the server, like the claw machine (never in the
// app), with the odds the app shows before every ball. Item ids must exist
// in the app's catalog (src/world/items.ts); a test in tests/items.test.ts
// keeps the two in step.

import { cryptoRandom } from './pulls.js';

/** The vending machine's tiers: the claw's three plus 'uncommon'. */
export type VendingRarity = 'common' | 'uncommon' | 'rare' | 'unique';

/** The odds every set uses unless it says otherwise. */
export const VENDING_ODDS: Record<VendingRarity, number> = { common: 0.6, uncommon: 0.25, rare: 0.12, unique: 0.03 };

export interface VendingSet {
  /** 1, 2, … — shown in the machine ("Week 1") */
  week: number;
  /** the week's theme, shown in the machine */
  name: string;
  /** first day the set is live (ISO date, UTC midnight) */
  starts: string;
  /** chance of each rarity (sums to 1) */
  odds: Record<VendingRarity, number>;
  /** which items a rarity can give, equally likely */
  items: Record<VendingRarity, string[]>;
}

export const VENDING_SETS: VendingSet[] = [
  {
    week: 1,
    name: 'First light',
    starts: '2026-11-23',
    odds: VENDING_ODDS,
    items: {
      common: ['pink-shell', 'blue-seaglass', 'pebble'],
      uncommon: ['spiral-conch', 'gold-sanddollar'],
      rare: ['sunset-starfish', 'green-bottle'],
      unique: ['nautilus'],
    },
  },
];

/**
 * The set live at `now`: the latest one that has started. Before the first
 * set starts, and after the last one ends, it's still a set (the first, then
 * the last) — the machine never sits empty. Null only when no set exists.
 */
export function currentSet(now: number, sets: VendingSet[] = VENDING_SETS): VendingSet | null {
  if (!sets.length) return null;
  const byStart = [...sets].sort((a, b) => Date.parse(a.starts) - Date.parse(b.starts));
  let cur = byStart[0];
  for (const s of byStart) if (Date.parse(s.starts) <= now) cur = s;
  return cur;
}

/** The next UTC midnight after `now` (ms) — when the next free ball is ready. */
export function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** Draw one item from a set. `rand` returns [0, 1); the server uses crypto randomness. */
export function drawVending(set: VendingSet, rand: () => number = cryptoRandom): { item: string; rarity: VendingRarity } {
  const order: VendingRarity[] = ['unique', 'rare', 'uncommon', 'common'];
  let r = rand();
  let rarity: VendingRarity = 'common';
  for (const k of order) {
    if (r < set.odds[k]) {
      rarity = k;
      break;
    }
    r -= set.odds[k];
  }
  const items = set.items[rarity];
  return { item: items[Math.min(items.length - 1, Math.floor(rand() * items.length))], rarity };
}
