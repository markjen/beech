// Inland beach sections (docs/INLAND_SECTIONS.md): rows of scenery behind a
// beach, each a bag item bought with beech bucks. Mirrors server/src/sections.ts
// (tests/sections.test.ts keeps them in step).

import { SECTION } from '../config';

export const SECTION_ROWS = 4;

export type SectionId =
  | 'section-sand'
  | 'section-boardwalk'
  | 'section-path'
  | 'section-playground'
  | 'section-road'
  | 'section-shops'
  | 'section-dunes'
  | 'section-picnic';

export interface SectionType {
  id: SectionId;
  name: string;
  /** the shop product that sells one */
  product: string;
}

export const SECTIONS: SectionType[] = (
  [
    ['section-sand', 'Sand extension'],
    ['section-boardwalk', 'Boardwalk'],
    ['section-path', 'Bike, run and skate path'],
    ['section-playground', 'Playground'],
    ['section-road', 'Coastal road'],
    ['section-shops', 'Storefronts'],
    ['section-dunes', 'Dune garden'],
    ['section-picnic', 'Picnic grove'],
  ] as const
).map(([id, name]) => ({ id, name, product: `item_${id.replace('-', '_')}` }));

/** the types the shop sells for now (server/src/sections.ts SECTIONS_ON_SALE); the others show only if you have one */
export const SECTIONS_ON_SALE: readonly SectionId[] = ['section-sand'];
/** beech bucks each (server/src/sections.ts SECTION_BUCKS) */
export const SECTION_BUCKS = 50;

export const isSection = (id: string): id is SectionId => SECTIONS.some((s) => s.id === id);
export const sectionById = (id: string): SectionType | undefined => SECTIONS.find((s) => s.id === id);

/**
 * Which edges of each row join the neighbor's (docs/INLAND_SECTIONS.md):
 * an edge joins when the beach on that side is directly linked and has the
 * same section type in the same row. Otherwise the row ends in its
 * finished edge. `neg` is the side towards -x, `pos` towards +x.
 */
export function sectionJoins(
  rows: readonly string[],
  neg: readonly string[] | null,
  pos: readonly string[] | null,
): { type: string; neg: boolean; pos: boolean }[] {
  return rows.map((type, i) => ({ type, neg: neg?.[i] === type, pos: pos?.[i] === type }));
}

/**
 * Sand extensions straight behind the beach are part of the beach itself:
 * its grid runs this many rows (of SECTION.depth) further inland, so they
 * look and work like the rest of the sand (dig, sculpt, molds, things from
 * the bag). A sand extension behind another type of row is scenery.
 */
export function sandRowsOf(rows: readonly string[] | null | undefined): number {
  let k = 0;
  while (rows && k < rows.length && rows[k] === 'section-sand') k++;
  return k;
}

/** grid cells in one section row's depth, on a grid with cells `dx` wide */
export const rowCells = (dx: number): number => Math.round(SECTION.depth / dx);

/** the beach's grid with `k` sand rows behind it (`base` is the 32 m square beach) */
export function gridWithSand<G extends { nx: number; ny: number; dx: number }>(base: G, k: number): G {
  return { ...base, ny: base.ny + k * rowCells(base.dx) };
}

/** how many sand rows a grid `ny` deep holds, on a beach whose square grid is `baseNy` */
export function sandRowsInGrid(ny: number, baseNy: number, dx: number): number {
  return Math.max(0, Math.round((ny - baseNy) / rowCells(dx)));
}
