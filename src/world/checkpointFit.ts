// The restore check for checkpoints (docs/CHECKPOINTS.md), on the app side so
// it can show the answer before asking the server. The server has the same
// rule (server/src/checkpoints.ts); tests/fixtures/checkpoint-fit.json is run
// by both test suites.
import { itemById } from './items';

export interface Short {
  item: string;
  need: number;
  have: number;
}

const isFree = (id: string) => itemById(id)?.unlimited === true;

/** short(i) = max(0, need(i) - (owned(i) - elsewhere(i))), for each non-free item. */
export function shortfall(
  need: Readonly<Record<string, number>>,
  owned: ReadonlyMap<string, number> | Readonly<Record<string, number>>,
  elsewhere: ReadonlyMap<string, number> | Readonly<Record<string, number>>,
): Short[] {
  const get = (m: ReadonlyMap<string, number> | Readonly<Record<string, number>>, k: string) =>
    (m instanceof Map ? m.get(k) : (m as Record<string, number>)[k]) ?? 0;
  const out: Short[] = [];
  for (const [item, n] of Object.entries(need).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (n <= 0 || isFree(item)) continue;
    const have = Math.max(0, get(owned, item) - get(elsewhere, item));
    if (n > have) out.push({ item, need: n, have });
  }
  return out;
}
