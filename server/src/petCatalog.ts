// The pets you can befriend or buy (docs/PETS.md). One table, so the shop,
// befriending and the bag all agree. The app keeps the same table in
// src/world/pets.ts; server/test/stateMachines/pets.test.ts keeps the two in step.

export type PetSpecies = 'crab' | 'sandpiper' | 'octopus' | 'seal' | 'turtle' | 'dolphin';
export type Habitat = 'land' | 'sea' | 'both';

export interface PetSpec {
  species: PetSpecies;
  name: string;
  habitat: Habitat;
  /** shop price in beech bucks */
  bucks: number;
  /** snacks (1 buck each) to befriend a wild one: a quarter of the price */
  feeds: number;
  /** the bag item a shop purchase grants */
  item: string;
  /** the shop product */
  product: string;
  /** only the crab: sold for real money by the app versions already in the stores (docs/BEECH_BUCKS.md) */
  legacySteamItemId?: number;
  blurb: string;
}

/** What one beach snack costs in beech bucks (food_pack_10: 10 snacks, 10 bucks). */
export const SNACK_BUCKS = 1;
/** Befriending costs this share of the shop price (docs/PETS.md). */
export const FEED_SHARE = 1 / 4;

export const PETS: PetSpec[] = [
  { species: 'crab', name: 'Sand crab', habitat: 'land', bucks: 20, feeds: 5, item: 'pet-crab', product: 'pet_crab', legacySteamItemId: 1018, blurb: 'Scuttles sideways, dodges waves and burrows to nap' },
  { species: 'sandpiper', name: 'Sandpiper', habitat: 'land', bucks: 28, feeds: 7, item: 'pet-sandpiper', product: 'pet_sandpiper', blurb: 'Chases the wave edge up and down the sand' },
  { species: 'octopus', name: 'Octopus', habitat: 'sea', bucks: 40, feeds: 10, item: 'pet-octopus', product: 'pet_octopus', blurb: 'Creeps through the shallows and changes colour' },
  { species: 'seal', name: 'Harbor seal', habitat: 'both', bucks: 48, feeds: 12, item: 'pet-seal', product: 'pet_seal', blurb: 'Swims the surf, then hauls out to sunbathe' },
  { species: 'turtle', name: 'Sea turtle', habitat: 'both', bucks: 60, feeds: 15, item: 'pet-turtle', product: 'pet_turtle', blurb: 'Paddles offshore and crawls up the beach' },
  { species: 'dolphin', name: 'Dolphin', habitat: 'sea', bucks: 80, feeds: 20, item: 'pet-dolphin', product: 'pet_dolphin', blurb: 'Patrols past the surf, breaches and spins' },
];

export const petSpec = (species: unknown): PetSpec | undefined =>
  typeof species === 'string' ? PETS.find((p) => p.species === species) : undefined;

export const petByItem = (item: string): PetSpec | undefined => PETS.find((p) => p.item === item);

export const PET_ITEMS: readonly string[] = PETS.map((p) => p.item);
