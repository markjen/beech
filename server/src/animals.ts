// Server-side animal food, wild-feeding bond progress, and resident pets
// (docs/ANIMALS.md, Phases 2 & 3).

import type { Db } from './db.js';

export const TREAT_ITEM_ID = 'crab-treat';
export const PET_CRAB_ITEM_ID = 'pet-crab';
/** Chance to receive a bonus free beach snack alongside a digging find. */
export const FREE_TREAT_CHANCE = 0.25;
/** How many times feeding wild visitors on a beach unlocks befriending one as a pet. */
export const BEFRIEND_FEED_THRESHOLD = 10;
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
}

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
    `SELECT beach_id, species, name, variant, source, last_fed_at, fed_count
       FROM beach_pets WHERE beach_id = $1`,
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
  return {
    species,
    feedCount,
    threshold: BEFRIEND_FEED_THRESHOLD,
    ready: feedCount >= BEFRIEND_FEED_THRESHOLD,
  };
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
  return {
    species,
    feedCount,
    threshold: BEFRIEND_FEED_THRESHOLD,
    ready: feedCount >= BEFRIEND_FEED_THRESHOLD,
  };
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
      RETURNING beach_id, species, name, variant, source, last_fed_at, fed_count`,
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

/** Adopt a pet via either befriending wild visitors or consuming a shop `pet-crab`. */
export async function adoptPet(
  db: Db,
  opts: { beachId: string; userId: string; species: string; name: string; mode: 'befriend' | 'shop'; now: number },
): Promise<{ ok: true; pet: PetDto } | { ok: false; status: 409; error: string }> {
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
       RETURNING beach_id, species, name, variant, source, last_fed_at, fed_count`,
      [opts.beachId, opts.species, opts.name, opts.now, opts.userId],
    );
    if (!rows[0]) return { ok: false, status: 409, error: 'this beach already has a pet' };
    await db.query(`DELETE FROM wild_feed_progress WHERE beach_id = $1 AND species = $2`, [opts.beachId, opts.species]);
    // the befriended crab ate the snack that's out: it can't be picked back up
    await db.query(`DELETE FROM beach_snacks WHERE beach_id = $1`, [opts.beachId]);
    return { ok: true, pet: toPetDto(rows[0], opts.now) };
  }

  // Shop path: consume 1 pet-crab atomically
  const consumed = await consumeItem(db, opts.userId, PET_CRAB_ITEM_ID, opts.now);
  if (!consumed.ok) return { ok: false, status: 409, error: 'no pet sand crab in your bag' };

  const rows = await db.query<PetRow>(
    `INSERT INTO beach_pets (beach_id, species, name, variant, source, last_fed_at, last_fed_by, fed_count, created_at)
     VALUES ($1, $2, $3, 0, 'shop', $4, $5, 1, $4)
     ON CONFLICT (beach_id) DO NOTHING
     RETURNING beach_id, species, name, variant, source, last_fed_at, fed_count`,
    [opts.beachId, opts.species, opts.name, opts.now, opts.userId],
  );
  if (!rows[0]) {
    // Refund the consumed item if a concurrent adopt won the race
    await db.query(
      `INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at)
       VALUES ($1, $2, 1, 'shop', $3, NULL)`,
      [opts.userId, PET_CRAB_ITEM_ID, opts.now],
    );
    return { ok: false, status: 409, error: 'this beach already has a pet' };
  }
  return { ok: true, pet: toPetDto(rows[0], opts.now) };
}

export async function renameBeachPet(db: Db, beachId: string, name: string, now: number): Promise<PetDto | null> {
  const rows = await db.query<PetRow>(
    `UPDATE beach_pets SET name = $2 WHERE beach_id = $1
     RETURNING beach_id, species, name, variant, source, last_fed_at, fed_count`,
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

/**
 * Visitor feeds a beach's resident pet:
 *  - 1 free feed per beach per UTC day (no snack required), OR
 *  - spend 1 `crab-treat` from the visitor's own bag anytime.
 */
export async function visitorFeedPet(
  db: Db,
  opts: { beachId: string; visitorId: string; visitorName: string; useFood?: boolean; now: number },
): Promise<
  | { ok: true; pet: PetDto; usedFood: boolean; remaining?: number; freeUsedToday: true }
  | { ok: false; status: 404 | 409; error: string; freeUsedToday?: boolean }
> {
  const existing = await getBeachPet(db, opts.beachId, opts.now);
  if (!existing) return { ok: false, status: 404, error: 'no pet on this beach' };

  const alreadyFree = await hasVisitorFedToday(db, opts.beachId, opts.visitorId, opts.now);
  if (!alreadyFree && !opts.useFood) {
    const pet = await feedBeachPet(db, opts.beachId, opts.visitorId, opts.visitorName, opts.now);
    if (!pet) return { ok: false, status: 404, error: 'no pet on this beach' };
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
