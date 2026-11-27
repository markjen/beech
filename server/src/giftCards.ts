// Gift cards and promo codes (docs/GIFT_CARDS_PROMOS.md).
//
// The shape follows the shop: purchases go through Apple / Google, whose
// prices the server can't change, so neither feature touches the stores.
// A gift card is prepaid credit (USD cents): redeeming one moves its whole
// value into your account credit, and credit buys products server-side
// (`POST /api/store/credit-purchase`) at full price. Promo codes never
// discount a credit purchase: they add bonus bb to bb pack purchases,
// applied automatically from the account (see promos.ts). The server always
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

/** "launch-20" -> "LAUNCH20". Promo codes are public, so this is only about
 *  treating the same code typed two ways as one code. */
export function normalizePromoCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isPromoCodeShape(raw: string): boolean {
  const code = normalizePromoCode(raw);
  return code.length >= 3 && code.length <= 32;
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
 * spend, grant the items — all or nothing. The payment debits only if the
 * credit covers the price. Returns the granted inventory row IDs, or [] if
 * the credit changed after the handler's pre-checks. A [] return has changed
 * nothing: no credit debited without items.
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
