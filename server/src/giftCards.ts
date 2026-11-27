//@ backend dafny
// Gift cards and promo codes (docs/GIFT_CARDS_PROMOS.md).
//
// The shape follows the shop: purchases go through Apple / Google, whose
// prices the server can't change, so neither feature touches the stores.
// A gift card is prepaid credit (USD cents): redeeming one moves its whole
// value into your account credit, and credit buys products server-side
// (`POST /api/store/credit-purchase`). A promo code never discounts anything
// (Mark, 2026-11-27): it gives bonus beech bucks, on its own or on top of a
// pack bought on the web (specs/tla/PromoBucks.tla). The server always
// prices from its own product list; the client never supplies a price.
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
  /** 'bucks': `value` bonus beech bucks; 'percent': `value`% (1-100) of a pack's bucks on top of it */
  kind: 'bucks' | 'percent';
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

/**
 * The bonus a promo gives, in cents (10 a buck): a bucks code its `value`
 * in bucks; a percent code that share of the pack's bucks, rounded down to
 * a whole buck, and nothing without a pack (`packBucks` 0: redeemed on its
 * own). Never negative.
 */
export function promoBonusCents(promo: Promo, packBucks: number): number {
  //@ verify
  //@ requires packBucks >= 0
  //@ ensures \result >= 0
  //@ ensures promo.kind === 'bucks' ==> \result === Math.max(0, promo.value) * 10
  //@ ensures promo.kind === 'percent' && packBucks === 0 ==> \result === 0
  //@ ensures promo.kind === 'percent' ==> \result <= packBucks * 10
  if (promo.kind === 'bucks') return Math.max(0, promo.value) * 10;
  return Math.floor((packBucks * Math.min(100, Math.max(0, promo.value))) / 100) * 10;
}

/**
 * Why this promo can't give its bonus this way, or null if it can: on its
 * own (`packId` null: bucks codes for any pack only), or with a pack.
 */
export function promoBlockedFor(promo: Promo, packId: string | null, now: number): string | null {
  if (packId === null) {
    if (promo.kind !== 'bucks') return 'that code works with a beech-buck pack: enter it when you top up';
    if (promo.appliesTo !== null) return 'that code works with a beech-buck pack: enter it when you top up';
    return promoBlocked(promo, '', now);
  }
  const why = promoBlocked(promo, packId, now);
  return why === 'that code is not for this product' ? 'that code is for a different pack' : why;
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
 * The credit purchase itself, as one statement: debit the credit, log the
 * spend, grant the items — all or nothing. The payment is the anchor: it
 * debits only if the credit covers the price, and the items are granted only
 * when it went through. Returns the granted inventory row IDs, or [] if the
 * credit changed after the handler's pre-checks; a [] return has changed
 * nothing. (Promo codes never discount a purchase: they give bonus bucks,
 * specs/tla/PromoBucks.tla.)
 */
export async function claimCreditPurchase(
  db: Db,
  args: {
    userId: string;
    productId: string;
    finalCents: number;
    items: string[];
    quantities: number[];
    /** each row's trade-in value per unit (docs/BEECH_BUCKS.md) */
    unitCents: number[];
    now: number;
  },
): Promise<{ id: string; item_id: string }[]> {
  const rows = await db.query<{ id: string; item_id: string }>(
    `WITH paid AS (
       UPDATE users SET credit_cents = credit_cents - $4
        WHERE id = $1 AND credit_cents >= $4
        RETURNING credit_cents
     ), logged AS (
       INSERT INTO credit_ledger (user_id, kind, amount_cents, ref, created_at)
       SELECT $1, 'spend', -$4, $2, $3 FROM paid
       RETURNING 1
     )
     -- bought in the shop (with credit, not a store purchase: no purchase_id)
     INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, purchase_id, unit_cents)
     SELECT $1, g.item, g.qty, 'shop', $3, NULL, g.unit FROM paid, unnest($5::text[], $6::int[], $7::int[]) AS g(item, qty, unit)
     RETURNING id, item_id`,
    [args.userId, args.productId, args.now, args.finalCents, args.items, args.quantities, args.unitCents],
  );
  return rows.map((r) => ({ id: String(r.id), item_id: r.item_id }));
}
