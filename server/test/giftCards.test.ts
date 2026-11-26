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
} from '../src/giftCards.js';

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
