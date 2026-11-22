import { describe, expect, it } from 'vitest';
import { tierFromBench } from '../src/platform/quality';

describe('quality tier', () => {
  it('maps benchmark time to a tier', () => {
    expect(tierFromBench(1.0, false)).toBe('high');
    expect(tierFromBench(1.0, true)).toBe('medium');
    expect(tierFromBench(3.0, true)).toBe('medium');
    expect(tierFromBench(8.0, false)).toBe('low');
  });
});
