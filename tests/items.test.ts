import { describe, expect, it } from 'vitest';
import { POOLS } from '../server/src/pulls';
import { ITEMS, itemById } from '../src/world/items';
import { OBJECT_KINDS } from '../src/sim/objects';

describe('item catalog', () => {
  it('every prize in a pull pool is a catalog item of the same rarity, won by pulling', () => {
    for (const pool of Object.values(POOLS)) {
      for (const [rarity, ids] of Object.entries(pool.items)) {
        for (const id of ids) {
          const it = itemById(id);
          expect(it, id).toBeTruthy();
          expect(it!.rarity).toBe(rarity);
          expect(it!.source).toBe('pull');
        }
      }
      expect(Object.values(pool.odds).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
  });

  it('ids are unique, kinds exist, free items are unlimited', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    for (const it of ITEMS) {
      expect(OBJECT_KINDS).toContain(it.kind);
      if (it.source === 'free') expect(it.unlimited).toBe(true);
      expect(it.size[0]).toBeGreaterThanOrEqual(0.05);
    }
  });
});
