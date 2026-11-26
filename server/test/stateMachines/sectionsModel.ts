// specs/tla/InlandSections.tla in TypeScript: the design (Fixed = TRUE) for
// one player. Each method is one action; it returns the HTTP status the
// server should answer with and, when the action is allowed, applies it.
// Beaches are named by index (0 = home).

export const ROWS = 4;

export class SectionsModel {
  beaches: Set<number>;
  layout = new Map<number, string[]>();
  rev = new Map<number, number>();
  owned = new Map<string, number>();

  constructor(count: number) {
    this.beaches = new Set(Array.from({ length: count }, (_, i) => i));
    for (const b of this.beaches) {
      this.layout.set(b, []);
      this.rev.set(b, 0);
    }
  }

  placed(t: string): number {
    let n = 0;
    for (const b of this.beaches) n += this.layout.get(b)!.filter((x) => x === t).length;
    return n;
  }

  /** POST /store/buy (or a grant) */
  buy(t: string): number {
    this.owned.set(t, (this.owned.get(t) ?? 0) + 1);
    return 200;
  }

  /** POST /bag/trade-in: only a free one */
  tradeIn(t: string): number {
    const o = this.owned.get(t) ?? 0;
    if (o <= this.placed(t)) return 409;
    this.owned.set(t, o - 1);
    return 200;
  }

  /** DELETE /beaches/mine/:id: its rows go, the sections are back in the bag */
  deleteBeach(b: number): number {
    if (b === 0) return 400;
    this.beaches.delete(b);
    this.layout.delete(b);
    this.rev.delete(b);
    return 204;
  }

  /** PUT /beaches/mine/:id/sections {rows, rev} */
  write(b: number, rows: string[], rev: number): number {
    if (rows.length > ROWS) return 409;
    if (this.rev.get(b) !== rev) return 409;
    const here = this.layout.get(b)!;
    for (const t of new Set(rows)) {
      const n = (l: string[]) => l.filter((x) => x === t).length;
      if (this.placed(t) - n(here) + n(rows) > (this.owned.get(t) ?? 0)) return 409;
    }
    this.layout.set(b, [...rows]);
    this.rev.set(b, rev + 1);
    return 200;
  }

  /** the invariants (empty: all hold) */
  check(): string[] {
    const bad: string[] = [];
    for (const [t, o] of this.owned) if (this.placed(t) > o) bad.push(`PaidPlacement ${t}`);
    for (const b of this.beaches) if (this.layout.get(b)!.length > ROWS) bad.push(`RowsBound ${b}`);
    return bad;
  }
}
