import { describe, expect, it } from 'vitest';
import { fold, groupByRegion, searchPlaces } from '../src/ui/placePicker';
import { BEACHES, REGIONS } from '../src/world/locations';

describe('place picker', () => {
  it('folds accents and case', () => {
    expect(fold('Viña del Mar')).toBe('vina del mar');
    expect(fold('Waikīkī')).toBe('waikiki');
  });

  it('finds places by name, town or region, every word', () => {
    expect(searchPlaces(BEACHES, '').length).toBe(BEACHES.length);
    expect(searchPlaces(BEACHES, 'waikiki').map((b) => b.id)).toEqual(['waikiki']);
    expect(searchPlaces(BEACHES, 'sydney').map((b) => b.id)).toEqual(['bondi']);
    expect(searchPlaces(BEACHES, 'vina').map((b) => b.id)).toEqual(['vinadelmar']);
    expect(searchPlaces(BEACHES, 'europe').length).toBeGreaterThan(5);
    expect(searchPlaces(BEACHES, 'europe algarve').map((b) => b.id)).toEqual(['marinha']);
    expect(searchPlaces(BEACHES, 'zzz')).toEqual([]);
  });

  it('groups every place once, by region, west to east', () => {
    const groups = groupByRegion(BEACHES);
    expect(groups.flatMap((g) => g.beaches).length).toBe(BEACHES.length);
    expect(groups.map((g) => g.region)).toEqual(REGIONS.filter((r) => BEACHES.some((b) => b.region === r)));
    for (const g of groups) {
      for (let i = 1; i < g.beaches.length; i++) expect(g.beaches[i].lon).toBeGreaterThanOrEqual(g.beaches[i - 1].lon);
    }
  });
});
