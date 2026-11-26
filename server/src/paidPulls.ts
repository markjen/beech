// Paid extra tries on the claw and vending machines (docs/PRICING.md): when
// the free go is gone, one more try for sand bucks.
//
// The price is 10 sand bucks on both machines (Mark's call, Nov 26, 2026):
// the vending ball's EV is 8.5 (~18% edge) and the claw go's is 5.84
// (~71% edge). Both prices sit above what a try is worth on average, so a
// try can never be farmed for trade-ins: buying tries to trade the prizes
// back in loses sand bucks. A won item is valued at its trade-in value
// (RARITY_BUCKS), the codebase's own "what a pull item is worth in bucks"
// — except unique, a one-of-a-kind item with no trade-in value, where the
// EV assumes 40, one step above legendary's 30.
//
// A paid try is exactly one draw, same as a free one: the vending ball
// never slips, the claw can still drop the ball (the go is spent), and a
// paid try never gets a starter gift. The odds are the published ones, and
// the machines show them before the player buys (the store rule for paid
// random items — see the note in server/src/pulls.ts).

import type { Db } from './db.js';
import { RARITY_BUCKS, centsToBucks } from './bucks.js';
import { GRAB_CHANCE, POOLS, pullDay, type Rarity } from './pulls.js';
import { VENDING_ODDS } from './vending.js';

/** what a won item of each rarity is worth, in sand bucks (see above) */
export const PAID_PULL_VALUE_BUCKS: Record<Rarity, number> = {
  common: RARITY_BUCKS.common,
  uncommon: RARITY_BUCKS.uncommon,
  rare: RARITY_BUCKS.rare,
  legendary: RARITY_BUCKS.legendary,
  // one of a kind: no trade-in value, so the EV assumes one step above legendary
  unique: 40,
};

/**
 * Expected sand bucks of one draw: over rarities, odds × value — times the
 * hold-on chance where given (a ball the claw drops wins nothing).
 */
export function expectedBucks(
  odds: Partial<Record<Rarity, number>>,
  values: Record<Rarity, number> = PAID_PULL_VALUE_BUCKS,
  grab?: Partial<Record<Rarity, number>>,
): number {
  let ev = 0;
  for (const [rarity, o] of Object.entries(odds)) {
    const v = values[rarity as Rarity] ?? 0;
    const hold = grab?.[rarity as Rarity] ?? 1;
    ev += (o ?? 0) * hold * v;
  }
  return ev;
}

/** expected sand bucks of one extra ball from the current vending odds */
export const vendingExtraBallEV = (): number => expectedBucks(VENDING_ODDS, PAID_PULL_VALUE_BUCKS);

/** expected sand bucks of one extra go on the claw (a miss wins nothing) */
export const clawExtraGoEV = (): number => expectedBucks(POOLS.daily.odds, PAID_PULL_VALUE_BUCKS, GRAB_CHANCE);

/** one extra ball from the vending machine, in sand bucks (EV 8.5) */
export const VENDING_EXTRA_BALL_BUCKS = 10;
/** one extra go on the claw machine, in sand bucks (EV 5.84) */
export const CLAW_EXTRA_GO_BUCKS = 10;

/** the price of one extra try on a machine, or null when it has none */
export const paidTryPrice = (poolId: string): number | null =>
  poolId === 'vending' ? VENDING_EXTRA_BALL_BUCKS : poolId === 'daily' ? CLAW_EXTRA_GO_BUCKS : null;

/**
 * A paid try, as one statement: debit the price (only if the balance covers
 * it), log the spend, record the pull and grant the prize — all or nothing.
 * A miss deducts and logs, and grants nothing (the go is spent, same as a
 * free miss). Returns the new balance in sand bucks, or null when the
 * balance didn't cover the price — in which case nothing changed: no bucks
 * debited, no prize granted, no pull logged. Mirrors claimCreditPurchase
 * (server/src/giftCards.ts).
 */
export async function claimPaidPull(
  db: Db,
  args: {
    userId: string;
    pool: string;
    /** what the try costs, in cents of sand bucks (whole bucks) */
    priceCents: number;
    /** null: the claw dropped the ball — the try is spent, nothing is won */
    item: string | null;
    rarity: string | null;
    now: number;
  },
): Promise<{ bucks: number } | null> {
  const win = args.item !== null && args.rarity !== null;
  const rows = win
    ? await db.query<{ credit_cents: number }>(
        `WITH paid AS (
           UPDATE users SET credit_cents = credit_cents - $3
            WHERE id = $1 AND credit_cents >= $3
            RETURNING credit_cents
         ), logged AS (
           INSERT INTO credit_ledger (user_id, kind, amount_cents, ref, created_at)
           SELECT $1, 'spend', -$3, $4, $5 FROM paid
           RETURNING 1
         ), history AS (
           INSERT INTO pulls (user_id, pool, day, item_id, rarity, created_at)
           SELECT $1, $2, $6, $7, $8, $5 FROM paid
           RETURNING 1
         ), granted AS (
           INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at)
           SELECT $1, $7, 1, 'pull', $5, NULL FROM paid
           RETURNING 1
         )
         SELECT credit_cents FROM paid`,
        [args.userId, args.pool, args.priceCents, `pull:${args.pool}`, args.now, pullDay(args.now), args.item, args.rarity],
      )
    : await db.query<{ credit_cents: number }>(
        // a miss has no pool to record, so the parameters are renumbered:
        // every parameter must be used, or Postgres can't tell its type
        `WITH paid AS (
           UPDATE users SET credit_cents = credit_cents - $2
            WHERE id = $1 AND credit_cents >= $2
            RETURNING credit_cents
         ), logged AS (
           INSERT INTO credit_ledger (user_id, kind, amount_cents, ref, created_at)
           SELECT $1, 'spend', -$2, $3, $4 FROM paid
           RETURNING 1
         )
         SELECT credit_cents FROM paid`,
        [args.userId, args.priceCents, `pull:${args.pool}`, args.now],
      );
  if (!rows[0]) return null;
  return { bucks: centsToBucks(Number(rows[0].credit_cents)) };
}
