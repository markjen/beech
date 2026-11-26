// The pets you can befriend or buy (docs/PETS.md). One table, so the shop,
// befriending and the bag all agree. The app keeps the same table in
// src/world/pets.ts; server/test/petCatalog.test.ts keeps the two in step.

export type PetSpecies = 'crab' | 'sandpiper' | 'octopus' | 'seal' | 'turtle' | 'dolphin';
export type Habitat = 'land' | 'sea' | 'both';

export interface PetSpec {
  species: PetSpecies;
  name: string;
  habitat: Habitat;
  /** shop price in sand bucks */
  bucks: number;
  /** snacks (1 buck each) to befriend a wild one: always half the price */
  feeds: number;
  /** the bag item a shop purchase grants */
  item: string;
  /** the shop product */
  product: string;
  steamItemId: number;
  blurb: string;
}

/** What one beach snack costs in sand bucks (food_pack_10: 10 snacks, 10 bucks). */
export const SNACK_BUCKS = 1;

export const PETS: PetSpec[] = [
  { species: 'crab', name: 'Sand crab', habitat: 'land', bucks: 20, feeds: 10, item: 'pet-crab', product: 'pet_crab', steamItemId: 1018, blurb: 'Scuttles sideways, dodges waves and burrows to nap' },
  { species: 'sandpiper', name: 'Sandpiper', habitat: 'land', bucks: 30, feeds: 15, item: 'pet-sandpiper', product: 'pet_sandpiper', steamItemId: 1019, blurb: 'Chases the wave edge up and down the sand' },
  { species: 'octopus', name: 'Octopus', habitat: 'sea', bucks: 40, feeds: 20, item: 'pet-octopus', product: 'pet_octopus', steamItemId: 1020, blurb: 'Creeps through the shallows and changes colour' },
  { species: 'seal', name: 'Harbor seal', habitat: 'both', bucks: 50, feeds: 25, item: 'pet-seal', product: 'pet_seal', steamItemId: 1021, blurb: 'Swims the surf, then hauls out to sunbathe' },
  { species: 'turtle', name: 'Sea turtle', habitat: 'both', bucks: 60, feeds: 30, item: 'pet-turtle', product: 'pet_turtle', steamItemId: 1022, blurb: 'Paddles offshore and crawls up the beach' },
  { species: 'dolphin', name: 'Dolphin', habitat: 'sea', bucks: 80, feeds: 40, item: 'pet-dolphin', product: 'pet_dolphin', steamItemId: 1023, blurb: 'Patrols past the surf, breaches and spins' },
];

export const petSpec = (species: unknown): PetSpec | undefined =>
  typeof species === 'string' ? PETS.find((p) => p.species === species) : undefined;

export const petByItem = (item: string): PetSpec | undefined => PETS.find((p) => p.item === item);

export const PET_ITEMS: readonly string[] = PETS.map((p) => p.item);
