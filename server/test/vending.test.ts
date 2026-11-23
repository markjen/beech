import { describe, expect, it } from 'vitest';
import { currentSet, drawVending, nextUtcMidnight, VENDING_ODDS, VENDING_SETS, type VendingSet } from '../src/vending.js';

const set = (week: number, starts: string): VendingSet => ({
  week,
  name: `Week ${week}`,
  starts,
  odds: VENDING_ODDS,
  items: { common: ['a'], uncommon: ['b'], rare: ['c'], unique: ['d'] },
});

describe('vending sets', () => {
  it('the live set is the latest one that has started', () => {
    const sets = [set(1, '2026-11-23'), set(2, '2026-11-30'), set(3, '2026-12-07')];
    expect(currentSet(Date.parse('2026-11-22'), sets)?.week).toBe(1); // before the first: the first
    expect(currentSet(Date.parse('2026-11-23'), sets)?.week).toBe(1);
    expect(currentSet(Date.parse('2026-11-29T23:59:59Z'), sets)?.week).toBe(1);
    expect(currentSet(Date.parse('2026-11-30'), sets)?.week).toBe(2);
    expect(currentSet(Date.parse('2026-12-06'), sets)?.week).toBe(2);
    expect(currentSet(Date.parse('2026-12-07'), sets)?.week).toBe(3);
    expect(currentSet(Date.parse('2027-06-01'), sets)?.week).toBe(3); // a missed week: the last keeps running
  });

  it('no sets, no set', () => {
    expect(currentSet(Date.now(), [])).toBeNull();
  });

  it('the shipped sets are in start order, with odds that sum to 1', () => {
    expect(VENDING_SETS.length).toBeGreaterThan(0);
    const starts = VENDING_SETS.map((s) => Date.parse(s.starts));
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    for (const s of VENDING_SETS) {
      expect(Object.values(s.odds).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      for (const ids of Object.values(s.items)) expect(ids.length).toBeGreaterThan(0);
    }
  });

  it('the next free ball is the next UTC midnight', () => {
    expect(nextUtcMidnight(Date.parse('2026-11-23T00:00:00Z'))).toBe(Date.parse('2026-11-24T00:00:00Z'));
    expect(nextUtcMidnight(Date.parse('2026-11-23T23:59:59Z'))).toBe(Date.parse('2026-11-24T00:00:00Z'));
    expect(nextUtcMidnight(Date.parse('2026-11-23T12:00:00Z'))).toBe(Date.parse('2026-11-24T00:00:00Z'));
  });
});

describe('drawVending', () => {
  it('draws with the published odds', () => {
    const n = 20000;
    const count: Record<string, number> = { common: 0, uncommon: 0, rare: 0, unique: 0 };
    let seed = 999;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const s = VENDING_SETS[0];
    for (let i = 0; i < n; i++) count[drawVending(s, rand).rarity]++;
    for (const k of Object.keys(count)) expect(count[k] / n).toBeCloseTo(s.odds[k as keyof typeof s.odds], 1);
  });

  it('only ever draws items from the set it was given', () => {
    const a = set(1, '2026-11-23');
    const b = set(2, '2026-11-30');
    b.items = { common: ['x'], uncommon: ['y'], rare: ['z'], unique: ['w'] };
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 200; i++) {
      expect(['a', 'b', 'c', 'd']).toContain(drawVending(a, rand).item);
      expect(['x', 'y', 'z', 'w']).toContain(drawVending(b, rand).item);
    }
  });

  it('a fixed roll draws the tier it lands in', () => {
    const s = VENDING_SETS[0];
    const rolls = [0.0, 0.5, 0.7, 0.9, 0.98];
    const got = rolls.map((v) => drawVending(s, () => v).rarity);
    // unique 0–0.03, rare 0.03–0.15, uncommon 0.15–0.40, common 0.40–1
    expect(got).toEqual(['unique', 'common', 'common', 'common', 'common']);
    expect(drawVending(s, () => 0.029).rarity).toBe('unique');
    expect(drawVending(s, () => 0.03).rarity).toBe('rare');
    expect(drawVending(s, () => 0.149).rarity).toBe('rare');
    expect(drawVending(s, () => 0.15).rarity).toBe('uncommon');
    expect(drawVending(s, () => 0.399).rarity).toBe('uncommon');
    expect(drawVending(s, () => 0.4).rarity).toBe('common');
  });
});
