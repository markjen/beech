// Pulls: draws of a random item from a pool, decided here on the server
// (never in the app), with odds that the app shows before every draw.
//
// The only pool so far is the free claw machine: nothing to pay. The wait
// between goes starts short and doubles each go, up to once a day
// (cooldownAfter). Paid pools will reuse the same draw once store
// billing exists. Apple and Google require the odds of paid random items to
// be shown, and some countries restrict paid random items; check before
// adding a paid pool.
//
// Item ids must exist in the app's catalog (src/world/items.ts); a test in
// tests/items.test.ts keeps the two in step.

export type Rarity = 'common' | 'rare' | 'legendary';

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
    odds: { common: 0.7, rare: 0.25, legendary: 0.05 },
    items: {
      common: ['conch', 'sanddollar'],
      rare: ['starfish'],
      legendary: ['bottle'],
    },
  },
};

/** Draw from a pool. `rand` returns [0, 1); the server uses crypto randomness. */
export function draw(pool: Pool, rand: () => number = cryptoRandom): { item: string; rarity: Rarity } {
  const order: Rarity[] = ['legendary', 'rare', 'common'];
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

export function cryptoRandom(): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] / 4294967296;
}

/** first wait, and the most it grows to */
export const COOLDOWN_FIRST_MS = 5 * 60 * 1000;
export const COOLDOWN_MAX_MS = 24 * 60 * 60 * 1000;

/** How long to wait after your nth go (n = 1, 2, …): 5 min, 10, 20, … up to a day. */
export function cooldownAfter(n: number): number {
  return Math.min(COOLDOWN_MAX_MS, COOLDOWN_FIRST_MS * Math.pow(2, Math.max(0, n - 1)));
}

/** The UTC day a pull happened on, e.g. "2026-11-22" (kept for the history). */
export const pullDay = (now: number) => new Date(now).toISOString().slice(0, 10);
