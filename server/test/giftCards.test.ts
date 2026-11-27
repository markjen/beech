import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  formatCents,
  hashesEqual,
  hashGiftCode,
  isAdminEmail,
  isGiftCodeShape,
  isPromoCodeShape,
  newGiftCardCode,
  normalizeGiftCode,
  normalizePromoCode,
  promoBlocked,
  promoBlockedFor,
  promoBonusCents,
  type Promo,
} from '../src/giftCards.js';

const promo = (over: Partial<Promo> = {}): Promo => ({
  code: 'LAUNCH20',
  kind: 'percent',
  value: 20,
  appliesTo: null,
  maxUses: null,
  uses: 0,
  active: true,
  expiresAt: null,
  ...over,
});

describe('gift card codes', () => {
  it('generates 16 characters from the no-confusion alphabet, unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = newGiftCardCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
  });

  it('normalizes codes and checks their shape', () => {
    expect(normalizeGiftCode('k7f2-qx9m 4ab3')).toBe('K7F2QX9M4AB3');
    expect(isGiftCodeShape('K7F2QX9M4AB3CD56')).toBe(true);
    expect(isGiftCodeShape('short')).toBe(false);
    expect(isGiftCodeShape('')).toBe(false);
  });

  it('hashes deterministically, pepper-sensitive, and never equal for two codes', () => {
    const a = hashGiftCode('K7F2QX9M4AB3CD56', 'pepper');
    expect(a).toBe(hashGiftCode('k7f2-qx9m4ab3cd56', 'pepper')); // same code, typed differently
    expect(a).not.toBe(hashGiftCode('K7F2QX9M4AB3CD56', 'other-pepper'));
    expect(a).not.toBe(hashGiftCode('K7F2QX9M4AB3CD57', 'pepper'));
    expect(a).toBe(createHmac('sha256', 'pepper').update('K7F2QX9M4AB3CD56').digest('hex'));
    expect(hashesEqual(a, a)).toBe(true);
    expect(hashesEqual(a, hashGiftCode('K7F2QX9M4AB3CD57', 'pepper'))).toBe(false);
    expect(hashesEqual(a, 'short')).toBe(false);
  });
});

describe('promo codes', () => {
  it('normalizes and checks shape', () => {
    expect(normalizePromoCode('launch-20')).toBe('LAUNCH20');
    expect(isPromoCodeShape('LAUNCH20')).toBe(true);
    expect(isPromoCodeShape('ab')).toBe(false);
    expect(isPromoCodeShape('x'.repeat(33))).toBe(false);
  });

  it('blocks inactive, expired, used-up and wrong-product codes', () => {
    const now = 1_000_000;
    expect(promoBlocked(promo(), 'beach_1', now)).toBeNull();
    expect(promoBlocked(promo({ active: false }), 'beach_1', now)).toMatch(/no longer active/);
    expect(promoBlocked(promo({ expiresAt: now }), 'beach_1', now)).toMatch(/expired/);
    expect(promoBlocked(promo({ maxUses: 2, uses: 2 }), 'beach_1', now)).toMatch(/used up/);
    expect(promoBlocked(promo({ maxUses: 2, uses: 1 }), 'beach_1', now)).toBeNull();
    expect(promoBlocked(promo({ appliesTo: 'item_lighthouse' }), 'beach_1', now)).toMatch(/not for this product/);
    expect(promoBlocked(promo({ appliesTo: 'item_lighthouse' }), 'item_lighthouse', now)).toBeNull();
  });

  it('gives bonus bucks, never a discount: bucks codes their value, percent codes a share of the pack', () => {
    expect(promoBonusCents(promo({ kind: 'bucks', value: 50 }), 0)).toBe(500);
    expect(promoBonusCents(promo({ kind: 'bucks', value: 50 }), 130)).toBe(500); // the same with a pack
    expect(promoBonusCents(promo({ kind: 'percent', value: 20 }), 130)).toBe(260); // 26 bb
    expect(promoBonusCents(promo({ kind: 'percent', value: 20 }), 33)).toBe(60); // 6.6 bb rounds down to 6
    expect(promoBonusCents(promo({ kind: 'percent', value: 150 }), 10)).toBe(100); // capped at 100%
    expect(promoBonusCents(promo({ kind: 'percent', value: 20 }), 0)).toBe(0); // nothing without a pack
  });

  it('says which way a code works: bucks codes on their own or with a pack, percent codes with a pack only', () => {
    const now = 1_000_000;
    expect(promoBlockedFor(promo({ kind: 'bucks' }), null, now)).toBeNull();
    expect(promoBlockedFor(promo({ kind: 'bucks' }), 'bucks_30', now)).toBeNull();
    expect(promoBlockedFor(promo({ kind: 'percent' }), null, now)).toMatch(/top up/);
    expect(promoBlockedFor(promo({ kind: 'percent' }), 'bucks_30', now)).toBeNull();
    // a code for one pack: only with that pack
    expect(promoBlockedFor(promo({ kind: 'bucks', appliesTo: 'bucks_100' }), null, now)).toMatch(/top up/);
    expect(promoBlockedFor(promo({ kind: 'bucks', appliesTo: 'bucks_100' }), 'bucks_30', now)).toMatch(/different pack/);
    expect(promoBlockedFor(promo({ kind: 'bucks', appliesTo: 'bucks_100' }), 'bucks_100', now)).toBeNull();
    expect(promoBlockedFor(promo({ kind: 'bucks', active: false }), null, now)).toMatch(/no longer active/);
    expect(promoBlockedFor(promo({ kind: 'bucks', maxUses: 1, uses: 1 }), 'bucks_30', now)).toMatch(/used up/);
  });
});

describe('admin allowlist', () => {
  it('matches exactly, case-insensitively, and nothing else', () => {
    const list = ['markjen@gmail.com'];
    expect(isAdminEmail('markjen@gmail.com', list)).toBe(true);
    expect(isAdminEmail('MarkJen@Gmail.com', list)).toBe(true);
    expect(isAdminEmail('someone@example.com', list)).toBe(false);
    expect(isAdminEmail(null, list)).toBe(false);
    expect(isAdminEmail(undefined, list)).toBe(false);
    expect(isAdminEmail('markjen@gmail.com', [])).toBe(false);
  });

  it('formats cents', () => {
    expect(formatCents(999)).toBe('$9.99');
    expect(formatCents(0)).toBe('$0.00');
  });
});
