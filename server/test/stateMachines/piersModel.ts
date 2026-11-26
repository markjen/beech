// specs/tla/Piers.tla in TypeScript: the design (Fixed = TRUE) for one
// player. Each method is one action; it returns the HTTP status the server
// should answer with and, when the action is allowed, applies it.
//
// Beaches are named by index (0 = home). A link [l, r] means r is
// immediately right of l. `owned` is the piers in the player's inventory,
// `site` the beaches holding one (beach_piers rows).

export class PiersModel {
  beaches: Set<number>;
  links = new Set<string>();
  owned = 0;
  site = new Set<number>();

  constructor(count: number) {
    this.beaches = new Set(Array.from({ length: count }, (_, i) => i));
  }

  private key = (l: number, r: number) => `${l}>${r}`;
  has(l: number, r: number): boolean {
    return this.links.has(this.key(l, r));
  }
  rightOf(b: number): number | null {
    for (const k of this.links) if (k.startsWith(`${b}>`)) return Number(k.split('>')[1]);
    return null;
  }
  leftOf(b: number): number | null {
    for (const k of this.links) if (k.endsWith(`>${b}`)) return Number(k.split('>')[0]);
    return null;
  }

  /** a beach of the player's on each side (one owner here, so any link counts) */
  eligible(b: number): boolean {
    if (!this.beaches.has(b)) return false;
    const l = this.leftOf(b);
    const r = this.rightOf(b);
    return l !== null && r !== null && l !== r;
  }
  get attached(): number {
    return this.site.size;
  }
  /** what the app shows: 'active', 'paused', or null */
  pier(b: number): 'active' | 'paused' | null {
    if (!this.site.has(b)) return null;
    return this.eligible(b) ? 'active' : 'paused';
  }

  /** PUT /neighbors/right?beach=l with r's code */
  link(l: number, r: number): number {
    if (l === r) return 400;
    if (this.rightOf(l) !== null) return 409;
    if (this.leftOf(l) === r) return 409;
    if (this.leftOf(r) !== null) return 409;
    if (this.has(r, l)) return 409;
    this.links.add(this.key(l, r));
    return 200;
  }

  /** DELETE /neighbors/right?beach=l */
  unlink(l: number): number {
    const r = this.rightOf(l);
    if (r !== null) this.links.delete(this.key(l, r));
    return 204;
  }

  /** DELETE /beaches/mine/:id (its links and pier cascade) */
  deleteBeach(b: number): number {
    if (b === 0) return 400;
    this.beaches.delete(b);
    for (const k of [...this.links]) {
      const [l, r] = k.split('>').map(Number);
      if (l === b || r === b) this.links.delete(k);
    }
    this.site.delete(b);
    return 204;
  }

  /** a pier into the bag (POST /store/buy, or a grant) */
  buy(): number {
    this.owned++;
    return 200;
  }

  /** POST /bag/trade-in { item: 'pier' } */
  tradeIn(): number {
    if (this.owned <= this.attached) return 409;
    this.owned--;
    return 200;
  }

  /** PUT /beaches/mine/:id/pier */
  land(b: number): number {
    if (!this.eligible(b) || this.site.has(b) || this.attached >= this.owned) return 409;
    this.site.add(b);
    return 200;
  }

  /** DELETE /beaches/mine/:id/pier */
  lift(b: number): number {
    if (!this.site.delete(b)) return 404;
    return 200;
  }

  /** the spec's invariants that hold over this state */
  check(): string[] {
    const bad: string[] = [];
    if (this.attached > this.owned) bad.push('PaidAttachment');
    for (const b of this.site) if (!this.beaches.has(b)) bad.push('NoOrphan');
    return bad;
  }
}
