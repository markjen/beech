// Account-loaded promo codes for beech-buck packs (specs/tla/PromoCodes.tla).
//
// Players load promo codes onto their account and can collect multiple codes.
// Each code can be used at most once per account (and at most max_uses times
// globally, while active and unexpired). All pack purchase prices stay the
// same; when a player buys any bb pack, the server automatically consumes the
// loaded unused eligible promo code that gives the largest extra bonus bb.

import { BUCK } from './bucks.js';
import type { Db } from './db.js';
import { isPromoCodeShape, normalizePromoCode } from './giftCards.js';
import { bucksIn, type Product } from './products.js';

export type AccountPromoStatus = 'ready' | 'used' | 'expired' | 'disabled' | 'exhausted';

export interface AccountPromo {
  code: string;
  kind: 'percent';
  value: number;
  appliesTo: string | null;
  status: AccountPromoStatus;
  loadedAt: number;
  usedAt: number | null;
  bonusBucks: number;
  expiresAt: number | null;
}

/**
 * Extra bonus beech bucks a promo code adds on top of a pack's normal grant.
 * Promo codes are percent-only: ceil(packBucks * value / 100), so any
 * positive percent promo always grants at least +1 bonus bb.
 */
export function promoBonusBucks(promo: { kind: 'percent'; value: number }, packBucks: number): number {
  if (packBucks <= 0 || promo.value <= 0) return 0;
  return Math.ceil((packBucks * Math.min(100, promo.value)) / 100);
}

interface JoinedPromoRow {
  code: string;
  kind: string;
  value: number;
  applies_to: string | null;
  max_uses: number | null;
  uses: number;
  active: boolean;
  expires_at: string | null;
  loaded_at: string;
  used_at: string | null;
  bonus_bucks: number;
}

function rowStatus(r: JoinedPromoRow, now: number): AccountPromoStatus {
  if (r.used_at !== null) return 'used';
  if (!r.active) return 'disabled';
  if (r.expires_at !== null && Number(r.expires_at) <= now) return 'expired';
  if (r.max_uses !== null && Number(r.uses) >= Number(r.max_uses)) return 'exhausted';
  return 'ready';
}

function toAccountPromo(r: JoinedPromoRow, now: number): AccountPromo {
  return {
    code: r.code,
    kind: r.kind as 'percent',
    value: Number(r.value),
    appliesTo: r.applies_to,
    status: rowStatus(r, now),
    loadedAt: Number(r.loaded_at),
    usedAt: r.used_at === null ? null : Number(r.used_at),
    bonusBucks: Number(r.bonus_bucks),
    expiresAt: r.expires_at === null ? null : Number(r.expires_at),
  };
}

/** All promo codes loaded on one account (ready ones first, newest first). */
export async function accountPromos(db: Db, userId: string, now: number): Promise<AccountPromo[]> {
  const rows = await db.query<JoinedPromoRow>(
    `SELECT a.code, p.kind, p.value, p.applies_to, p.max_uses, p.uses, p.active, p.expires_at,
            a.loaded_at, a.used_at, a.bonus_bucks
       FROM account_promo_codes a
       JOIN promo_codes p ON p.code = a.code
      WHERE a.user_id = $1
      ORDER BY a.used_at NULLS FIRST, a.loaded_at DESC, a.code ASC`,
    [userId],
  );
  return rows.map((r) => toAccountPromo(r, now));
}

/**
 * Pick the ready promo code on the account that gives the largest bonus bb
 * for `pack`. Tie-break: expires soonest first, then loaded earliest, then
 * alphabetical by code.
 */
export function bestPromoForPack(
  promos: AccountPromo[],
  pack: { id: string; bucks: number },
): { code: string; bonusBucks: number } | null {
  let best: { code: string; bonusBucks: number; expiresAt: number | null; loadedAt: number } | null = null;
  for (const p of promos) {
    if (p.status !== 'ready') continue;
    if (p.appliesTo !== null && p.appliesTo !== pack.id) continue;
    const bonus = promoBonusBucks(p, pack.bucks);
    if (bonus <= 0) continue;
    if (
      !best ||
      bonus > best.bonusBucks ||
      (bonus === best.bonusBucks &&
        ((p.expiresAt ?? Infinity) < (best.expiresAt ?? Infinity) ||
          ((p.expiresAt ?? Infinity) === (best.expiresAt ?? Infinity) &&
            (p.loadedAt < best.loadedAt || (p.loadedAt === best.loadedAt && p.code < best.code)))))
    ) {
      best = { code: p.code, bonusBucks: bonus, expiresAt: p.expiresAt, loadedAt: p.loadedAt };
    }
  }
  return best ? { code: best.code, bonusBucks: best.bonusBucks } : null;
}

/**
 * Load a promo code onto a player's account (LoadPromo in PromoCodes.tla).
 * Does not increment global `uses` until a pack purchase actually consumes it.
 */
export async function loadAccountPromo(
  db: Db,
  userId: string,
  rawCode: string,
  now: number,
): Promise<{ ok: true; promo: AccountPromo } | { ok: false; status: 400 | 404 | 409; error: string }> {
  if (!isPromoCodeShape(rawCode)) return { ok: false, status: 404, error: "that code isn't valid" };
  const code = normalizePromoCode(rawCode);
  const [p] = await db.query<{
    code: string;
    kind: string;
    value: number;
    applies_to: string | null;
    max_uses: number | null;
    uses: number;
    active: boolean;
    expires_at: string | null;
  }>('SELECT code, kind, value, applies_to, max_uses, uses, active, expires_at FROM promo_codes WHERE code = $1', [code]);
  if (!p) return { ok: false, status: 404, error: 'no such promo code' };

  const [existing] = await db.query<{ used_at: string | null }>(
    'SELECT used_at FROM account_promo_codes WHERE user_id = $1 AND code = $2',
    [userId, code],
  );
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: existing.used_at !== null ? 'you already used that promo code' : 'that promo code is already on your account',
    };
  }
  if (!p.active) return { ok: false, status: 400, error: 'that code is no longer active' };
  if (p.expires_at !== null && Number(p.expires_at) <= now) return { ok: false, status: 400, error: 'that code has expired' };
  if (p.max_uses !== null && Number(p.uses) >= Number(p.max_uses)) return { ok: false, status: 400, error: 'that code has been used up' };

  const inserted = await db.query<{ code: string }>(
    `INSERT INTO account_promo_codes (user_id, code, loaded_at)
     VALUES ($1, $2, $3) ON CONFLICT (user_id, code) DO NOTHING RETURNING code`,
    [userId, code, now],
  );
  if (!inserted.length) return { ok: false, status: 409, error: 'that promo code is already on your account' };
  return {
    ok: true,
    promo: {
      code: p.code,
      kind: p.kind as 'percent',
      value: Number(p.value),
      appliesTo: p.applies_to,
      status: 'ready',
      loadedAt: now,
      usedAt: null,
      bonusBucks: 0,
      expiresAt: p.expires_at === null ? null : Number(p.expires_at),
    },
  };
}

/**
 * Consume the best eligible loaded promo code on `userId`'s account for a bb
 * pack purchase (BuyAtomic in PromoCodes.tla). Run inside the purchase's
 * transaction right alongside `creditBalance` for the base pack.
 *
 * Locks the buyer's unused `account_promo_codes` rows (FOR UPDATE OF a) so two
 * concurrent purchases by the same user cannot claim the same code, then
 * atomically claims the highest-bonus candidate on `promo_codes` (falling
 * through to the next best if another buyer just took the last use).
 */
export async function claimBestPromoForPack(
  tx: Db,
  args: { userId: string; purchaseId: string; product: Product; now: number },
): Promise<{ code: string; bonusBucks: number } | null> {
  const { userId, purchaseId, product, now } = args;
  const baseBucks = bucksIn(product);
  if (baseBucks <= 0) return null;

  const rows = await tx.query<JoinedPromoRow>(
    `SELECT a.code, p.kind, p.value, p.applies_to, p.max_uses, p.uses, p.active, p.expires_at,
            a.loaded_at, a.used_at, a.bonus_bucks
       FROM account_promo_codes a
       JOIN promo_codes p ON p.code = a.code
      WHERE a.user_id = $1 AND a.used_at IS NULL
      FOR UPDATE OF a`,
    [userId],
  );

  const candidates = rows
    .filter(
      (r) =>
        r.active &&
        (r.expires_at === null || Number(r.expires_at) > now) &&
        (r.max_uses === null || Number(r.uses) < Number(r.max_uses)) &&
        (r.applies_to === null || r.applies_to === product.id),
    )
    .map((r) => ({
      code: r.code,
      bonus: promoBonusBucks({ kind: r.kind as 'percent', value: Number(r.value) }, baseBucks),
      expiresAt: r.expires_at === null ? Infinity : Number(r.expires_at),
      loadedAt: Number(r.loaded_at),
    }))
    .filter((c) => c.bonus > 0)
    .sort((a, b) => b.bonus - a.bonus || a.expiresAt - b.expiresAt || a.loadedAt - b.loadedAt || a.code.localeCompare(b.code));

  for (const c of candidates) {
    const claimed = await tx.query<{ code: string }>(
      `UPDATE promo_codes
          SET uses = uses + 1
        WHERE code = $1
          AND active
          AND (expires_at IS NULL OR expires_at > $2)
          AND (max_uses IS NULL OR uses < max_uses)
       RETURNING code`,
      [c.code, now],
    );
    if (!claimed.length) continue;

    await tx.query(
      `UPDATE account_promo_codes
          SET used_at = $3, purchase_id = $4, bonus_bucks = $5
        WHERE user_id = $1 AND code = $2`,
      [userId, c.code, now, purchaseId, c.bonus],
    );
    await tx.query(
      `INSERT INTO promo_uses (code, user_id, product_id, discount_cents, purchase_id, bonus_bucks, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [c.code, userId, product.id, c.bonus * BUCK, purchaseId, c.bonus, now],
    );
    return { code: c.code, bonusBucks: c.bonus };
  }
  return null;
}
