// The reference model for checkpoints: specs/tla/Checkpoints.tla with
// Fixed = TRUE (docs/STATE_MACHINES.md). One player, one beach; every
// checkpoint is one unit of bytes. Each method returns the status the
// server should answer.
export class CheckpointsModel {
  named = 0;
  slot = 0;
  overfilled = false;
  constructor(
    readonly limit: number,
    /** the store's room, in units, past what's already there */
    readonly cap: number,
  ) {}

  used() {
    return this.named + this.slot;
  }

  /** MakeCheck (a named checkpoint): 201, 409 at the limit, 413 when full */
  make(): number {
    if (this.named >= this.limit) return 409;
    if (this.used() + 1 > this.cap) return 413;
    this.named++;
    return 201;
  }

  /**
   * AutoCheck through POST /beaches/mine/:id/checkpoints { auto }: that route
   * counts the slot it replaces too (it is stricter than the save path's copy)
   */
  autoCopy(): number {
    if (this.used() + 1 > this.cap) return 413;
    this.slot = 1;
    return 201;
  }

  /** Restore: the beach's slot takes what was there, unchecked */
  restore(): number {
    this.slot = 1;
    return 200;
  }

  deleteNamed() {
    if (this.named > 0) this.named--;
  }

  /** the spec's invariants */
  check(): string[] {
    const bad: string[] = [];
    if (this.named > this.limit) bad.push('NamedWithinLimit');
    if (this.overfilled) bad.push('FitsWhenAdded');
    return bad;
  }
}
