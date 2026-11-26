// Inland beach sections (docs/INLAND_SECTIONS.md): rows of scenery behind a
// beach, each a bag item bought with beech bucks. Mirrors server/src/sections.ts
// (tests/sections.test.ts keeps them in step).

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
