import { describe, expect, it } from 'vitest';
import { codesAllowed } from '../src/net/shop';

describe('gift card and promo codes in the shop', () => {
  it('are offered on the web and in development builds, never in the native apps', () => {
    expect(codesAllowed('web')).toBe(true);
    expect(codesAllowed('dev')).toBe(true);
    expect(codesAllowed('native')).toBe(false);
  });
});
