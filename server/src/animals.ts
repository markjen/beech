// Server-side animal food & feeding helpers (docs/ANIMALS.md, Phase 2).
//
// Beach snacks (`crab-treat`) live in the existing `inventory` table as
// consumable quantities, bought in shop packs (server/src/products.ts) and
// occasionally earned for free alongside digging finds.

import type { Db } from './db.js';

export const TREAT_ITEM_ID = 'crab-treat';
/** Chance to receive a bonus free beach snack alongside a digging find. */
export const FREE_TREAT_CHANCE = 0.25;

/** Count how many unexpired beach snacks a user currently owns. */
export async function countTreats(db: Db, userId: string, now: number): Promise<number> {
  const rows = await db.query<{ n: string | null }>(
    `SELECT COALESCE(SUM(quantity), 0) AS n FROM inventory
      WHERE user_id = $1 AND item_id = $2 AND quantity > 0
        AND (expires_at IS NULL OR expires_at > $3)`,
    [userId, TREAT_ITEM_ID, now],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Atomically consume 1 unexpired beach snack from the user's inventory.
 * Uses the oldest non-empty row first so two concurrent requests can't
 * double-spend the last snack.
 */
export async function consumeTreat(
  db: Db,
  userId: string,
  now: number,
): Promise<{ ok: boolean; remaining: number }> {
  const rows = await db.query<{ id: number }>(
    `UPDATE inventory
        SET quantity = quantity - 1
      WHERE id = (
        SELECT id FROM inventory
         WHERE user_id = $1 AND item_id = $2 AND quantity > 0
           AND (expires_at IS NULL OR expires_at > $3)
         ORDER BY acquired_at ASC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id`,
    [userId, TREAT_ITEM_ID, now],
  );
  const remaining = await countTreats(db, userId, now);
  return { ok: rows.length > 0, remaining };
}

/** Roll for a free bonus beach snack and grant it to inventory if won. */
export async function maybeGrantBonusTreat(
  db: Db,
  userId: string,
  now: number,
  rand: () => number,
): Promise<boolean> {
  if (rand() >= FREE_TREAT_CHANCE) return false;
  await db.query(
    `INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at)
     VALUES ($1, $2, 1, 'pull', $3, NULL)`,
    [userId, TREAT_ITEM_ID, now],
  );
  return true;
}
