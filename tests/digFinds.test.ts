import { describe, expect, it } from 'vitest';
import { VENDING_SETS } from '../server/src/vending';
import { digDraw, DIG_FIND_CHANCE, DIG_FIND_MIN_PATH_M, DIG_FIND_MIN_TIME_MS } from '../server/src/digFinds';
import { DIG_FIND_MIN_PATH_M as CLIENT_MIN_PATH_M, DIG_FIND_MIN_TIME_MS as CLIENT_MIN_TIME_MS, qualifiesForFind } from '../src/sim/digFinds';

describe('digging finds', () => {
  it('the client and the server agree on what counts as a real dig', () => {
    // the app decides whether to ask; the server re-checks the same numbers
    expect(CLIENT_MIN_PATH_M).toBe(DIG_FIND_MIN_PATH_M);
    expect(CLIENT_MIN_TIME_MS).toBe(DIG_FIND_MIN_TIME_MS);
  });

  it('a tap is not a dig; a drag, or digging in place, is', () => {
    expect(qualifiesForFind(0.1, 100)).toBe(false);
    expect(qualifiesForFind(1.9, 999)).toBe(false);
    expect(qualifiesForFind(2, 0)).toBe(true);
    expect(qualifiesForFind(5, 100)).toBe(true);
    expect(qualifiesForFind(0, 1000)).toBe(true);
    expect(qualifiesForFind(0.5, 3000)).toBe(true);
  });

  it('the dig draw follows the vending odds', () => {
    // the same draw as the vending machine, gated by the 1-in-10 chance
    const n = 20000;
    const count: Record<string, number> = { common: 0, uncommon: 0, rare: 0, unique: 0 };
    let found = 0;
    let seed = 777;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const s = VENDING_SETS[0];
    for (let i = 0; i < n; i++) {
      const d = digDraw(s, rand);
      if (d.found) {
        found++;
        count[d.rarity!]++;
      }
    }
    expect(found / n).toBeCloseTo(DIG_FIND_CHANCE, 1);
    for (const k of Object.keys(count)) expect(count[k] / found).toBeCloseTo(s.odds[k as keyof typeof s.odds], 1);
  });
});
