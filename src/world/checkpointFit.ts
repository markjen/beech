//@ backend dafny
// The restore check for checkpoints (docs/CHECKPOINTS.md), on the app side so
// it can show the answer before asking the server. The server has the same
// rule (server/src/checkpoints.ts); tests/fixtures/checkpoint-fit.json is run
// by both test suites, and both cores are proved (docs/VERIFICATION.md).
import { itemById } from './items';

export interface Short {
  item: string;
  need: number;
  have: number;
}

const isFree = (id: string) => itemById(id)?.unlimited === true;

/** What `owned` minus `elsewhere` leaves for one item; never below zero. */
export function bagLeft(owned: Record<string, number>, elsewhere: Record<string, number>, item: string): number {
  //@ verify
  //@ pure
  //@ ensures \result >= 0
  return Math.max(0, (owned[item] ?? 0) - (elsewhere[item] ?? 0));
}

/**
 * The verified core of `shortfall`, in no particular order, with the free
 * items given. Proved: everything listed is a real shortfall (a non-free
 * item needed more than the bag leaves, with the right counts), and every
 * real shortfall is listed, once. The same statement as the server's.
 */
export function shortfallUnsorted(
  need: Record<string, number>,
  owned: Record<string, number>,
  elsewhere: Record<string, number>,
  free: Set<string>,
): Short[] {
  //@ verify
  //@ ensures forall(i: nat, i < \result.length ==> \result[i].item in need && !free.has(\result[i].item) && \result[i].need === need[\result[i].item] && \result[i].have === bagLeft(owned, elsewhere, \result[i].item) && \result[i].need > \result[i].have)
  //@ ensures forall(k: string, k in need && !free.has(k) && need[k] > 0 && need[k] > bagLeft(owned, elsewhere, k) ==> exists(i: nat, i < \result.length && \result[i].item === k))
  //@ ensures forall(i: nat, forall(j: nat, i < j && j < \result.length ==> \result[i].item !== \result[j].item))
  const out: Short[] = [];
  for (const [item, n] of Object.entries(need)) {
    if (n <= 0 || free.has(item)) continue;
    const have = bagLeft(owned, elsewhere, item);
    if (n > have) out.push({ item, need: n, have });
  }
  return out;
}

type Counts = ReadonlyMap<string, number> | Readonly<Record<string, number>>;
const asRecord = (m: Counts): Record<string, number> => (m instanceof Map ? Object.fromEntries(m) : { ...(m as Record<string, number>) });

/** short(i) = max(0, need(i) - (owned(i) - elsewhere(i))), for each non-free item, sorted by item id. */
export function shortfall(need: Readonly<Record<string, number>>, owned: Counts, elsewhere: Counts): Short[] {
  const free = new Set(Object.keys(need).filter(isFree));
  return shortfallUnsorted({ ...need }, asRecord(owned), asRecord(elsewhere), free).sort((a, b) => (a.item < b.item ? -1 : 1));
}
