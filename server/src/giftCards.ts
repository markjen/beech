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
