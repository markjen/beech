import { describe, expect, it } from 'vitest';
import { beachMapPoints, continentsPath, CONTINENTS, MAP_HEIGHT, MAP_WIDTH, project, sortBeachesWestToEast } from '../src/ui/beachMap';
import { BEACHES } from '../src/world/locations';

const at = (id: string) => ({ location: id });

describe('sortBeachesWestToEast', () => {
  it('orders beaches by the longitude of their real place', () => {
    const shuffled = [
      'piha', 'bondi', 'kamakura', 'kuta', 'patong', 'campsbay', 'nice',
      'brighton', 'biarritz', 'copacabana', 'southbeach', 'santamonica', 'waikiki',
    ].map(at);
    expect(sortBeachesWestToEast(shuffled).map((b) => b.location)).toEqual([
      'waikiki', 'santamonica', 'southbeach', 'copacabana', 'biarritz', 'brighton',
      'nice', 'campsbay', 'patong', 'kuta', 'kamakura', 'bondi', 'piha',
    ]);
  });

  it('puts beaches with no place, or an unknown place, last in their own order', () => {
    const beaches = [
      { location: 'bondi' },
      { location: null },
      { location: 'waikiki' },
      { location: 'nowhere' },
      { location: null },
    ];
    expect(sortBeachesWestToEast(beaches).map((b) => b.location)).toEqual([
      'waikiki', 'bondi', null, 'nowhere', null,
    ]);
  });

  it('does not mutate the input', () => {
    const beaches = [at('bondi'), at('waikiki')];
    sortBeachesWestToEast(beaches);
    expect(beaches.map((b) => b.location)).toEqual(['bondi', 'waikiki']);
  });
});

describe('project', () => {
  it('maps the corners of the shown world to the corners of the box', () => {
    expect(project(-180, 84)).toEqual({ x: 0, y: 0 });
    expect(project(180, -60)).toEqual({ x: MAP_WIDTH, y: MAP_HEIGHT });
    expect(project(0, 12)).toEqual({ x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 });
  });

  it('runs west to east and north up', () => {
    const a = project(-157.8278, 21.2766); // Waikiki
    const b = project(151.2767, -33.8915); // Bondi
    expect(a.x).toBeLessThan(b.x);
    expect(a.y).toBeLessThan(b.y);
  });

  it('keeps every real beach inside the box', () => {
    for (const b of BEACHES) {
      const { x, y } = project(b.lon, b.lat);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(MAP_WIDTH);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(MAP_HEIGHT);
    }
  });

  it('clamps out-of-range coordinates into the box', () => {
    expect(project(-200, 100)).toEqual({ x: 0, y: 0 });
    expect(project(200, -100)).toEqual({ x: MAP_WIDTH, y: MAP_HEIGHT });
  });
});

describe('beachMapPoints', () => {
  it('places located beaches and reports unlocated ones instead of dropping them', () => {
    const { placed, unplaced } = beachMapPoints([
      { location: 'santamonica' },
      { location: null },
      { location: 'waikiki' },
    ]);
    expect(placed.map((p) => p.place.id)).toEqual(['waikiki', 'santamonica']);
    expect(unplaced).toHaveLength(1);
    for (const p of placed) {
      expect(p.x).toBe(p.dx);
      expect(p.y).toBe(p.dy);
    }
  });

  it('nudges apart two beaches at the same place so each stays tappable', () => {
    const { placed } = beachMapPoints([{ location: 'santamonica' }, { location: 'santamonica' }]);
    expect(placed).toHaveLength(2);
    expect(placed[0].x).toBe(placed[1].x);
    expect(placed[0].y).toBe(placed[1].y);
    expect(placed[1].dx).toBeGreaterThan(placed[0].dx);
    expect(placed[1].dx).toBeLessThanOrEqual(MAP_WIDTH - 6);
  });

  it('returns an empty map for no beaches', () => {
    expect(beachMapPoints([])).toEqual({ placed: [], unplaced: [] });
  });
});

describe('continents', () => {
  it('covers recognizable land with in-range coordinates', () => {
    expect(CONTINENTS.length).toBeGreaterThanOrEqual(8);
    for (const poly of CONTINENTS) {
      expect(poly.length).toBeGreaterThanOrEqual(4);
      for (const [lon, lat] of poly) {
        expect(lon).toBeGreaterThanOrEqual(-180);
        expect(lon).toBeLessThanOrEqual(180);
        expect(lat).toBeGreaterThanOrEqual(-60);
        expect(lat).toBeLessThanOrEqual(84);
      }
    }
  });

  it('renders as one closed path per continent', () => {
    const d = continentsPath();
    expect(d).toMatch(/^M[0-9]/);
    expect(d.split(' Z').length - 1).toBe(CONTINENTS.length);
  });
});
