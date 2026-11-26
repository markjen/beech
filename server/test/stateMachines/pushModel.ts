// specs/tla/Push.tla in TypeScript (the design built: Fixed = TRUE), one
// player and their devices, one action at a time. With the lock held from
// the claim to the end of the sends, a whole push is one step here.
// Where the spec abstracts (an hour, quiet hours, a row's freshness), this
// follows the code's numbers (server/src/push.ts).
import { PUSH_EVERY_MS, PUSH_FRESH_MS, PUSH_KINDS, isQuiet, pushMessage, type NotifyPref } from '../../src/push.js';

export type Device = 'd1' | 'd2';
export type Actor = 'ben' | 'cat';
export type Kind = 'gift' | 'neighbor_request' | 'star';
export const DEVICES: Device[] = ['d1', 'd2'];
export const ACTORS: Actor[] = ['ben', 'cat'];
export const KINDS: Kind[] = ['gift', 'neighbor_request', 'star'];
export const PREFS: NotifyPref[] = ['gifts', 'neighbors'];

interface Row {
  id: number;
  actor: Actor;
  kind: Kind;
  at: number;
  read: boolean;
  pushed: boolean;
}

export class PushModel {
  rows: Row[] = [];
  blocked = new Set<Actor>();
  muted = new Set<NotifyPref>();
  signedIn = new Set<Device>();
  subs = new Set<Device>();
  expired = new Set<Device>();
  lastPush = 0;
  /** every push that reached a device: "d1: ben left you something" */
  delivered: string[] = [];

  constructor(public now: number, private readonly names: Record<Actor, string>) {}

  arrive(id: number, actor: Actor, kind: Kind) {
    this.rows.push({ id, actor, kind, at: this.now, read: false, pushed: false });
  }
  /** POST /inbox/read { upTo } */
  read(upTo: number) {
    for (const r of this.rows) if (r.id <= upTo) r.read = true;
  }
  block(a: Actor) {
    this.blocked.add(a);
  }
  unblock(a: Actor) {
    this.blocked.delete(a);
  }
  setPref(p: NotifyPref, on: boolean) {
    if (on) this.muted.delete(p);
    else this.muted.add(p);
  }
  signIn(d: Device) {
    this.signedIn.add(d);
  }
  /** 204 when signed in; the server answers 401 otherwise */
  subscribe(d: Device): number {
    if (!this.signedIn.has(d)) return 401;
    this.subs.add(d);
    this.expired.delete(d);
    return 204;
  }
  unsubscribe(d: Device): number {
    if (!this.signedIn.has(d)) return 401;
    this.subs.delete(d);
    return 204;
  }
  signOut(d: Device): number {
    if (!this.signedIn.has(d)) return 401;
    this.signedIn.delete(d);
    this.subs.delete(d);
    return 204;
  }
  expire(d: Device) {
    if (this.subs.has(d)) this.expired.add(d);
  }

  /** Claim, Deliver (each device), Finish: what one tick does for the player */
  push(): string[] {
    const out: string[] = [];
    if (!this.subs.size) return out;
    if (this.now - this.lastPush < PUSH_EVERY_MS) return out;
    if (isQuiet('UTC', this.now)) return out;
    const due = this.rows.filter((r) => !r.pushed && r.kind in PUSH_KINDS);
    if (!due.length) return out;
    for (const r of due) r.pushed = true;
    const shown = due.filter(
      (r) => !r.read && this.now - r.at < PUSH_FRESH_MS && !this.blocked.has(r.actor) && !this.muted.has(PUSH_KINDS[r.kind as keyof typeof PUSH_KINDS]),
    );
    if (!shown.length) return out;
    this.lastPush = this.now;
    const body = pushMessage(shown.map((r) => ({ kind: r.kind, name: this.names[r.actor] }))).body;
    for (const d of [...this.subs].sort()) {
      if (this.expired.has(d)) {
        this.subs.delete(d);
        this.expired.delete(d);
      } else out.push(`${d}: ${body}`);
    }
    this.delivered.push(...out);
    return out;
  }
}
