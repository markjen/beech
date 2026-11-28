// The reference model for the claw and vending machines: specs/tla/Claw.tla
// with Fixed = TRUE (docs/STATE_MACHINES.md). Each method is one request,
// taken atomically; it returns the status the server should answer and
// checks the prize the server drew against what the rules allow.
import { STARTER } from '../../src/pulls.js';

export type Machine = 'daily' | 'vending';
export interface Prize {
  status: number;
  item: string | null;
  rarity: string | null;
}

interface PlayerState {
  goes: Record<Machine, number>;
  free: Record<Machine, boolean>;
  firstClawGoAt: number | null;
  hadBeach: boolean;
  bucks: number;
  bag: Map<string, number>;
  /** ghost: free goes claimed since the machine last rested (OneGoPerRest) */
  goesThisRest: Record<Machine, number>;
  paidTries: number;
}

export class ClawModel {
  players = new Map<string, PlayerState>();
  /** the unique item's owner (unique_items.owner_id), by item */
  owner = new Map<string, string>();
  constructor(
    readonly price: number,
    readonly startBucks: number,
    readonly uniqueItem: string,
  ) {}

  add(id: string) {
    this.players.set(id, {
      goes: { daily: 0, vending: 0 },
      free: { daily: true, vending: true },
      firstClawGoAt: null,
      hadBeach: false,
      bucks: this.startBucks,
      bag: new Map(),
      goesThisRest: { daily: 0, vending: 0 },
      paidTries: 0,
    });
  }

  private p(id: string) {
    return this.players.get(id)!;
  }

  /** the starter gift this free claw go must give, or null for a normal draw */
  starterFor(id: string, now: number): string | null {
    const p = this.p(id);
    const go = p.goes.daily + 1;
    if (go === 1) return STARTER.rare.item;
    if (go === 2) return STARTER.paid.item;
    if (!p.hadBeach && p.firstClawGoAt !== null && now - p.firstClawGoAt >= STARTER.beachAfterMs) return STARTER.beach.item;
    return null;
  }

  private grant(id: string, got: Prize): string[] {
    const bad: string[] = [];
    if (!got.item) return bad;
    const p = this.p(id);
    if (got.item === this.uniqueItem) {
      const o = this.owner.get(got.item);
      if (o && o !== id) bad.push(`UniqueOnce: ${got.item} granted while owned by another`);
      this.owner.set(got.item, id);
    }
    if (got.item === STARTER.beach.item) p.hadBeach = true;
    p.bag.set(got.item, (p.bag.get(got.item) ?? 0) + 1);
    return bad;
  }

  /** FreeDraw + FreeClaim: 200 when the go is free, else 409 */
  free(id: string, m: Machine, now: number, got: Prize): string[] {
    const p = this.p(id);
    if (!p.free[m]) return got.status === 409 ? [] : [`free ${m}: expected 409, got ${got.status}`];
    if (got.status !== 200) return [`free ${m}: expected 200, got ${got.status}`];
    const bad: string[] = [];
    if (m === 'daily') {
      const starter = this.starterFor(id, now);
      if (starter && got.item !== starter) bad.push(`StarterOnce: go ${p.goes.daily + 1} should give ${starter}, gave ${got.item}`);
      if (!starter && got.item === STARTER.beach.item) bad.push('StarterOnce: a beach from a normal draw');
      if (p.firstClawGoAt === null) p.firstClawGoAt = now;
    } else if (!got.item) bad.push('vending never misses');
    p.goes[m]++;
    p.free[m] = false;
    p.goesThisRest[m]++;
    return [...bad, ...this.grant(id, got)];
  }

  /** PaidDraw + PaidClaim: 200 and the price when the balance covers it, else 402 */
  paid(id: string, m: Machine, got: Prize): string[] {
    const p = this.p(id);
    if (p.bucks < this.price) return got.status === 402 ? [] : [`paid ${m}: expected 402, got ${got.status}`];
    if (got.status !== 200) return [`paid ${m}: expected 200, got ${got.status}`];
    p.bucks -= this.price;
    p.paidTries++;
    if (m === 'vending' && !got.item) return ['vending never misses'];
    return this.grant(id, got);
  }

  /** Tick: a day passes, both machines are free again */
  tick() {
    for (const p of this.players.values()) {
      p.free = { daily: true, vending: true };
      p.goesThisRest = { daily: 0, vending: 0 };
    }
  }

  /** the spec's invariants */
  check(): string[] {
    const bad: string[] = [];
    let holders = 0;
    for (const [id, p] of this.players) {
      for (const m of ['daily', 'vending'] as const) if (p.goesThisRest[m] > 1) bad.push(`OneGoPerRest ${id} ${m}`);
      // the starfish and deckchair are also normal prizes; the extra beach is only ever a gift
      if ((p.bag.get(STARTER.beach.item) ?? 0) > 1) bad.push(`StarterOnce ${id}: two beaches`);
      if (p.bucks !== this.startBucks - this.price * p.paidTries || p.bucks < 0) bad.push(`PaidInFull ${id}`);
      const u = p.bag.get(this.uniqueItem) ?? 0;
      if (u > 1) bad.push(`UniqueOnce ${id} has ${u}`);
      if (u > 0) {
        holders++;
        if (this.owner.get(this.uniqueItem) !== id) bad.push(`UniqueOnce ${id} holds it, owner ${this.owner.get(this.uniqueItem)}`);
      }
    }
    if (holders > 1) bad.push('UniqueOnce: in two bags');
    return bad;
  }
}
