// The reference model for neighbor links: specs/tla/Neighbors.tla with
// Fixed = TRUE, one action at a time (docs/STATE_MACHINES.md). Links and
// requests are sets of "a|side|b" strings, as rows in the two tables.
export type Side = 'left' | 'right';
export const opp = (s: Side): Side => (s === 'left' ? 'right' : 'left');
const key = (a: string, s: Side, b: string) => `${a}|${s}|${b}`;
const parts = (k: string) => k.split('|') as [string, Side, string];

export class NeighborsModel {
  links = new Set<string>();
  reqs = new Set<string>();

  clone(): NeighborsModel {
    const m = new NeighborsModel();
    m.links = new Set(this.links);
    m.reqs = new Set(this.reqs);
    return m;
  }

  neighborOn(a: string, s: Side): string | undefined {
    for (const k of this.links) {
      const [x, side, y] = parts(k);
      if (x === a && side === s) return y;
    }
    return undefined;
  }

  private paired(a: string, b: string) {
    return this.links.has(key(a, 'left', b)) || this.links.has(key(a, 'right', b));
  }

  /** CanInsert + Link: link() in server/src/app.ts. False if refused (409). */
  private link(a: string, s: Side, b: string): boolean {
    if (this.paired(a, b)) return false;
    if (this.neighborOn(a, s) || this.neighborOn(b, opp(s))) return false;
    for (const k of this.links) {
      const [, side, y] = parts(k);
      if ((y === b && side === s) || (y === a && side === opp(s))) return false;
    }
    this.links.add(key(a, s, b));
    this.links.add(key(b, opp(s), a));
    for (const k of [...this.reqs]) {
      const [f, side, t] = parts(k);
      if (
        (f === a && (side === s || t === b)) || (f === b && (side === opp(s) || t === a)) ||
        (t === a && side === opp(s)) || (t === b && side === s)
      ) this.reqs.delete(k);
    }
    return true;
  }

  /** Ask: PUT /neighbors/:side by a, naming b. */
  ask(a: string, s: Side, b: string): number {
    if (a === b) return 400;
    if (this.neighborOn(a, s)) return 409;
    if (this.neighborOn(a, opp(s)) === b) return 409;
    if (this.neighborOn(b, opp(s))) return 409;
    if (this.reqs.has(key(b, opp(s), a))) return this.link(a, s, b) ? 200 : 409;
    for (const k of [...this.reqs]) if (parts(k)[0] === a && parts(k)[1] === s) this.reqs.delete(k);
    this.reqs.add(key(a, s, b));
    return 200;
  }

  /** AcceptCheck + AcceptLink: b accepts a's request. Every outcome the server may pick. */
  acceptOutcomes(b: string, a: string): { status: number; next: NeighborsModel }[] {
    const sides = (['left', 'right'] as Side[]).filter((s) => this.reqs.has(key(a, s, b)));
    if (!sides.length) return [{ status: 404, next: this }];
    return sides.map((s) => {
      const next = this.clone();
      if (next.neighborOn(b, opp(s))) return { status: 409, next };
      return { status: next.link(a, s, b) ? 200 : 409, next };
    });
  }

  /** Decline: DELETE /neighbors/requests/:code by b, for a's requests. */
  decline(b: string, a: string) {
    for (const k of [...this.reqs]) if (parts(k)[0] === a && parts(k)[2] === b) this.reqs.delete(k);
  }

  /** MoveAway: DELETE /neighbors/:side by a. */
  moveAway(a: string, s: Side) {
    for (const k of [...this.links]) {
      const [x, side, y] = parts(k);
      if ((x === a && side === s) || (y === a && side === opp(s))) this.links.delete(k);
    }
    for (const k of [...this.reqs]) if (parts(k)[0] === a && parts(k)[1] === s) this.reqs.delete(k);
  }
}

/** The spec's invariants, on a set of link rows. */
export function linkInvariants(links: Set<string>): string[] {
  const bad = new Set<string>();
  const rows = [...links].map(parts);
  for (const [a, s, b] of rows) {
    if (!links.has(key(b, opp(s), a))) bad.add('Mutual');
    if (a === b) bad.add('NoSelf');
    if (links.has(key(a, opp(s), b))) bad.add('LinkedOnce');
  }
  const perSide = new Map<string, number>();
  for (const [a, s] of rows) perSide.set(`${a}|${s}`, (perSide.get(`${a}|${s}`) ?? 0) + 1);
  if ([...perSide.values()].some((n) => n > 1)) bad.add('OnePerSide');
  return [...bad].sort();
}
