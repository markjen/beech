import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { POOLS, STARTER } from '../server/src/pulls';
import { VENDING_SETS, currentSet } from '../server/src/vending';
import { PRODUCTS } from '../server/src/products';
import { PRIZE_NAMES } from '../server/src/prizeNames';
import { RELEASE_NOTES } from '../server/src/releaseNotes';
import { ITEMS, extraById, itemById, rollPlacement } from '../src/world/items';
import { OBJECT_KINDS } from '../src/sim/objects';

describe('vending sets', () => {
  it('every item in every set is a catalog item of the same rarity, won by pulling', () => {
    for (const set of VENDING_SETS) {
      expect(Object.values(set.odds).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      for (const [rarity, ids] of Object.entries(set.items)) {
        for (const id of ids) {
          const it = itemById(id);
          expect(it, `${set.name} week ${set.week}: ${id}`).toBeTruthy();
          expect(it!.rarity).toBe(rarity);
          expect(it!.source).toBe('pull');
        }
      }
    }
  });

  it('the set live right now is one of the shipped sets', () => {
    const now = currentSet(Date.now());
    expect(now).toBeTruthy();
    expect(VENDING_SETS).toContain(now);
  });

  it('a set’s unique item is the only one of its kind in the set', () => {
    for (const set of VENDING_SETS) expect(set.items.unique.length).toBe(1);
  });
});

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
    expect(itemById(STARTER.paid.item)?.product).toBeTruthy();
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

  it('the golden sand dollar is giant: starts at twice the largest regular sand dollar and scales up', () => {
    const regular = itemById('sanddollar')!;
    const golden = itemById('gold-sanddollar')!;
    const fixed = () => 0.5;
    expect(golden.size[0]).toBeCloseTo(regular.size[1] * 2, 6);
    expect(golden.size[1]).toBeGreaterThan(golden.size[0]);
    expect(rollPlacement(golden, 0, fixed).size).toBeCloseTo(regular.size[1] * 2, 6);
    expect(rollPlacement(golden, 1, fixed).size).toBeCloseTo(golden.size[1], 6);
  });

  it('the shop and the catalog agree: every product grants real things, every shop item is sold', () => {
    for (const p of PRODUCTS) {
      expect(p.id).toMatch(/^[a-z0-9_.]+$/); // a valid Google Play / App Store product id
      for (const g of p.grants) expect(itemById(g.item) ?? extraById(g.item), `${p.id} grants ${g.item}`).toBeTruthy();
    }
    for (const it of ITEMS.filter((i) => i.source === 'shop')) {
      expect(PRODUCTS.find((p) => p.id === it.product), `${it.id} is sold by ${it.product}`).toBeTruthy();
    }
  });

  it('every catalog item has a render, and a copy served by the shore', () => {
    for (const it of ITEMS) {
      expect(fs.existsSync(`docs/items/renders/${it.id}.png`), it.id).toBe(true);
      expect(fs.existsSync(`public/items/${it.id}.png`), it.id).toBe(true);
    }
  });
});

describe('the guide on the website', () => {
  it('names every prize the machines can give as the catalog does', () => {
    const ids = new Set<string>();
    for (const p of Object.values(POOLS)) for (const list of Object.values(p.items)) list.forEach((id) => ids.add(id));
    for (const set of VENDING_SETS) for (const list of Object.values(set.items)) list.forEach((id) => ids.add(id));
    for (const id of ids) expect(PRIZE_NAMES[id], id).toBe(itemById(id)?.name);
  });

  it('release notes are dated, newest first', () => {
    const dates = RELEASE_NOTES.map((r) => r.date);
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const r of RELEASE_NOTES) expect(r.changes.length).toBeGreaterThan(0);
  });
});
