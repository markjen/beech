// Pulls: draws of a random item from a pool, decided here on the server
// (never in the app), with odds published in the guide (server/src/guide.ts).
//
// The only pool so far is the free claw machine: nothing to pay. The wait
// between goes is random, 5 minutes to 3 hours, shorter after a miss and
// longer after a win (cooldownAfter). Paid pools will reuse the same draw once store
// billing exists. Apple and Google require the odds of paid random items to
// be shown, and some countries restrict paid random items; check before
// adding a paid pool. A paid pool must show its odds in the app before the
// purchase: that is the one exception to "no notes in the game" (CLAUDE.md).
//
// The vending machine (server/src/vending.ts) is a second pool of the same
// shape — one free ball a day from a weekly set — but it lives outside
// POOLS because its items change every week. Its tiers are the same five
// rarities; the claw just never draws 'uncommon' or 'unique' (odds 0).
//
// Item ids must exist in the app's catalog (src/world/items.ts); a test in
// tests/items.test.ts keeps the two in step.

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'unique';

export interface Pool {
  id: string;
  name: string;
  /** chance of each rarity (sums to 1) */
  odds: Record<Rarity, number>;
  /** which items a rarity can give, equally likely */
  items: Record<Rarity, string[]>;
}

export const POOLS: Record<string, Pool> = {
  daily: {
    id: 'daily',
    name: 'Claw machine',
    odds: { common: 0.7, uncommon: 0, rare: 0.25, legendary: 0.05, unique: 0 },
    items: {
      common: ['conch', 'sanddollar'],
      uncommon: [],
      rare: ['starfish'],
      legendary: ['bottle'],
      unique: [],
    },
  },
};

/**
 * Starter gifts: everyone's first goes on the claw machine give the same
 * things, and the machine says so up front (the published odds apply to
 * every other go):
 *   go 1                          a rare find
 *   go 2                          something from the shop (normally paid)
 *   first go a day after go 1     a whole extra beach (once)
 *
 * The starter gifts always hold: they're gifts, not grabs. Every other go
 * can miss — see GRAB_CHANCE.
 */
export const STARTER = {
  rare: { item: 'starfish', rarity: 'rare' as Rarity },
  paid: { item: 'deckchair', rarity: 'rare' as Rarity },
  beach: { item: 'beach', rarity: 'legendary' as Rarity },
  beachAfterMs: 24 * 60 * 60 * 1000,
};

/** The prize a go gives if it's a starter gift, else null (a normal draw). */
export function starterPrize(
  go: number,
  firstGoAt: number | null,
  now: number,
  hadBeach: boolean,
): { item: string; rarity: Rarity } | null {
  if (go === 1) return STARTER.rare;
  if (go === 2) return STARTER.paid;
  if (!hadBeach && firstGoAt !== null && now - firstGoAt >= STARTER.beachAfterMs) return STARTER.beach;
  return null;
}

/** Draw from a pool. `rand` returns [0, 1); the server uses crypto randomness. */
export function draw(pool: Pool, rand: () => number = cryptoRandom): { item: string; rarity: Rarity } {
  const order: Rarity[] = ['unique', 'legendary', 'rare', 'uncommon', 'common'];
  let r = rand();
  let rarity: Rarity = 'common';
  for (const k of order) {
    if (r < pool.odds[k]) {
      rarity = k;
      break;
    }
    r -= pool.odds[k];
  }
  const items = pool.items[rarity];
  return { item: items[Math.min(items.length - 1, Math.floor(rand() * items.length))], rarity };
}

/**
 * The claw doesn't always hold on: after the draw, the ball can slip out,
 * and the go is spent anyway. Rarer balls are harder to hold — the claw
 * keeps a common ball 4 times in 5, a rare one about 2 times in 3, and a
 * legendary one 2 times in 5. With the daily pool's odds that means about
 * 1 go in 4 comes up empty overall (0.7×0.20 + 0.25×0.35 + 0.05×0.60).
 * The chances are published to the app (GET /pulls) so the odds shown under
 * the machine stay honest: they are the chances of what the claw grabs at,
 * and these are the chances it holds on.
 */
export const GRAB_CHANCE: Record<'common' | 'rare' | 'legendary', number> = { common: 0.8, rare: 0.65, legendary: 0.4 };

/**
 * After the draw: does the claw hold on to a ball of this rarity? `rand`
 * returns [0, 1). The claw never draws 'uncommon' or 'unique' (odds 0), so
 * those have no grab chance and always hold.
 */
export function grab(rarity: Rarity, rand: () => number = cryptoRandom): boolean {
  const chance = (GRAB_CHANCE as Partial<Record<Rarity, number>>)[rarity];
  return chance === undefined || rand() < chance;
}

export function cryptoRandom(): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] / 4294967296;
}

/** the shortest and longest rest between goes on the claw */
export const COOLDOWN_MIN_MS = 5 * 60 * 1000;
export const COOLDOWN_MAX_MS = 3 * 60 * 60 * 1000;

/**
 * How long the claw rests after a go: random between 5 minutes and 3 hours.
 * A miss skews short (u², mean ~1 h) so a dropped ball stings less; a win
 * skews long (1 - (1-u)², mean ~2 h). `rand` returns [0, 1).
 */
export function cooldownAfter(missed: boolean, rand: () => number = cryptoRandom): number {
  const u = Math.min(Math.max(rand(), 0), 1);
  const t = missed ? u * u : 1 - (1 - u) * (1 - u);
  return Math.round(COOLDOWN_MIN_MS + (COOLDOWN_MAX_MS - COOLDOWN_MIN_MS) * t);
}

/** The UTC day a pull happened on, e.g. "2026-11-22" (kept for the history). */
export const pullDay = (now: number) => new Date(now).toISOString().slice(0, 10);
