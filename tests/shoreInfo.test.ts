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

describe('info card rows', () => {
  it('lists the beach under the view first, then outward', () => {
    // focus on beach 0, neighbours either side
    expect(orderInfoRows([2, -1, 1, -2], 0)).toEqual([-1, 1, -2, 2]);
    // focus on beach -2 (scrolled right): -2, then -1 and -3, then 0
    expect(orderInfoRows([0, -1, -3, 2], -2)).toEqual([-3, -1, 0, 2]);
  });

  it('does not reorder the input', () => {
    const indices = [2, -1, 1];
    expect(orderInfoRows(indices, 0)).toEqual([-1, 1, 2]);
    expect(indices).toEqual([2, -1, 1]);
  });

  it('handles a single beach and an empty shore', () => {
    expect(orderInfoRows([0], 0)).toEqual([0]);
    expect(orderInfoRows([], 0)).toEqual([]);
  });
});
