import { describe, expect, it } from 'vitest';
import { isViewingMode, orderInfoRows } from '../src/ui/shoreInfo';

describe('viewing mode', () => {
  it('is on when visiting someone, or scrolled away from your own beach', () => {
    expect(isViewingMode(true, true)).toBe(true); // visiting
    expect(isViewingMode(true, false)).toBe(true);
    expect(isViewingMode(false, false)).toBe(true); // scrolled down the shore
    expect(isViewingMode(false, true)).toBe(false); // at home
  });
});

describe('beaches in view rows', () => {
  it('lists the beaches top to bottom in their left-to-right order on screen', () => {
    expect(orderInfoRows([{ index: 2, x: 900 }, { index: -1, x: 100 }, { index: 1, x: 500 }])).toEqual([-1, 1, 2]);
    // turned around (reverse isometric): screen order wins over shore order
    expect(orderInfoRows([{ index: 1, x: 80 }, { index: -1, x: 700 }])).toEqual([1, -1]);
  });

  it('does not reorder the input', () => {
    const rows = [{ index: 2, x: 3 }, { index: -1, x: 1 }];
    expect(orderInfoRows(rows)).toEqual([-1, 2]);
    expect(rows.map((r) => r.index)).toEqual([2, -1]);
  });

  it('handles a single beach and an empty shore', () => {
    expect(orderInfoRows([{ index: 0, x: 10 }])).toEqual([0]);
    expect(orderInfoRows([])).toEqual([]);
  });
});
