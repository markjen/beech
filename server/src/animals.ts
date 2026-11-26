// Server-side animal food, wild-feeding bond progress, and resident pets
// (docs/ANIMALS.md, Phases 2 & 3).

import type { Db } from './db.js';
import { petSpec, PETS, type PetSpecies } from './petCatalog.js';

export const TREAT_ITEM_ID = 'crab-treat';
export const PET_CRAB_ITEM_ID = 'pet-crab';
/** Chance to receive a bonus free beach snack alongside a digging find. */
export const FREE_TREAT_CHANCE = 0.25;
/** How many times feeding wild crabs on a beach unlocks befriending one (each species: its `feeds`, a quarter of its price). */
export const BEFRIEND_FEED_THRESHOLD = PETS[0].feeds;
/** Snacks it takes to befriend a wild one of this species (docs/PETS.md: a quarter of its shop price). */
export const befriendThreshold = (species: string): number => petSpec(species)?.feeds ?? BEFRIEND_FEED_THRESHOLD;
/** A known species, or undefined (default: crab). */
export function speciesOf(raw: unknown): PetSpecies | undefined {
  if (raw === undefined || raw === null || raw === '') return 'crab';
  return petSpec(raw)?.species;
}
export const PET_NAME_MAX = 24;

export type PetMood = 'happy' | 'peckish' | 'hungry' | 'sleepy';

const HOUR_MS = 3600 * 1000;

/**
 * Cozy mood computed purely from elapsed time since `lastFedAt` (no cron jobs).
 * Pets never die or permanently leave — after 48h they simply tuck into a sand
 * burrow and snooze until fed.
 */
export function petMood(lastFedAt: number, now: number): PetMood {
  const age = Math.max(0, now - lastFedAt);
  if (age < 12 * HOUR_MS) return 'happy';
  if (age < 24 * HOUR_MS) return 'peckish';
  if (age < 48 * HOUR_MS) return 'hungry';
  return 'sleepy';
}

export interface PetDto {
  beachId: string;
  species: string;
  name: string;
  variant: number;
  source: 'befriended' | 'shop';
  lastFedAt: number;
  fedCount: number;
  mood: PetMood;
  /** where on its beach the pet hangs out (beach frame), or null for its default spot */
  home: { x: number; z: number } | null;
}

/** A pet in its owner's bag (docs/PETS.md). */
export interface BagPetDto {
  id: number;
  species: string;
  name: string;
  variant: number;
  source: 'befriended' | 'shop';
  fedCount: number;
}

export interface BondDto {
  species: string;
  feedCount: number;
  threshold: number;
  ready: boolean;
}

interface PetRow {
  beach_id: string;
  species: string;
  name: string;
  variant: number;
  source: 'befriended' | 'shop';
  last_fed_at: string;
  fed_count: number;
  home_x: number | null;
  home_z: number | null;
}

const PET_COLS = 'beach_id, species, name, variant, source, last_fed_at, fed_count, home_x, home_z';

function toPetDto(r: PetRow, now: number): PetDto {
  const lastFedAt = Number(r.last_fed_at);
  return {
    beachId: r.beach_id,
    species: r.species,
    name: r.name,
    variant: Number(r.variant),
    source: r.source,
    lastFedAt,
    fedCount: Number(r.fed_count),
    mood: petMood(lastFedAt, now),
    home: r.home_x === null || r.home_x === undefined || r.home_z === null ? null : { x: Number(r.home_x), z: Number(r.home_z) },
  };
}

export function cleanPetName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ').slice(0, PET_NAME_MAX);
}

/** Count how many unexpired instances of a consumable item a user owns. */
export async function countConsumable(db: Db, userId: string, itemId: string, now: number): Promise<number> {
  const rows = await db.query<{ n: string | null }>(
    `SELECT COALESCE(SUM(quantity), 0) AS n FROM inventory
      WHERE user_id = $1 AND item_id = $2 AND quantity > 0
        AND (expires_at IS NULL OR expires_at > $3)`,
    [userId, itemId, now],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Atomically consume 1 unexpired consumable item from inventory. */
export async function consumeItem(
  db: Db,
  userId: string,
  itemId: string,
  now: number,
): Promise<{ ok: boolean; remaining: number; rowId?: number }> {
  const rows = await db.query<{ id: number }>(
    `UPDATE inventory
        SET quantity = quantity - 1
      WHERE id = (
        SELECT id FROM inventory
         WHERE user_id = $1 AND item_id = $2 AND quantity > 0
           AND (expires_at IS NULL OR expires_at > $3)
         ORDER BY acquired_at ASC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id`,
    [userId, itemId, now],
  );
  const remaining = await countConsumable(db, userId, itemId, now);
  return { ok: rows.length > 0, remaining, ...(rows[0] ? { rowId: Number(rows[0].id) } : {}) };
}

export const countTreats = (db: Db, userId: string, now: number) => countConsumable(db, userId, TREAT_ITEM_ID, now);
export const consumeTreat = (db: Db, userId: string, now: number) => consumeItem(db, userId, TREAT_ITEM_ID, now);

/** Roll for a free bonus beach snack and grant it to inventory if won. */
export async function maybeGrantBonusTreat(
  db: Db,
  userId: string,
  now: number,
  rand: () => number,
): Promise<boolean> {
  if (rand() >= FREE_TREAT_CHANCE) return false;
  await db.query(
    `INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at)
     VALUES ($1, $2, 1, 'pull', $3, NULL)`,
    [userId, TREAT_ITEM_ID, now],
  );
  return true;
}

export async function getBeachPet(db: Db, beachId: string, now: number): Promise<PetDto | null> {
  const rows = await db.query<PetRow>(
    `SELECT ${PET_COLS} FROM beach_pets WHERE beach_id = $1`,
    [beachId],
  );
  return rows[0] ? toPetDto(rows[0], now) : null;
}

export async function getBondProgress(db: Db, beachId: string, species = 'crab'): Promise<BondDto> {
  const rows = await db.query<{ feed_count: number }>(
    `SELECT feed_count FROM wild_feed_progress WHERE beach_id = $1 AND species = $2`,
    [beachId, species],
  );
  const feedCount = Number(rows[0]?.feed_count ?? 0);
  const threshold = befriendThreshold(species);
  return { species, feedCount, threshold, ready: feedCount >= threshold };
}

export async function recordWildFeed(db: Db, beachId: string, species: string, now: number): Promise<BondDto> {
  const rows = await db.query<{ feed_count: number }>(
    `INSERT INTO wild_feed_progress (beach_id, species, feed_count, updated_at)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (beach_id, species) DO UPDATE
       SET feed_count = wild_feed_progress.feed_count + 1,
           updated_at = EXCLUDED.updated_at
     RETURNING feed_count`,
    [beachId, species, now],
  );
  const feedCount = Number(rows[0]?.feed_count ?? 1);
  const threshold = befriendThreshold(species);
  return { species, feedCount, threshold, ready: feedCount >= threshold };
}

export async function feedBeachPet(
  db: Db,
  beachId: string,
  feederId: string,
  feederName: string,
  now: number,
): Promise<PetDto | null> {
  const rows = await db.query<PetRow>(
    `UPDATE beach_pets
        SET last_fed_at = $2, last_fed_by = $3, fed_count = fed_count + 1
      WHERE beach_id = $1
      RETURNING ${PET_COLS}`,
    [beachId, now, feederId],
  );
  if (!rows[0]) return null;
  await db.query(
    `INSERT INTO pet_feed_log (beach_id, feeder_id, feeder_name, fed_at)
     VALUES ($1, $2, $3, $4)`,
    [beachId, feederId, feederName, now],
  );
  return toPetDto(rows[0], now);
}

type AdoptOpts = { beachId: string; userId: string; species: string; name: string; mode: 'befriend' | 'shop'; now: number; home?: { x: number; z: number } | null };
type AdoptResult = { ok: true; pet: PetDto } | { ok: false; status: 409; error: string };

/**
 * Adopt a pet via either befriending wild visitors or consuming a shop `pet-<species>` item.
 * One transaction holding the beach lock, like a toss and a pickup: otherwise
 * a snack picked up between reading the bond and inserting the pet would
 * leave a crab befriended for one feed less, with the snack back in the bag
 * (specs/tla/Snacks.tla, BefriendedFairly).
 */
export function adoptPet(db: Db, opts: AdoptOpts): Promise<AdoptResult> {
  return db.withTransaction(async (tx) => {
    await tx.query('SELECT id FROM beach WHERE id = $1 FOR NO KEY UPDATE', [opts.beachId]);
    return adoptLocked(tx, opts);
  });
}

async function adoptLocked(db: Db, opts: AdoptOpts): Promise<AdoptResult> {
  const existing = await getBeachPet(db, opts.beachId, opts.now);
  if (existing) return { ok: false, status: 409, error: 'this beach already has a pet' };

  if (opts.mode === 'befriend') {
    const bond = await getBondProgress(db, opts.beachId, opts.species);
    if (!bond.ready) {
      return {
        ok: false,
        status: 409,
        error: `feed wild visitors ${bond.threshold - bond.feedCount} more time(s) to befriend one`,
      };
    }
    const rows = await db.query<PetRow>(
      `INSERT INTO beach_pets (beach_id, species, name, variant, source, last_fed_at, last_fed_by, fed_count, created_at)
       VALUES ($1, $2, $3, 0, 'befriended', $4, $5, 1, $4)
       ON CONFLICT (beach_id) DO NOTHING
       RETURNING ${PET_COLS}`,
      [opts.beachId, opts.species, opts.name, opts.now, opts.userId],
    );
    if (!rows[0]) return { ok: false, status: 409, error: 'this beach already has a pet' };
    await db.query(`DELETE FROM wild_feed_progress WHERE beach_id = $1 AND species = $2`, [opts.beachId, opts.species]);
    // the befriended crab ate the snack that's out: it can't be picked back up
    await db.query(`DELETE FROM beach_snacks WHERE beach_id = $1`, [opts.beachId]);
    return { ok: true, pet: toPetDto(rows[0], opts.now) };
  }

  // Shop path: consume 1 pet-<species> atomically
  const spec = petSpec(opts.species);
  const itemId = spec?.item ?? PET_CRAB_ITEM_ID;
  const consumed = await consumeItem(db, opts.userId, itemId, opts.now);
  if (!consumed.ok) return { ok: false, status: 409, error: `no pet ${(spec?.name ?? 'sand crab').toLowerCase()} in your bag` };

  const rows = await db.query<PetRow>(
    `INSERT INTO beach_pets (beach_id, species, name, variant, source, last_fed_at, last_fed_by, fed_count, created_at, home_x, home_z)
     VALUES ($1, $2, $3, 0, 'shop', $4, $5, 1, $4, $6, $7)
     ON CONFLICT (beach_id) DO NOTHING
     RETURNING ${PET_COLS}`,
    [opts.beachId, opts.species, opts.name, opts.now, opts.userId, opts.home?.x ?? null, opts.home?.z ?? null],
  );
  if (!rows[0]) {
    // Refund the consumed item if a concurrent adopt won the race
    await db.query(
      `INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at)
       VALUES ($1, $2, 1, 'shop', $3, NULL)`,
      [opts.userId, itemId, opts.now],
    );
    return { ok: false, status: 409, error: 'this beach already has a pet' };
  }
  return { ok: true, pet: toPetDto(rows[0], opts.now) };
}

export async function renameBeachPet(db: Db, beachId: string, name: string, now: number): Promise<PetDto | null> {
  const rows = await db.query<PetRow>(
    `UPDATE beach_pets SET name = $2 WHERE beach_id = $1
     RETURNING ${PET_COLS}`,
    [beachId, name],
  );
  return rows[0] ? toPetDto(rows[0], now) : null;
}

export interface PetFeederDto {
  name: string;
  at: number;
}

/** Start of the current UTC day in milliseconds. */
export function utcDayStart(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Has this visitor already fed this beach's pet today (UTC)? */
export async function hasVisitorFedToday(db: Db, beachId: string, visitorId: string, now: number): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM pet_feed_log
      WHERE beach_id = $1 AND feeder_id = $2 AND fed_at >= $3
      LIMIT 1`,
    [beachId, visitorId, utcDayStart(now)],
  );
  return rows.length > 0;
}

/** Recent non-owner feeds for a beach's pet (newest first, up to 5). */
export async function recentPetFeeders(db: Db, beachId: string, ownerId?: string): Promise<PetFeederDto[]> {
  const rows = ownerId
    ? await db.query<{ feeder_name: string; fed_at: string }>(
        `SELECT feeder_name, fed_at FROM pet_feed_log
          WHERE beach_id = $1 AND (feeder_id IS NULL OR feeder_id <> $2)
          ORDER BY fed_at DESC, id DESC LIMIT 5`,
        [beachId, ownerId],
      )
    : await db.query<{ feeder_name: string; fed_at: string }>(
        `SELECT feeder_name, fed_at FROM pet_feed_log
          WHERE beach_id = $1
          ORDER BY fed_at DESC, id DESC LIMIT 5`,
        [beachId],
      );
  return rows.map((r) => ({ name: r.feeder_name || 'A visitor', at: Number(r.fed_at) }));
}

type VisitOpts = { beachId: string; visitorId: string; visitorName: string; useFood?: boolean; now: number };
type VisitResult =
  | { ok: true; pet: PetDto; usedFood: boolean; remaining?: number; freeUsedToday: true }
  | { ok: false; status: 404 | 409; error: string; freeUsedToday?: boolean };

/**
 * Visitor feeds a beach's resident pet:
 *  - 1 free feed per beach per UTC day (no snack required), OR
 *  - spend 1 `crab-treat` from the visitor's own bag anytime.
 * One transaction holding the beach lock: two requests at once must not both
 * see "not fed today" (specs/tla/Snacks.tla, OneFreeFeedADay).
 */
export function visitorFeedPet(db: Db, opts: VisitOpts): Promise<VisitResult> {
  return db.withTransaction(async (tx) => {
    await tx.query('SELECT id FROM beach WHERE id = $1 FOR NO KEY UPDATE', [opts.beachId]);
    return visitLocked(tx, opts);
  });
}

async function visitLocked(db: Db, opts: VisitOpts): Promise<VisitResult> {
  const existing = await getBeachPet(db, opts.beachId, opts.now);
  if (!existing) return { ok: false, status: 404, error: 'no pet on this beach' };

  // the owner's inbox row for the feed, in the same transaction as the feed
  // itself: a row exists exactly when a visitor fed the pet. The owner
  // feeding their own pet writes none. The row is the owner's notice (and
  // push) instead of a toast when they next open the beach.
  const ownerId = (await db.query<{ owner_id: string }>('SELECT owner_id FROM beach WHERE id = $1', [opts.beachId]))[0]?.owner_id ?? null;
  const tellOwner = async (pet: PetDto) => {
    if (!ownerId || ownerId === opts.visitorId) return;
    await db.query(
      `INSERT INTO inbox (user_id, kind, actor_id, beach_id, payload, created_at) VALUES ($1, 'pet_fed', $2, $3, $4::jsonb, $5)`,
      [ownerId, opts.visitorId, opts.beachId, JSON.stringify({ pet: pet.name }), opts.now],
    );
  };

  const alreadyFree = await hasVisitorFedToday(db, opts.beachId, opts.visitorId, opts.now);
  if (!alreadyFree && !opts.useFood) {
    const pet = await feedBeachPet(db, opts.beachId, opts.visitorId, opts.visitorName, opts.now);
    if (!pet) return { ok: false, status: 404, error: 'no pet on this beach' };
    await tellOwner(pet);
    return { ok: true, pet, usedFood: false, freeUsedToday: true };
  }

  // Free daily feed already used (or visitor explicitly chose to spend own food)
  const consumed = await consumeTreat(db, opts.visitorId, opts.now);
  if (!consumed.ok) {
    return {
      ok: false,
      status: 409,
      error: 'already gave your free snack today — bring beach snacks to feed again',
      freeUsedToday: true,
    };
  }
  const pet = await feedBeachPet(db, opts.beachId, opts.visitorId, opts.visitorName, opts.now);
  if (!pet) return { ok: false, status: 404, error: 'no pet on this beach' };
  await tellOwner(pet);
  return { ok: true, pet, usedFood: true, remaining: consumed.remaining, freeUsedToday: true };
}


/** How long a tossed snack stays on the sand (matches the client's ANIMALS.foodDuration). */
export const SNACK_OUT_MS = 900 * 1000;

/** Remember the snack just tossed on a beach (replacing any earlier one: the client keeps one at a time). */
export async function recordSnackOut(
  db: Db,
  s: { beachId: string; userId: string; inventoryId?: number; now: number; wildSpecies?: string; petPrevFedAt?: number },
): Promise<void> {
  await db.query(
    `INSERT INTO beach_snacks (beach_id, user_id, inventory_id, tossed_at, wild_species, pet_prev_fed_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (beach_id) DO UPDATE
       SET user_id = EXCLUDED.user_id, inventory_id = EXCLUDED.inventory_id, tossed_at = EXCLUDED.tossed_at,
           wild_species = EXCLUDED.wild_species, pet_prev_fed_at = EXCLUDED.pet_prev_fed_at`,
    [s.beachId, s.userId, s.inventoryId ?? null, s.now, s.wildSpecies ?? null, s.petPrevFedAt ?? null],
  );
}

/**
 * Pick the snack that's out on a beach back up: it goes back in the bag, and
 * what tossing it did is undone (one less wild feed toward befriending, or the
 * pet's feed taken back). Returns null when there's no snack out to pick up.
 */
export async function returnSnack(
  db: Db,
  beachId: string,
  userId: string,
  now: number,
): Promise<{ remaining: number; pet: PetDto | null; bond: BondDto } | null> {
  const rows = await db.query<{ inventory_id: string | null; tossed_at: string; wild_species: string | null; pet_prev_fed_at: string | null }>(
    `DELETE FROM beach_snacks WHERE beach_id = $1 AND user_id = $2 AND tossed_at > $3
     RETURNING inventory_id, tossed_at, wild_species, pet_prev_fed_at`,
    [beachId, userId, now - SNACK_OUT_MS],
  );
  const r = rows[0];
  if (!r) return null;
  const back = r.inventory_id
    ? await db.query<{ id: number }>(`UPDATE inventory SET quantity = quantity + 1 WHERE id = $1 AND user_id = $2 RETURNING id`, [r.inventory_id, userId])
    : [];
  if (!back.length) {
    await db.query(
      `INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at)
       VALUES ($1, $2, 1, 'shop', $3, NULL)`,
      [userId, TREAT_ITEM_ID, now],
    );
  }
  const tossedAt = Number(r.tossed_at);
  if (r.wild_species) {
    await db.query(
      `UPDATE wild_feed_progress SET feed_count = GREATEST(0, feed_count - 1), updated_at = $3
        WHERE beach_id = $1 AND species = $2`,
      [beachId, r.wild_species, now],
    );
  }
  if (r.pet_prev_fed_at !== null) {
    // only if nobody fed the pet since
    await db.query(
      `UPDATE beach_pets SET last_fed_at = $3, fed_count = GREATEST(0, fed_count - 1)
        WHERE beach_id = $1 AND last_fed_at = $2`,
      [beachId, tossedAt, Number(r.pet_prev_fed_at)],
    );
    await db.query(`DELETE FROM pet_feed_log WHERE beach_id = $1 AND feeder_id = $2 AND fed_at = $3`, [beachId, userId, tossedAt]);
  }
  return {
    remaining: await countTreats(db, userId, now),
    pet: await getBeachPet(db, beachId, now),
    bond: await getBondProgress(db, beachId, r.wild_species ?? 'crab'),
  };
}


// ---------------------------------------------------------------- pets as things you own and move (docs/PETS.md)

/** Your pets in the bag, oldest first. */
export async function listBagPets(db: Db, userId: string): Promise<BagPetDto[]> {
  const rows = await db.query<{ id: string; species: string; name: string; variant: number; source: 'befriended' | 'shop'; fed_count: number }>(
    `SELECT id, species, name, variant, source, fed_count FROM pet_bag WHERE user_id = $1 ORDER BY created_at, id`,
    [userId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    species: r.species,
    name: r.name,
    variant: Number(r.variant),
    source: r.source,
    fedCount: Number(r.fed_count),
  }));
}

/**
 * Put a beach's pet in its owner's bag (the caller holds the beach lock).
 * It keeps its name and feeds, and how hungry it was: it doesn't get
 * hungrier in the bag.
 */
export async function stowLocked(db: Db, beachId: string, userId: string, now: number): Promise<BagPetDto | null> {
  const rows = await db.query<PetRow & { created_at: string }>(
    `DELETE FROM beach_pets WHERE beach_id = $1 RETURNING ${PET_COLS}, created_at`,
    [beachId],
  );
  const r = rows[0];
  if (!r) return null;
  const hunger = Math.max(0, now - Number(r.last_fed_at));
  const bag = await db.query<{ id: string }>(
    `INSERT INTO pet_bag (user_id, species, name, variant, source, fed_count, hunger_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [userId, r.species, r.name, r.variant, r.source, r.fed_count, hunger, now],
  );
  // a snack out for this pet can't be taken back from a pet that's gone
  await db.query(`DELETE FROM beach_snacks WHERE beach_id = $1 AND pet_prev_fed_at IS NOT NULL`, [beachId]);
  return {
    id: Number(bag[0].id),
    species: r.species,
    name: r.name,
    variant: Number(r.variant),
    source: r.source,
    fedCount: Number(r.fed_count),
  };
}

/** POST /pet/stow: one transaction holding the beach lock (specs/tla/Pets.tla, Stow). */
export function stowPet(db: Db, opts: { beachId: string; userId: string; now: number }): Promise<BagPetDto | null> {
  return db.withTransaction(async (tx) => {
    await tx.query('SELECT id FROM beach WHERE id = $1 FOR NO KEY UPDATE', [opts.beachId]);
    return stowLocked(tx, opts.beachId, opts.userId, opts.now);
  });
}

type PlaceResult = { ok: true; pet: PetDto } | { ok: false; status: 404 | 409; error: string };

/**
 * Put a pet from the bag on one of your beaches. One transaction holding the
 * player lock and the beach lock: in steps, two devices could put one pet on
 * two beaches, or lose it when another pet got there first
 * (specs/tla/Pets.tla: NeverTwice, NeverLost).
 */
export function placePet(
  db: Db,
  opts: { petId: number; beachId: string; userId: string; now: number; home?: { x: number; z: number } | null },
): Promise<PlaceResult> {
  return db.withTransaction(async (tx) => {
    await tx.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [opts.userId]);
    await tx.query('SELECT id FROM beach WHERE id = $1 FOR NO KEY UPDATE', [opts.beachId]);
    if (await getBeachPet(tx, opts.beachId, opts.now)) return { ok: false, status: 409, error: 'this beach already has a pet' };
    const rows = await tx.query<{ species: string; name: string; variant: number; source: string; fed_count: number; hunger_ms: string }>(
      `DELETE FROM pet_bag WHERE id = $1 AND user_id = $2
       RETURNING species, name, variant, source, fed_count, hunger_ms`,
      [opts.petId, opts.userId],
    );
    const b = rows[0];
    if (!b) return { ok: false, status: 404, error: 'that pet isn’t in your bag' };
    const home = cleanHome(opts.home);
    const ins = await tx.query<PetRow>(
      `INSERT INTO beach_pets (beach_id, species, name, variant, source, last_fed_at, last_fed_by, fed_count, created_at, home_x, home_z)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10)
       RETURNING ${PET_COLS}`,
      [opts.beachId, b.species, b.name, b.variant, b.source, opts.now - Number(b.hunger_ms), b.fed_count, opts.now, home?.x ?? null, home?.z ?? null],
    );
    return { ok: true, pet: toPetDto(ins[0], opts.now) };
  });
}

/** Half the slab (32 m) less a margin: a pet's spot stays on its beach. */
const HOME_LIMIT = 14.5;

export function cleanHome(raw: unknown): { x: number; z: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { x, z } = raw as { x?: unknown; z?: unknown };
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const c = (v: number) => Math.max(-HOME_LIMIT, Math.min(HOME_LIMIT, v));
  return { x: Math.round(c(x) * 100) / 100, z: Math.round(c(z) * 100) / 100 };
}

/** Move a pet to a new spot on its beach (picked up and set down). */
export async function setPetHome(db: Db, beachId: string, home: { x: number; z: number } | null, now: number): Promise<PetDto | null> {
  const rows = await db.query<PetRow>(
    `UPDATE beach_pets SET home_x = $2, home_z = $3 WHERE beach_id = $1 RETURNING ${PET_COLS}`,
    [beachId, home?.x ?? null, home?.z ?? null],
  );
  return rows[0] ? toPetDto(rows[0], now) : null;
}
