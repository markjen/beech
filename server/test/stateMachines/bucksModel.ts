// The reference model for beech bucks and trade-ins: specs/tla/SandBucks.tla
// with Fixed = TRUE, one action at a time, for one bag item (a parasol, 10
// beech bucks) on one beach (docs/BEECH_BUCKS.md, docs/STATE_MACHINES.md). Each
// method returns what the server should answer.
export type BucksAnswer = { status: number; why?: string };

export class BucksModel {
  bal = 0;
  debt = 0;
  /** the bag's units, oldest first, by trade-in value (bucks) */
  units: number[] = [];
  placed = 0;
  /** packs bought and not refunded, oldest first (bucks each) */
  packs: number[] = [];
  freeIn = 0;
  giftOut = 0;

  private creditIn(n: number) {
    const paid = Math.min(this.debt, n);
    this.debt -= paid;
    this.bal += n - paid;
  }

  /** BuyPack */
  buyPack(n: number) {
    this.packs.push(n);
    this.creditIn(n);
  }

  /** RefundPack: the newest pack not refunded */
  refundPack(): number | null {
    const n = this.packs.pop();
    if (n === undefined) return null;
    const taken = Math.min(this.bal, n);
    this.bal -= taken;
    this.debt += n - taken;
    return n;
  }

  /** Spend: buy one parasol for `price` (full price: promo codes never discount a credit purchase) */
  spend(price: number): BucksAnswer {
    if (this.bal < price) return { status: 402 };
    this.bal -= price;
    this.units.push(price);
    return { status: 200 };
  }

  /** FreeGrant: a free one, at its list value */
  freeGrant(value: number) {
    this.units.push(value);
    this.freeIn += value;
  }

  /** GiftOut: the oldest unit goes (gifts don't look at what's placed) */
  giftOut1(): BucksAnswer {
    const v = this.units.shift();
    if (v === undefined) return { status: 409 };
    this.giftOut += v;
    return { status: 200 };
  }

  /** Save: put `k` on the beach (an item may stay at what it held; past that, the bag must cover it) */
  save(k: number): BucksAnswer {
    if (k > this.placed && k > this.units.length) return { status: 409, why: 'short' };
    this.placed = k;
    return { status: 200 };
  }

  /** TradeAtomic: the newest unit that isn't on the beach */
  tradeIn(): BucksAnswer & { credited?: number } {
    if (this.units.length - this.placed < 1) return { status: 409 };
    const v = this.units.pop()!;
    this.creditIn(v);
    return { status: 200, credited: v };
  }

  held(): number {
    return this.units.reduce((t, v) => t + v, 0);
  }

  invariants(): string[] {
    const bad: string[] = [];
    if (this.bal - this.debt + this.held() !== this.packs.reduce((t, n) => t + n, 0) + this.freeIn - this.giftOut) bad.push('ValueConserved');
    if (this.bal < 0 || this.debt < 0) bad.push('NoNegative');
    return bad;
  }
}
