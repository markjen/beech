import { describe, expect, it } from 'vitest';

import type { MyBeach } from '../src/net/account';
import { buildOwnStretches, connectableBeaches, hasSparePierWithoutSite, ownBeachLabel } from '../src/ui/shoreConnect';

function makeBeach(
  id: string,
  code: string,
  name: string,
  opts: Partial<Pick<MyBeach, 'home' | 'left' | 'right' | 'pierSite'>> = {},
): MyBeach {
  return {
    id,
    code,
    name,
    home: opts.home ?? false,
    onShore: true,
    location: 'santa-monica',
    updatedAt: 1,
    items: {},
    left: opts.left ?? null,
    right: opts.right ?? null,
    pierSite: opts.pierSite,
  };
}

describe('shoreConnect', () => {
  it('groups connected own beaches left-to-right and leaves unlinked beaches separate', () => {
    // A <-> B (A is on B's left, B is on A's right), C is separate
    const a = makeBeach('a', 'AAA111', 'Home', {
      home: true,
      right: { code: 'BBB222', name: 'Bondi', location: 'bondi', updatedAt: 1, yours: true },
    });
    const b = makeBeach('b', 'BBB222', 'Bondi', {
      left: { code: 'AAA111', name: 'Home', location: 'santa-monica', updatedAt: 1, yours: true },
    });
    const c = makeBeach('c', 'CCC333', 'Brighton');

    const stretches = buildOwnStretches([b, c, a]);
    expect(stretches.map((s) => s.map((x) => x.id))).toEqual([['c'], ['a', 'b']]);
  });

  it('ignores non-owned neighbors when building own stretches', () => {
    const a = makeBeach('a', 'AAA111', 'Home', {
      home: true,
      left: { code: 'FRD999', name: 'Friend', location: 'bondi', updatedAt: 1, yours: false },
    });
    const b = makeBeach('b', 'BBB222', 'Bondi');
    const stretches = buildOwnStretches([a, b]);
    expect(stretches.map((s) => s.map((x) => x.id))).toEqual([['a'], ['b']]);
  });

  it('finds connectable beaches respecting free sides and avoiding same-stretch loops', () => {
    const a = makeBeach('a', 'AAA111', 'Home', {
      home: true,
      right: { code: 'BBB222', name: 'Bondi', location: 'bondi', updatedAt: 1, yours: true },
    });
    const b = makeBeach('b', 'BBB222', 'Bondi', {
      left: { code: 'AAA111', name: 'Home', location: 'santa-monica', updatedAt: 1, yours: true },
    });
    const c = makeBeach('c', 'CCC333', 'Brighton');
    const d = makeBeach('d', 'DDD444', 'TakenRight', {
      right: { code: 'FRD999', name: 'Friend', location: 'bondi', updatedAt: 1, yours: false },
    });

    // A's left is free: C can join on A's left (C's right is free), B is in same stretch (excluded), D's right is taken (excluded)
    expect(connectableBeaches([a, b, c, d], 'a', 'left').map((x) => x.id)).toEqual(['c']);
    // A's right is already taken by B
    expect(connectableBeaches([a, b, c, d], 'a', 'right')).toEqual([]);
    // B's right is free: both C and D have free left sides
    expect(connectableBeaches([a, b, c, d], 'b', 'right').map((x) => x.id)).toEqual(['c', 'd']);
  });

  it('formats labels with sensible fallbacks', () => {
    expect(ownBeachLabel({ name: 'Bondi', home: false })).toBe('Bondi');
    expect(ownBeachLabel({ name: '', home: true })).toBe('Home');
    expect(ownBeachLabel({ name: '', home: false })).toBe('A beach');
  });

  it('flags a spare pier with no site (two unlinked beaches, one pier in the bag)', () => {
    // The reported bug: two beaches can never form a trio, so a bought pier
    // has nowhere to go and the panel has to say so.
    const a = makeBeach('a', 'AAA111', 'Home', { home: true });
    const b = makeBeach('b', 'BBB222', 'Bondi');
    expect(hasSparePierWithoutSite([a, b], { owned: 1, placed: 0 })).toBe(true);
  });

  it('does not flag a spare pier when a beach already qualifies as a site', () => {
    const a = makeBeach('a', 'AAA111', 'Home', { home: true });
    const b = makeBeach('b', 'BBB222', 'Bondi', { pierSite: true });
    expect(hasSparePierWithoutSite([a, b], { owned: 1, placed: 0 })).toBe(false);
  });

  it('does not flag when no pier is spare', () => {
    const a = makeBeach('a', 'AAA111', 'Home', { home: true });
    const b = makeBeach('b', 'BBB222', 'Bondi');
    expect(hasSparePierWithoutSite([a, b], { owned: 0, placed: 0 })).toBe(false);
    expect(hasSparePierWithoutSite([a, b], { owned: 1, placed: 1 })).toBe(false);
  });
});
