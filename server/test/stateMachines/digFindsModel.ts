// The reference model for buried finds: specs/tla/DigFinds.tla with
// Fixed = TRUE (docs/STATE_MACHINES.md). One player; each dig is taken
// atomically at its own `now` and returns the status the server should give.
import { pullDay } from '../../src/pulls.js';

export class DigFindsModel {
  day = '';
  finds = 0;
  last = -Infinity;
  /** ghost: finds granted on each UTC day */
  granted = new Map<string, number>();
  /** ghost: when rolls were recorded */
  rolls: number[] = [];
  constructor(
    readonly cap: number,
    readonly cooldown: number,
  ) {}

  findsOn(now: number) {
    return this.day === pullDay(now) ? this.finds : 0;
  }

  /** Roll + Write: 409 at the cap or within the cooldown, else 200 (found or not) */
  dig(now: number, found: boolean): number {
    if ((found && this.findsOn(now) >= this.cap) || now - this.last < this.cooldown) return 409;
    this.finds = this.findsOn(now) + (found ? 1 : 0);
    this.day = pullDay(now);
    this.last = now;
    this.rolls.push(now);
    if (found) this.granted.set(this.day, (this.granted.get(this.day) ?? 0) + 1);
    return 200;
  }

  /** a roll the server would refuse before rolling (the early 409) */
  refusedEarly(now: number) {
    return this.findsOn(now) >= this.cap || now - this.last < this.cooldown;
  }

  /** the spec's invariants */
  check(): string[] {
    const bad: string[] = [];
    for (const [d, n] of this.granted) if (n > this.cap) bad.push(`CapHolds ${d}: ${n}`);
    const t = [...this.rolls].sort((a, b) => a - b);
    for (let i = 1; i < t.length; i++) if (t[i] - t[i - 1] < this.cooldown) bad.push(`OneRollPerCooldown ${t[i - 1]} ${t[i]}`);
    if (this.day && this.finds !== (this.granted.get(this.day) ?? 0)) bad.push('Counted');
    return bad;
  }
}
