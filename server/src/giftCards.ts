//@ backend dafny
// Gift cards and promo codes (docs/GIFT_CARDS_PROMOS.md).
//
// The shape follows the shop: purchases go through Apple / Google, whose
// prices the server can't change, so neither feature touches the stores.
// A gift card is prepaid credit (USD cents): redeeming one moves its whole
// value into your account credit, and credit buys products server-side
// (`POST /api/store/credit-purchase`), where a promo code can discount the
// price. The server always prices from its own product list; the client
// never supplies a price.
//
// The two kinds of code are treated differently on purpose:
// - Gift card codes are bearer credentials: 16 random characters (80 bits)
//   from an alphabet with no confusables, stored only as an HMAC-SHA-256
//   with a server-side pepper (GIFT_CODE_PEPPER), shown once at issue and
//   never logged. Knowing the hash doesn't redeem the card.
// - Promo codes are public marketing codes ("LAUNCH20"): they are meant to
//   be shared, so they are stored in plain text, normalized to upper case.
//   Their only protection is server-side validation and rate limiting.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from './db.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
export const GIFT_CODE_LENGTH = 16;

/** A new gift card code, e.g. "K7F2QX9M..." — crypto-random, 80 bits. */
export function newGiftCardCode(): string {
  const bytes = randomBytes(GIFT_CODE_LENGTH);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** "k7f2-qx9m" -> "K7F2QX9M": upper case, separators stripped. */
export function normalizeGiftCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isGiftCodeShape(raw: string): boolean {
  return normalizeGiftCode(raw).length === GIFT_CODE_LENGTH;
}

/** HMAC-SHA-256 of the normalized code under the pepper. The pepper is the
 *  only secret here; without it the hash is still a one-way function of an
 *  80-bit code, but the pepper means a leaked database alone is not enough
 *  to test guesses offline. */
export function hashGiftCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(normalizeGiftCode(code)).digest('hex');
}

/** Constant-time equality for two hex digests of the same length. */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export interface Promo {
  code: string;
  /** 'percent' (1-100) or 'fixed' (USD cents off) */
  kind: 'percent' | 'fixed';
  value: number;
  /** null: any product; otherwise one product id */
  appliesTo: string | null;
  maxUses: number | null;
  uses: number;
  active: boolean;
  expiresAt: number | null;
}

/** "launch-20" -> "LAUNCH20". Promo codes are public, so this is only about
 *  treating the same code typed two ways as one code. */
export function normalizePromoCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isPromoCodeShape(raw: string): boolean {
  const code = normalizePromoCode(raw);
  return code.length >= 3 && code.length <= 32;
}

/**
 * Why a promo can't be used for this product right now, or null if it can.
 * Checked again inside the purchase statement, so a code can't be used
 * twice in a race or after it expired mid-request.
 */
export function promoBlocked(promo: Promo, productId: string, now: number): string | null {
  //@ verify
  //@ ensures (\result === null) <==> (promo.active && (promo.expiresAt === null || promo.expiresAt > now) && (promo.maxUses === null || promo.uses < promo.maxUses) && (promo.appliesTo === null || promo.appliesTo === productId))
  if (!promo.active) return 'that code is no longer active';
  if (promo.expiresAt !== null && promo.expiresAt <= now) return 'that code has expired';
  if (promo.maxUses !== null && promo.uses >= promo.maxUses) return 'that code has been used up';
  if (promo.appliesTo !== null && promo.appliesTo !== productId) return 'that code is not for this product';
  return null;
}

/** The discount in USD cents for a product at `priceCents`. Percent rounds
 *  down (the player never overpays by a fraction); a fixed discount never
 *  takes the price below zero. */
export function discountCents(promo: Promo, priceCents: number): number {
  //@ verify
  //@ requires priceCents >= 0
  //@ ensures \result >= 0 && \result <= priceCents
  //@ ensures promo.kind === 'fixed' ==> \result === Math.min(priceCents, Math.max(0, promo.value))
  if (promo.kind === 'percent') return Math.floor((priceCents * Math.min(100, Math.max(0, promo.value))) / 100);
  return Math.min(priceCents, Math.max(0, promo.value));
}

/** The admin allowlist: exact email match, case-insensitive. Empty list
 *  means nobody is an admin (the console stays closed). */
export function isAdminEmail(email: string | null | undefined, allowlist: string[]): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  return allowlist.some((e) => e.toLowerCase() === lower);
}

/** USD cents -> "$9.99", for admin displays. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * The credit purchase itself, as one statement: debit the credit, claim the
 * promo, log the use and the spend, grant the items — all or nothing. The
 * payment is the anchor: it debits only if the credit covers the
 * (discounted) price and — when a promo was given — the promo is claimable
 * right now. The EXISTS locks that promo row (FOR UPDATE) until the
 * statement ends, so a second purchase can't slip in and exhaust the promo
 * between this check and the increment below. The promo is then incremented
 * only because the payment went through, the use is logged only because the
 * promo was claimed, and the items are granted only when the payment went
 * through (and the promo, if any, was claimed). Returns the granted inventory
 * row IDs, or [] if credit or promo availability changed after the handler's
 * pre-checks. A [] return has changed
 * nothing: no burned promo use, no credit debited without items.
 *
 * The $3::text casts are load-bearing: Postgres can't infer the promo-code
 * parameter's type from inside ($3 IS NULL OR EXISTS (...)) alone (42P08).
 */
export async function claimCreditPurchase(
  db: Db,
  args: {
    userId: string;
    productId: string;
    promoCode: string | null;
    finalCents: number;
    discountCents: number;
    items: string[];
    quantities: number[];
    /** each row's trade-in value per unit (docs/SAND_BUCKS.md) */
    unitCents: number[];
    now: number;
  },
): Promise<{ id: string; item_id: string }[]> {
  const rows = await db.query<{ id: string; item_id: string }>(
    `WITH paid AS (
       UPDATE users SET credit_cents = credit_cents - $5
        WHERE id = $1 AND credit_cents >= $5
          AND ($3::text IS NULL OR EXISTS (
            SELECT 1 FROM promo_codes
             WHERE code = $3::text AND active AND (expires_at IS NULL OR expires_at > $4)
               AND (max_uses IS NULL OR uses < max_uses)
               AND (applies_to IS NULL OR applies_to = $2)
             FOR UPDATE
          ))
        RETURNING credit_cents
     ), promo AS (
       UPDATE promo_codes SET uses = uses + 1
        WHERE code = $3::text AND active AND (expires_at IS NULL OR expires_at > $4)
          AND (max_uses IS NULL OR uses < max_uses)
          AND (applies_to IS NULL OR applies_to = $2)
          AND EXISTS (SELECT 1 FROM paid)
        RETURNING code
     ), used AS (
       INSERT INTO promo_uses (code, user_id, product_id, discount_cents, created_at)
       SELECT $3::text, $1, $2, $6, $4 FROM paid WHERE $3::text IS NOT NULL AND EXISTS (SELECT 1 FROM promo)
       RETURNING 1
     ), logged AS (
       INSERT INTO credit_ledger (user_id, kind, amount_cents, ref, created_at)
       SELECT $1, 'spend', -$5, $2, $4 FROM paid
       RETURNING 1
     )
     -- bought in the shop (with credit, not a store purchase: no purchase_id)
     INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, purchase_id, unit_cents)
     SELECT $1, g.item, g.qty, 'shop', $4, NULL, g.unit FROM paid, unnest($7::text[], $8::int[], $9::int[]) AS g(item, qty, unit)
     WHERE $3::text IS NULL OR EXISTS (SELECT 1 FROM promo)
     RETURNING id, item_id`,
    [args.userId, args.productId, args.promoCode, args.now, args.finalCents, args.discountCents, args.items, args.quantities, args.unitCents],
  );
  return rows.map((r) => ({ id: String(r.id), item_id: r.item_id }));
}
