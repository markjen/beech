// The pets you can befriend or buy (docs/PETS.md). Same table as the
// server's server/src/petCatalog.ts (server/test/stateMachines/pets.test.ts
// keeps them in step), plus how each one looks and moves on the beach.

export type PetSpecies = 'crab' | 'sandpiper' | 'octopus' | 'seal' | 'turtle' | 'dolphin';
export type Habitat = 'land' | 'sea' | 'both';

export interface PetKind {
  species: PetSpecies;
  name: string;
  habitat: Habitat;
  /** shop price in beech bucks */
  bucks: number;
  /** snacks (1 buck each) to befriend a wild one: a quarter of the price */
  feeds: number;
  /** the bag item a shop purchase grants */
  item: string;
  /** chance weight among wild visitors that can reach the spot */
  wildWeight: number;
  /** body size (m): drawn larger than life so it reads from the diorama view */
  size: number;
  /** walking / crawling speed on sand (m/s) */
  landSpeed: number;
  /** swimming speed (m/s) */
  swimSpeed: number;
  /** height of the body's top above its origin, per metre of size (keeps sea pets' backs above the water) */
  top: number;
}

export const PETS: PetKind[] = [
  { species: 'crab', name: 'Sand crab', habitat: 'land', bucks: 20, feeds: 5, item: 'pet-crab', wildWeight: 40, size: 0.8, landSpeed: 1.2, swimSpeed: 0, top: 0.45 },
  { species: 'sandpiper', name: 'Sandpiper', habitat: 'land', bucks: 28, feeds: 7, item: 'pet-sandpiper', wildWeight: 30, size: 0.75, landSpeed: 2.2, swimSpeed: 0, top: 0.9 },
  { species: 'octopus', name: 'Octopus', habitat: 'sea', bucks: 40, feeds: 10, item: 'pet-octopus', wildWeight: 20, size: 0.9, landSpeed: 0, swimSpeed: 0.7, top: 0.55 },
  { species: 'seal', name: 'Harbor seal', habitat: 'both', bucks: 48, feeds: 12, item: 'pet-seal', wildWeight: 16, size: 1.8, landSpeed: 0.55, swimSpeed: 1.8, top: 0.32 },
  { species: 'turtle', name: 'Sea turtle', habitat: 'both', bucks: 60, feeds: 15, item: 'pet-turtle', wildWeight: 12, size: 1.3, landSpeed: 0.4, swimSpeed: 1.1, top: 0.3 },
  { species: 'dolphin', name: 'Dolphin', habitat: 'sea', bucks: 80, feeds: 20, item: 'pet-dolphin', wildWeight: 12, size: 2.2, landSpeed: 0, swimSpeed: 2.4, top: 0.28 },
];

export const petKind = (species: string): PetKind => PETS.find((p) => p.species === species) ?? PETS[0];
export const isPetSpecies = (s: unknown): s is PetSpecies => typeof s === 'string' && PETS.some((p) => p.species === s);
export const petByItem = (item: string): PetKind | undefined => PETS.find((p) => p.item === item);
export const canLand = (s: PetSpecies): boolean => petKind(s).habitat !== 'sea';
export const canSwim = (s: PetSpecies): boolean => petKind(s).habitat !== 'land';

/** A wild species to answer a snack (or an unbaited roll) at a spot that's wet or dry. */
export function pickWildSpecies(rand: () => number, inWater: boolean | null): PetSpecies {
  const pool = PETS.filter((p) => (inWater === null ? true : inWater ? p.habitat !== 'land' : p.habitat !== 'sea'));
  const total = pool.reduce((a, p) => a + p.wildWeight, 0);
  let r = rand() * total;
  for (const p of pool) {
    r -= p.wildWeight;
    if (r < 0) return p.species;
  }
  return pool[pool.length - 1].species;
}
