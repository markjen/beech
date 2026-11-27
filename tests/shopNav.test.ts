import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '../server/src/products';
import { offerCategory } from '../src/ui/shop';

describe('shop offer categorization', () => {
  it('places every built-in product in the expected category', () => {
    const byId = new Map(PRODUCTS.map((p) => [p.id, offerCategory({ grants: p.grants, featured: !!p.featured })]));

    expect(byId.get('pack_founder')).toBe('featured');
    expect(byId.get('beach_1')).toBe('beaches');
    expect(byId.get('beach_3')).toBe('beaches');
    expect(byId.get('item_pier')).toBe('beaches');
    expect(byId.get('item_section_sand')).toBe('beaches');

    expect(byId.get('food_pack_10')).toBe('pets');
    expect(byId.get('food_pack_35')).toBe('pets');
    expect(byId.get('pet_crab')).toBe('pets');
    expect(byId.get('pet_dolphin')).toBe('pets');

    expect(byId.get('item_lighthouse')).toBe('items');
    expect(byId.get('item_parasol')).toBe('items');
    expect(byId.get('item_palmtree')).toBe('items');
  });

  it('defaults custom or creator items to items, and multi-item bundles to featured', () => {
    expect(offerCategory({ grants: [{ item: 'creator-shell', quantity: 1 }], featured: false })).toBe('items');
    expect(
      offerCategory({
        grants: [
          { item: 'beach', quantity: 1 },
          { item: 'parasol', quantity: 1 },
        ],
        featured: false,
      }),
    ).toBe('featured');
  });
});
