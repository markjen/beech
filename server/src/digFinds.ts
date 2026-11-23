// Digging finds: when a good dig ends, the player can turn up something
// buried — drawn here on the server (never in the app), from this week's
// vending set at the vending odds (docs/VENDING_MACHINE.md, docs/DIGGING_FINDS.md).
//
// The app only reports how much was dug (brush travel in metres, stroke
// duration in ms); the server decides whether the stroke earned a roll, and
// rolls. Three things keep digging from becoming a free-item faucet:
//   - a stroke only earns a roll when it really dug (the thresholds below),
//   - at most one roll every 30 s,
//   - at most 3 finds a day (UTC).
// The finds themselves are logged in `pulls` (pool 'dig') and granted in
// `inventory` (source 'pull', like any other random draw), so a find that
// lands in the bag is indistinguishable from a claw or vending win — and
// just as hard to mint twice.

import { drawVending, type VendingRarity, type VendingSet } from './vending.js';

/** one in ten good digs turns something up */
export const DIG_FIND_CHANCE = 0.1;
/** most buried treasure you can dig up in one UTC day */
export const DIG_FIND_DAILY_CAP = 3;
/** shortest gap between two rolls (ms) — the server enforces this, the app mirrors it */
export const DIG_FIND_ROLL_COOLDOWN_MS = 30_000;
/** a stroke counts as a real dig when the brush travels this far (m) ... */
export const DIG_FIND_MIN_PATH_M = 2;
/** ... or digs in one place this long (ms) */
export const DIG_FIND_MIN_TIME_MS = 1000;

/** Did this stroke dig enough to earn a roll? A tap, or a wiggle, doesn't. */
export function qualifiesForFind(pathM: number, durationMs: number): boolean {
  return pathM >= DIG_FIND_MIN_PATH_M || durationMs >= DIG_FIND_MIN_TIME_MS;
}

/**
 * One digging roll from a set: the chance roll first, then the vending
 * draw. `rand` returns [0, 1); the server uses crypto randomness, tests
 * force it. The distribution is the vending machine's (60/25/12/3) — see
 * server/test/digFinds.test.ts for the seeded check.
 */
export function digDraw(set: VendingSet, rand: () => number): { found: boolean; item?: string; rarity?: VendingRarity } {
  if (rand() >= DIG_FIND_CHANCE) return { found: false };
  const d = drawVending(set, rand);
  return { found: true, item: d.item, rarity: d.rarity };
}
