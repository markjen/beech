// specs/tla/PromoBucks.tla in TypeScript: the design that's built (Fixed =
// TRUE: a claim checks and writes in one transaction holding the code's row
// lock). One code; one method per action, returning what the server should
// answer. Bonus amounts are in bucks.

export interface PromoUse {
  player: string;
  way: 'redeem' | 'pack';
}

export class PromoModel {
  active = true;
  uses = 0;
  useRows: PromoUse[] = [];
  /** bonus bucks credited, net of clawbacks */
  bal = new Map<string, number>();
  order = new Map<string, 'created' | 'paid' | 'refunded'>();
  bonused = new Set<string>();

  constructor(
    readonly maxUses: number,
    /** what the code gives, on its own or with the pack */
    readonly bonus: number,
  ) {}

  private usedBy(p: string): boolean {
    return this.useRows.some((u) => u.player === p);
  }
  private good(p: string): boolean {
    return this.active && this.uses < this.maxUses && !this.usedBy(p);
  }
  private claim(p: string, way: PromoUse['way']): void {
    this.useRows.push({ player: p, way });
    this.uses++;
    this.bal.set(p, (this.bal.get(p) ?? 0) + this.bonus);
  }

  /** POST /codes/redeem: 200, or 409 when the code isn't good for them */
  redeem(p: string): number {
    if (!this.good(p)) return 409;
    this.claim(p, 'redeem');
    return 200;
  }

  /** POST /store/web-checkout with the code: 200 (kept on the order), or 400 */
  checkout(p: string): number {
    if (this.order.has(p) || !this.good(p)) return 400;
    this.order.set(p, 'created');
    return 200;
  }

  /** Xsolla order_paid: the pack always; the bonus if the code is still good */
  pay(p: string): void {
    if (this.order.get(p) !== 'created') return;
    this.order.set(p, 'paid');
    if (this.good(p)) {
      this.claim(p, 'pack');
      this.bonused.add(p);
    }
  }

  /** Xsolla refund: the pack's bonus comes back out; the use stays spent */
  refund(p: string): void {
    if (this.order.get(p) !== 'paid') return;
    this.order.set(p, 'refunded');
    if (this.bonused.has(p)) this.bal.set(p, (this.bal.get(p) ?? 0) - this.bonus);
  }

  disable(): void {
    this.active = false;
  }

  /** the spec's invariants, as broken rules (empty: all hold) */
  check(players: string[]): string[] {
    const bad: string[] = [];
    if (this.uses > this.maxUses) bad.push('WithinCap');
    if (players.some((p) => this.useRows.filter((u) => u.player === p).length > 1)) bad.push('OncePerPlayer');
    if (this.uses !== this.useRows.length) bad.push('UsesCounted');
    for (const p of players) {
      const want = (this.useRows.some((u) => u.player === p && u.way === 'redeem') ? this.bonus : 0) + (this.bonused.has(p) && this.order.get(p) === 'paid' ? this.bonus : 0);
      if ((this.bal.get(p) ?? 0) !== want) bad.push(`BonusExplained(${p})`);
    }
    return bad;
  }
}
