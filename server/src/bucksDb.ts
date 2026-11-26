// Sand bucks in the database (docs/SAND_BUCKS.md, specs/tla/SandBucks.tla).
// The balance is users.credit_cents (10 cents a buck); what a clawback can't
// take becomes debt (users.creator_credit_debt_cents), paid off by the next
// bucks in. Every movement is logged in credit_ledger.

import type { Db } from './db.js';
import { bucksIn, type Product } from './products.js';
import { BUCK } from './bucks.js';

/**
 * Bucks in (CreditIn): pay off debt first, credit the rest, log it. The
 * player's row is locked for the statement. Returns the cents credited.
 */
export async function creditBalance(db: Db, user: string, cents: number, kind: string, ref: string, now: number): Promise<number> {
  if (cents <= 0) return 0;
  const rows = await db.query<{ delta: number }>(
    `WITH balance AS (
       SELECT id, LEAST(creator_credit_debt_cents, $2) AS recovered FROM users WHERE id = $1 FOR NO KEY UPDATE
     ), credited AS (
       UPDATE users u SET credit_cents = credit_cents + $2 - balance.recovered,
                          creator_credit_debt_cents = creator_credit_debt_cents - balance.recovered
        FROM balance WHERE u.id = balance.id RETURNING u.id, $2 - balance.recovered AS delta
     ), logged AS (
       INSERT INTO credit_ledger (user_id, kind, amount_cents, ref, created_at)
       SELECT id, $3, delta, $4, $5 FROM credited WHERE delta > 0
       RETURNING 1
     )
     SELECT delta FROM credited`,
    [user, cents, kind, ref, now],
  );
  return Number(rows[0]?.delta ?? 0);
}

/** Bucks back out (ClawBack): take what's there, the rest becomes debt. */
export async function clawBack(db: Db, user: string, cents: number, kind: string, ref: string, now: number): Promise<void> {
  if (cents <= 0) return;
  await db.query(
    `WITH balance AS (
       SELECT id, LEAST(credit_cents, $2) AS taken FROM users WHERE id = $1 FOR NO KEY UPDATE
     ), debited AS (
       UPDATE users u SET credit_cents = credit_cents - balance.taken,
                          creator_credit_debt_cents = creator_credit_debt_cents + $2 - balance.taken
        FROM balance WHERE u.id = balance.id RETURNING u.id, balance.taken
     )
     INSERT INTO credit_ledger (user_id, kind, amount_cents, ref, created_at)
     SELECT id, $3, -taken, $4, $5 FROM debited WHERE taken > 0`,
    [user, cents, kind, ref, now],
  );
}

/**
 * What a recorded real-money purchase grants (BuyPack): a pack's sand bucks
 * to the balance; an old app version's offer, its things to the bag (at
 * their list value for a later trade-in). Run in the same transaction that
 * recorded the purchase row.
 */
export async function grantPurchase(db: Db, args: { userId: string; purchaseId: string; product: Product; now: number }): Promise<void> {
  const { userId, purchaseId, product, now } = args;
  const bucks = bucksIn(product);
  if (bucks > 0) await creditBalance(db, userId, bucks * BUCK, 'pack', `purchase:${purchaseId}`, now);
  const things = product.grants.filter((g) => g.item !== 'bucks');
  if (!things.length) return;
  await db.query(
    `INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, purchase_id)
     SELECT $1, g.item, g.qty, 'shop', $2, $3 FROM unnest($4::text[], $5::int[]) AS g(item, qty)`,
    [userId, now, purchaseId, things.map((g) => g.item), things.map((g) => g.quantity)],
  );
}

/**
 * A refund of a recorded purchase (RefundPack): a pack's bucks come back out
 * (debt for what was spent); an old offer's things expire, and the bucks of
 * any that were traded in (by the buyer, or by whoever they were gifted to)
 * come back out too.
 */
export async function revokeGrant(db: Db, args: { purchaseId: string; userId: string; product: Product | undefined; now: number }): Promise<void> {
  const { purchaseId, userId, product, now } = args;
  const bucks = product ? bucksIn(product) : 0;
  if (bucks > 0) await clawBack(db, userId, bucks * BUCK, 'pack_refund', `purchase:${purchaseId}`, now);
  const traded = await db.query<{ user_id: string; cents: string }>(
    `SELECT t.user_id, SUM(t.value_cents) AS cents FROM trade_ins t JOIN inventory i ON i.id = t.inventory_id
      WHERE i.purchase_id = $1 GROUP BY t.user_id ORDER BY t.user_id`,
    [purchaseId],
  );
  for (const t of traded) await clawBack(db, t.user_id, Number(t.cents), 'trade_in_refund', `purchase:${purchaseId}`, now);
}
