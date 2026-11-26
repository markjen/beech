// The reference model for copying a beach: specs/tla/BeachCopy.tla with
// Fixed = TRUE, one action at a time, for one bag item (docs/COPY_BEACH.md,
// docs/STATE_MACHINES.md). Each method returns what the server should answer:
// a status and, for a refusal, which one.
export type CopyAnswer = { status: number; why?: 'short' | 'changed' | 'room' | 'gone' };
export type Mode = 'strict' | 'drop-missing';

export class CopyModel {
  /** the copier's beaches and how many of the item each holds */
  stored = new Map<string, number>();
  owned = 0;
  /** the source beach */
  sver = 0;
  spub = true;
  sitems = 0;

  constructor(
    home: string,
    readonly allowance: number,
  ) {
    this.stored.set(home, 0);
  }

  elsewhere(b: string | null): number {
    let n = 0;
    for (const [x, k] of this.stored) if (x !== b) n += k;
    return n;
  }

  /** Save: the copier's device saves one of their beaches */
  save(b: string, k: number): CopyAnswer {
    const held = this.stored.get(b) ?? 0;
    if (k > held && k > this.owned - this.elsewhere(b)) return { status: 409, why: 'short' };
    this.stored.set(b, k);
    return { status: 200 };
  }

  /** SourceEdit: the owner saves a new version */
  sourceEdit(k: number) {
    this.sver++;
    this.sitems = k;
  }

  /** SourceShore: an admin hides it, or puts it back */
  sourceShore(pub: boolean) {
    this.spub = pub;
  }

  /** Buy: a store grant */
  buy() {
    this.owned++;
  }

  /**
   * CopyAtomic: POST /beaches/mine/copy. `target` null = a new beach, whose id
   * the caller passes as `made` once the server has answered.
   */
  copy(target: string | null, pin: number, mode: Mode): CopyAnswer & { writes?: number } {
    if (!this.spub) return { status: 404, why: 'gone' };
    if (pin !== this.sver) return { status: 409, why: 'changed' };
    if (target === null && this.stored.size >= this.allowance) return { status: 409, why: 'room' };
    const avail = Math.max(0, this.owned - this.elsewhere(target));
    if (this.sitems > avail && mode === 'strict') return { status: 409, why: 'short' };
    return { status: 200, writes: Math.min(this.sitems, avail) };
  }

  /** apply a copy the server accepted */
  land(beach: string, writes: number) {
    this.stored.set(beach, writes);
  }

  invariants(): string[] {
    const bad: string[] = [];
    if (this.elsewhere(null) > this.owned) bad.push('WithinBag');
    if (this.stored.size > this.allowance) bad.push('WithinAllowance');
    return bad;
  }
}
