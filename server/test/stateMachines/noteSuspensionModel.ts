// specs/tla/NoteSuspension.tla in TypeScript: the design that's built
// (Fixed = TRUE: the visit checks the suspension inside its transaction,
// under the sender's row lock). One method per action, returning the HTTP
// status the server should answer.

export interface ModelNote {
  hidden: boolean;
  /** ghost: it was accepted while its sender was suspended (must never happen) */
  sentSuspended: boolean;
}

export class NoteSuspensionModel {
  /** users.notes_suspended_until (null: never suspended, or lifted) */
  until: number | null = null;
  notes: ModelNote[] = [];
  /** ghost: suspended with "hide their notes", not lifted since */
  swept = false;

  suspended(now: number): boolean {
    return this.until !== null && this.until > now;
  }

  /** POST /beaches/:code/visit with a note (and maybe a rating) */
  visit(now: number, withNote: boolean): number {
    if (withNote && this.suspended(now)) return 403;
    if (withNote) this.notes.push({ hidden: false, sentSuspended: this.suspended(now) });
    return 200;
  }

  /** POST /api/senders/:id/suspend-notes */
  suspend(now: number, days: number, hide: boolean): number {
    this.until = now + days * 86400000;
    if (hide) for (const n of this.notes) n.hidden = true;
    this.swept = this.swept || hide;
    return 200;
  }

  /** POST /api/senders/:id/lift-notes (also what running out of time does, for `swept`) */
  lift(): number {
    this.until = null;
    this.swept = false;
    return 200;
  }

  /** time passes: a suspension that ran out counts as lifted */
  tick(now: number): void {
    if (this.until !== null && this.until <= now) {
      this.until = null;
      this.swept = false;
    }
  }

  /** the spec's invariants, as broken rules (empty: all hold) */
  check(): string[] {
    const bad: string[] = [];
    if (this.notes.some((n) => n.sentSuspended)) bad.push('NoNoteWhileSuspended');
    if (this.swept && this.notes.some((n) => !n.hidden)) bad.push('SweptStaysClean');
    return bad;
  }
}
