// Inland beach sections (docs/INLAND_SECTIONS.md, specs/tla/InlandSections.tla):
// the catalog the server checks layouts against. Each type is a bag item,
// bought with beech bucks, placed in a row behind a beach. Mirrored by
// src/world/sections.ts (tests/sections.test.ts keeps them in step).

export const SECTION_ROWS = 4;

export const SECTIONS = [
  { id: 'section-sand', name: 'Sand extension', blurb: 'More dry sand behind your beach' },
  { id: 'section-boardwalk', name: 'Boardwalk', blurb: 'Timber planks and rails along the back of the beach' },
  { id: 'section-path', name: 'Bike, run and skate path', blurb: 'A paved path with lane markings' },
  { id: 'section-playground', name: 'Playground', blurb: 'Swings, a slide and a fenced play surface' },
  { id: 'section-road', name: 'Coastal road', blurb: 'Two lanes, curbs and sidewalks' },
  { id: 'section-shops', name: 'Storefronts', blurb: 'A row of little shops with awnings' },
  { id: 'section-dunes', name: 'Dune garden', blurb: 'Grasses, a sandy trail and split-rail fencing' },
  { id: 'section-picnic', name: 'Picnic grove', blurb: 'Shade trees, tables and a gravel walk' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];
export const SECTION_IDS: readonly string[] = SECTIONS.map((s) => s.id);
export const isSection = (id: string): id is SectionId => SECTION_IDS.includes(id);
/** beech bucks each */
export const SECTION_BUCKS = 50;
/** what every type cost before 2026-11-27: the off-sale types keep it as their list (trade-in) value */
export const SECTION_BUCKS_BEFORE = 15;
/** the types the shop sells for now: the others are hidden (existing ones stay placeable) */
export const SECTIONS_ON_SALE: readonly string[] = ['section-sand'];
