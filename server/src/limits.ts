//@ backend dafny
// How much a player's beaches and checkpoints hold (docs/MULTI_BEACH.md,
// docs/CHECKPOINTS.md). Pure rules, proved with LemmaScript
// (docs/VERIFICATION.md); the routes in app.ts read the counts and apply
// them inside the transactions specs/tla/Checkpoints.tla calls for.

/** the most beaches one person can have (src/config.ts has the same) */
export const BEACH_CAP = 8;
/** named checkpoints a player may keep for each beach they're allowed */
export const CHECKPOINTS_PER_BEACH = 5;
/** all of a player's checkpoints share this store (the tide copies aside) */
export const CHECKPOINT_BYTES_PER_USER = 16 * 1024 * 1024;

/**
 * How many beaches you may have: one, plus each extra beach you own, up to
 * BEACH_CAP. Proved: never more than the cap; never fewer than one; each
 * extra beach counts until the cap; owning more never allows fewer.
 */
export function beachAllowance(extraBeaches: number): number {
  //@ verify
  //@ ensures \result <= BEACH_CAP
  //@ ensures extraBeaches >= 0 ==> \result >= 1
  //@ ensures extraBeaches >= 0 && extraBeaches + 1 <= BEACH_CAP ==> \result === extraBeaches + 1
  //@ ensures extraBeaches + 1 >= BEACH_CAP ==> \result === BEACH_CAP
  return Math.min(BEACH_CAP, 1 + extraBeaches);
}

/**
 * The most named checkpoints for an allowance of beaches. Proved: within
 * 5 a beach for every allowance the cap allows, so never more than 40.
 */
export function checkpointLimit(allowance: number): number {
  //@ verify
  //@ requires allowance >= 0 && allowance <= BEACH_CAP
  //@ ensures \result === CHECKPOINTS_PER_BEACH * allowance
  //@ ensures \result <= CHECKPOINTS_PER_BEACH * BEACH_CAP
  return CHECKPOINTS_PER_BEACH * allowance;
}

/**
 * Is there room for one more named checkpoint of `adding` bytes? null: yes;
 * 'count': the named limit is reached; 'bytes': the store is full. Proved:
 * yes exactly when one more stays within the limit and the bytes within the
 * store, so a checkpoint let in (under the player lock, Checkpoints.tla)
 * never takes either over; when both are full, the count is said first.
 */
export function checkpointRoom(named: number, limit: number, usedBytes: number, adding: number): string | null {
  //@ verify
  //@ ensures (\result === null) <==> (named + 1 <= limit && usedBytes + adding <= CHECKPOINT_BYTES_PER_USER)
  //@ ensures (\result === 'count') <==> (named >= limit)
  //@ ensures (\result === 'bytes') <==> (named < limit && usedBytes + adding > CHECKPOINT_BYTES_PER_USER)
  if (named >= limit) return 'count';
  if (usedBytes + adding > CHECKPOINT_BYTES_PER_USER) return 'bytes';
  return null;
}

/**
 * Does a new automatic copy of `adding` bytes fit, replacing the beach's slot
 * of `slotBytes` (already counted in `usedBytes`)? Proved: exactly when the
 * store after the swap stays within the cap, so a copy let in never takes it
 * over; and it's never stricter than a named checkpoint's check.
 */
export function autoSlotFits(usedBytes: number, slotBytes: number, adding: number): boolean {
  //@ verify
  //@ ensures \result <==> usedBytes - slotBytes + adding <= CHECKPOINT_BYTES_PER_USER
  //@ ensures slotBytes >= 0 && usedBytes + adding <= CHECKPOINT_BYTES_PER_USER ==> \result
  return usedBytes - slotBytes + adding <= CHECKPOINT_BYTES_PER_USER;
}
