import type { MyBeach, Side } from '../net/account';

const opposite = (side: Side): Side => (side === 'left' ? 'right' : 'left');

/**
 * Group your own beaches into left-to-right connected stretches (matching the
 * 3D shore layout: facing the sea, `left` is on the left and `right` is on the
 * right). Single unlinked beaches appear as 1-element stretches.
 */
export function buildOwnStretches(beaches: readonly MyBeach[]): MyBeach[][] {
  const byCode = new Map<string, MyBeach>();
  for (const b of beaches) byCode.set(b.code, b);

  const ownNeighbor = (b: MyBeach, side: Side): MyBeach | undefined => {
    const n = b[side];
    return n && n.yours ? byCode.get(n.code) : undefined;
  };

  const visited = new Set<string>();
  const stretches: MyBeach[][] = [];

  // Start from every beach that has no owned neighbor on its left (the left
  // end of a stretch), then walk right.
  for (const b of beaches) {
    if (visited.has(b.id) || ownNeighbor(b, 'left')) continue;
    const chain: MyBeach[] = [];
    let cur: MyBeach | undefined = b;
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      chain.push(cur);
      cur = ownNeighbor(cur, 'right');
    }
    if (chain.length) stretches.push(chain);
  }

  // Fallback for any cycle (shouldn't happen, but never drop a beach).
  for (const b of beaches) {
    if (visited.has(b.id)) continue;
    const chain: MyBeach[] = [];
    let cur: MyBeach | undefined = b;
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      chain.push(cur);
      cur = ownNeighbor(cur, 'right');
    }
    if (chain.length) stretches.push(chain);
  }

  return stretches;
}

/**
 * Which of your other beaches can be connected directly to `side` of `beachId`:
 * - not `beachId` itself
 * - `beachId`'s `side` must be free
 * - the candidate's opposite side must be free
 * - the candidate must not already be in the same connected stretch (avoids loops)
 */
export function connectableBeaches(beaches: readonly MyBeach[], beachId: string, side: Side): MyBeach[] {
  const target = beaches.find((b) => b.id === beachId);
  if (!target || target[side]) return [];
  const opp = opposite(side);
  const stretches = buildOwnStretches(beaches);
  const sameStretch = new Set(stretches.find((s) => s.some((b) => b.id === beachId))?.map((b) => b.id) ?? [beachId]);
  return beaches.filter((b) => b.id !== beachId && !sameStretch.has(b.id) && !b[opp]);
}

/** Human-readable short label for one of your beaches. */
export function ownBeachLabel(b: Pick<MyBeach, 'name' | 'home'>): string {
  return b.name || (b.home ? 'Home' : 'A beach');
}

/**
 * A pier in the bag with nowhere to put it: the player owns more piers than
 * are placed, but no beach can take one — no beach sits between two of their
 * own without a pier already on it (docs/PIERS.md). A site with a pier
 * already attached offers no place for a spare. The shop sells the pier
 * without that check, so the account panel has to say so instead of leaving
 * the pier invisible.
 */
export function hasSparePierWithoutSite(
  beaches: readonly MyBeach[],
  piers: { owned: number; placed: number },
): boolean {
  return piers.owned > piers.placed && !beaches.some((b) => b.pierSite && !b.pier);
}
