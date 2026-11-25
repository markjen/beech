// The reference model for editing beaches: specs/tla/BeachEditing.tla with
// Fixed = TRUE, one action at a time, for one bag item (docs/STATE_MACHINES.md).
// Each method returns what the server should answer: a status and, for a
// 409, which refusal ('fenced' | 'restored' | 'short').
export type Device = 'd1' | 'd2';
export type Answer = { status: number; why?: 'fenced' | 'restored' | 'short' };

export class EditingModel {
  tok: Device | null = null;
  epoch: Record<string, number> = {};
  stored: Record<string, number> = {};
  seen: Record<Device, Record<string, number>> = { d1: {}, d2: {} };
  owned = 0;
  badWrite = false;

  constructor(readonly beaches: string[]) {
    for (const b of beaches) {
      this.epoch[b] = 0;
      this.stored[b] = 0;
      this.seen.d1[b] = 0;
      this.seen.d2[b] = 0;
    }
  }

  elsewhere(b: string): number {
    return this.beaches.filter((x) => x !== b).reduce((n, x) => n + this.stored[x], 0);
  }

  /** Claim: POST /edit-session */
  claim(d: Device) {
    this.tok = d;
  }

  /** Load: GET /beaches/mine/:id/sand (the device learns the epoch) */
  load(d: Device, b: string) {
    this.seen[d][b] = this.epoch[b];
  }

  /** SaveStart .. SaveAtomic: PUT /beaches/mine/:id/sand */
  save(d: Device, b: string, n: number): Answer {
    if (this.tok !== d) return { status: 409, why: 'fenced' };
    if (this.epoch[b] > this.seen[d][b]) return { status: 409, why: 'restored' };
    if (n > this.stored[b] && n > this.owned - this.elsewhere(b)) return { status: 409, why: 'short' };
    this.stored[b] = n;
    return { status: 200 };
  }

  /** RestoreStart .. RestoreAtomic: POST /beaches/mine/:id/restore (strict) */
  restore(d: Device, b: string, n: number): Answer {
    if (this.tok !== d) return { status: 409, why: 'fenced' };
    if (n > this.owned - this.elsewhere(b)) return { status: 409, why: 'short' };
    this.stored[b] = n;
    this.epoch[b]++;
    this.seen[d][b] = this.epoch[b]; // the reply carries the new epoch
    return { status: 200 };
  }

  invariants(): string[] {
    const bad: string[] = [];
    if (this.beaches.reduce((n, b) => n + this.stored[b], 0) > this.owned) bad.push('WithinBag');
    if (this.badWrite) bad.push('OnlyEditorWrites');
    return bad;
  }
}
