// Inland beach sections (docs/INLAND_SECTIONS.md): the catalog mirrors, the
// joins, the editor's counts, and each type's geometry.
import { describe, expect, it } from 'vitest';
import { GRID_TIERS, PROFILE, SECTION, WORLD_SIZE_X } from '../src/config';
import type { PlacedObject } from '../src/sim/objects';
import { fitDepth, resampleWidth } from '../src/sim/sandCodec';
import { colorOf, sectionGeometry } from '../src/render/sections';
import { restHeight } from '../src/sim/profile';
import { freeFor, replaceRow } from '../src/ui/sectionsEditor';
import { EXTRAS } from '../src/world/items';
import { SECTIONS, SECTIONS_ON_SALE, SECTION_BUCKS, SECTION_ROWS, gridWithSand, sandRowsInGrid, sandRowsOf, sectionJoins } from '../src/world/sections';
import { SECTIONS as SERVER_SECTIONS, SECTIONS_ON_SALE as SERVER_ON_SALE, SECTION_BUCKS as SERVER_BUCKS, SECTION_ROWS as SERVER_ROWS } from '../server/src/sections';
import { PRODUCTS } from '../server/src/products';
import { PRIZE_NAMES } from '../server/src/prizeNames';

describe('the section catalog', () => {
  it('matches the server: types, names, products and the row limit', () => {
    expect(SECTION_ROWS).toBe(SERVER_ROWS);
    expect([...SECTIONS_ON_SALE]).toEqual([...SERVER_ON_SALE]);
    expect(SECTION_BUCKS).toBe(SERVER_BUCKS);
    expect(SECTIONS.map((s) => [s.id, s.name])).toEqual(SERVER_SECTIONS.map((s) => [s.id, s.name]));
    for (const s of SECTIONS) {
      const p = PRODUCTS.find((x) => x.id === s.product);
      // only the types on sale are for sale (the others are hidden for now)
      expect(p, s.id).toBeTruthy();
      expect(p!.grants).toEqual([{ item: s.id, quantity: 1 }]);
      expect(p!.bucksOnly).toBe(true);
      expect(!!p!.offSale).toBe(!SECTIONS_ON_SALE.includes(s.id));
      if (!p!.offSale) expect(p!.bucks).toBe(SECTION_BUCKS);
      expect(PRIZE_NAMES[s.id]).toBe(s.name);
      expect(EXTRAS.find((e) => e.id === s.id)?.name).toBe(s.name);
    }
  });
});

describe('joins', () => {
  it('an edge joins only the same type in the same row on a linked side', () => {
    const rows = ['section-boardwalk', 'section-road', 'section-path'];
    expect(sectionJoins(rows, ['section-boardwalk', 'section-path'], null)).toEqual([
      { type: 'section-boardwalk', neg: true, pos: false },
      { type: 'section-road', neg: false, pos: false },
      { type: 'section-path', neg: false, pos: false },
    ]);
    // a gap in the neighbor's rows doesn't join (row 3 is empty there)
    expect(sectionJoins(['section-sand', 'section-sand'], null, ['section-sand'])).toEqual([
      { type: 'section-sand', neg: false, pos: true },
      { type: 'section-sand', neg: false, pos: false },
    ]);
  });
});

describe('the editor counts', () => {
  const counts = { owned: { 'section-sand': 2 }, placed: { 'section-sand': 2 } };
  it('rows saved on this beach come back when taken off, rows in the draft are used', () => {
    expect(freeFor('section-sand', counts, [], [])).toBe(0); // both on other beaches
    expect(freeFor('section-sand', counts, ['section-sand'], [])).toBe(1);
    expect(freeFor('section-sand', counts, ['section-sand'], ['section-sand'])).toBe(0);
    expect(freeFor('section-road', counts, [], [])).toBe(0);
  });
});

describe('section geometry', () => {
  const H = WORLD_SIZE_X / 2;
  const bounds = (type: string, neg: boolean, pos: boolean) => {
    const parts = sectionGeometry(type, neg, pos);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = -Infinity;
    for (const g of parts.values()) {
      for (let i = 0; i < g.P.length; i += 3) {
        x0 = Math.min(x0, g.P[i]); x1 = Math.max(x1, g.P[i]);
        y1 = Math.max(y1, g.P[i + 1]);
        z0 = Math.min(z0, g.P[i + 2]); z1 = Math.max(z1, g.P[i + 2]);
      }
      expect(g.I.length % 3).toBe(0);
      expect(Math.max(...g.I)).toBeLessThan(g.P.length / 3);
    }
    return { x0, x1, z0, z1, y1, parts };
  };

  it('the ground meets the back of the beach', () => {
    expect(SECTION.ground).toBe(PROFILE.backHeight);
    expect(Math.abs(restHeight(16, 32) - SECTION.ground)).toBeLessThan(0.1);
  });

  for (const s of SECTIONS) {
    it(`${s.id} stays inside its row, every edge, every colour known`, () => {
      for (const [neg, pos] of [[false, false], [true, true], [true, false]]) {
        const b = bounds(s.id, neg, pos);
        expect(b.x0).toBeGreaterThanOrEqual(-H - 1e-6);
        expect(b.x1).toBeLessThanOrEqual(H + 1e-6);
        expect(b.z0).toBeGreaterThanOrEqual(-1e-6);
        expect(b.z1).toBeLessThanOrEqual(SECTION.depth + 1e-6);
        expect(b.y1).toBeLessThan(SECTION.ground + 7);
        for (const k of b.parts.keys()) expect(colorOf(k), k).toHaveLength(3);
      }
    });

    it(`${s.id} draws something different at a finished edge than a joined one`, () => {
      const open = bounds(s.id, true, true);
      const closed = bounds(s.id, false, false);
      const verts = (p: typeof open.parts) => [...p.values()].reduce((n, g) => n + g.P.length, 0);
      expect(verts(closed.parts)).not.toBe(verts(open.parts));
    });
  }

  it('is the same every time (seeded), so a row never flickers on a rebuild', () => {
    const a = sectionGeometry('section-dunes', false, true, 2);
    const b = sectionGeometry('section-dunes', false, true, 2);
    expect([...a.values()].map((g) => g.P)).toEqual([...b.values()].map((g) => g.P));
  });
});

describe('sand rows inland are part of the beach', () => {
  it('counts only the sand rows straight behind the beach', () => {
    expect(sandRowsOf([])).toBe(0);
    expect(sandRowsOf(['section-sand', 'section-sand', 'section-road'])).toBe(2);
    expect(sandRowsOf(['section-road', 'section-sand'])).toBe(0);
  });

  it('makes each tier’s grid deeper by whole rows', () => {
    for (const g of Object.values(GRID_TIERS)) {
      const d = gridWithSand(g, 3);
      expect(d.nx).toBe(g.nx);
      expect(d.ny * d.dx).toBeCloseTo(32 + 3 * SECTION.depth, 6);
      expect(sandRowsInGrid(d.ny, g.ny, g.dx)).toBe(3);
    }
  });

  it('fits a saved beach to its rows: untouched sand added, or the rows cut with what was on them', () => {
    const g = GRID_TIERS.low;
    const deep = gridWithSand(g, 2);
    const delta = new Float32Array(deep.nx * deep.ny).fill(0.1);
    const objects = [
      { id: 1, kind: 'flag', item: 'flag', x: 5, y: 10, angle: 0, size: 0.4, variant: 0 },
      { id: 2, kind: 'flag', item: 'flag', x: 5, y: 40, angle: 0, size: 0.4, variant: 0 },
    ] as PlacedObject[];
    const cut = fitDepth({ nx: deep.nx, ny: deep.ny, delta, objects }, gridWithSand(g, 0).ny);
    expect(cut.delta.length).toBe(g.nx * g.ny);
    expect(cut.objects.map((o) => o.id)).toEqual([1]);
    const grown = fitDepth(cut, deep.ny);
    expect(grown.delta.length).toBe(deep.nx * deep.ny);
    expect(grown.delta[g.nx * g.ny - 1]).toBeCloseTo(0.1);
    expect(grown.delta[g.nx * g.ny]).toBe(0);
    // another device's grid: as deep, in metres
    const wide = resampleWidth({ nx: deep.nx, ny: deep.ny, delta, objects }, GRID_TIERS.high.nx);
    expect(wide.ny).toBe(gridWithSand(GRID_TIERS.high, 2).ny);
  });
});

describe('replacing a row in place', () => {
  it('swaps one row and keeps the rest in order; the displaced copy is free again', () => {
    const draft = ['section-sand', 'section-boardwalk', 'section-road'];
    const next = replaceRow(draft, 1, 'section-playground');
    expect(next).toEqual(['section-sand', 'section-playground', 'section-road']);
    expect(draft[1]).toBe('section-boardwalk'); // not changed in place
    expect(replaceRow(draft, 5, 'section-playground')).toEqual(draft);
    const counts = { owned: { 'section-boardwalk': 1, 'section-playground': 1 }, placed: { 'section-boardwalk': 1 } };
    // the boardwalk comes back to the bag once the draft no longer holds it
    expect(freeFor('section-boardwalk', counts, draft, next)).toBe(1);
    expect(freeFor('section-playground', counts, draft, next)).toBe(0);
  });
});
