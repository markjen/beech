import { describe, expect, it } from 'vitest';
import { POOLS, STARTER } from '../server/src/pulls';
import { ITEMS, extraById, itemById, rollPlacement } from '../src/world/items';
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

  it('the starter gifts exist: a rare item, a shop item, and an extra beach', () => {
    expect(itemById(STARTER.rare.item)?.rarity).toBe('rare');
    expect(itemById(STARTER.paid.item)?.source).toBe('shop');
    expect(itemById(STARTER.paid.item)?.price).toBeGreaterThan(0);
    expect(extraById(STARTER.beach.item)).toBeTruthy();
    expect(itemById(STARTER.beach.item)).toBeUndefined(); // not something you put on the sand
  });

  it('ids are unique, kinds exist, free items are unlimited', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    for (const it of ITEMS) {
      expect(OBJECT_KINDS).toContain(it.kind);
      if (it.source === 'free') expect(it.unlimited).toBe(true);
      expect(it.size[0]).toBeGreaterThanOrEqual(0.05);
    }
  });

  it('the size slider spans the item range, smallest to largest, with a little variation', () => {
    const rock = itemById('rock')!;
    const fixed = () => 0.5;
    expect(rollPlacement(rock, 0, fixed).size).toBeCloseTo(rock.size[0], 6);
    expect(rollPlacement(rock, 1, fixed).size).toBeCloseTo(rock.size[1], 6);
    const mid = rollPlacement(rock, 0.5, fixed).size;
    expect(mid).toBeCloseTo(Math.sqrt(rock.size[0] * rock.size[1]), 6);
    for (let i = 0; i < 200; i++) {
      const s = rollPlacement(rock, Math.random()).size;
      expect(s).toBeGreaterThanOrEqual(rock.size[0]);
      expect(s).toBeLessThanOrEqual(rock.size[1]);
    }
    // a bigger pick is bigger, despite the variation
    expect(rollPlacement(rock, 0.8, () => 0).size).toBeGreaterThan(rollPlacement(rock, 0.6, () => 0.999).size);
  });
});
