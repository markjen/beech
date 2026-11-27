// specs/tla/MerchOrders.tla (Fixed = TRUE) in TypeScript: the design the
// server builds. One method per action; the random walk in merch.test.ts
// runs it next to the server and compares every order's status.
//
// The server sends a paid order on in the same request (the harness runs
// sends in line), so Completed here also does Claim, Draft, Mark and
// Confirm when Printful is up; when it's down the order waits in
// "sending" until the sweep (Recover, then the next send).
export type Status = 'open' | 'expired' | 'paid' | 'sending' | 'sent' | 'shipped' | 'canceled' | 'refunded';
export type Stripe = 'open' | 'paid' | 'expired';

export interface ModelOrder {
  status: Status;
  stripe: Stripe;
  refunded: boolean;
  events: Set<'completed' | 'expired' | 'refunded'>;
  printed: boolean;
  /** refunded before it was sent (NoPrintAfterEarlyRefund) */
  early: boolean;
  /** the beach version its print shows, and the version at checkout */
  design: number;
  drawn: number | null;
}

export class MerchModel {
  orders = new Map<string, ModelOrder>();
  beachV = 0;
  printerUp = true;

  checkout(id: string) {
    this.orders.set(id, { status: 'open', stripe: 'open', refunded: false, events: new Set(), printed: false, early: false, design: this.beachV, drawn: null });
  }
  edit() {
    this.beachV++;
  }
  pays(id: string) {
    const o = this.orders.get(id)!;
    if (o.stripe !== 'open') return false;
    o.stripe = 'paid';
    o.events.add('completed');
    return true;
  }
  lapses(id: string) {
    const o = this.orders.get(id)!;
    if (o.stripe !== 'open') return false;
    o.stripe = 'expired';
    o.events.add('expired');
    return true;
  }
  refund(id: string) {
    const o = this.orders.get(id)!;
    if (o.stripe !== 'paid' || o.refunded) return false;
    o.refunded = true;
    o.events.add('refunded');
    return true;
  }
  /** Completed (hook or page), then the send when Printful is up */
  completed(id: string) {
    const o = this.orders.get(id)!;
    if (o.status === 'open' || o.status === 'expired') {
      o.status = 'paid';
      this.send(o);
    }
  }
  expired(id: string) {
    const o = this.orders.get(id)!;
    if (o.status === 'open') o.status = 'expired';
  }
  refunded(id: string) {
    const o = this.orders.get(id)!;
    if (['open', 'expired', 'paid', 'sending'].includes(o.status)) {
      o.status = 'canceled';
      o.early = true;
    } else if (o.status === 'sent' || o.status === 'shipped') o.status = 'refunded';
  }
  private send(o: ModelOrder) {
    if (o.status !== 'paid') return;
    o.status = 'sending';
    if (!this.printerUp) return; // the draft failed: the claim stays until the sweep
    o.drawn ??= o.design;
    o.status = 'sent';
    o.printed = true;
  }
  /** the sweep, once the claim is stale: Recover, then send what's paid */
  sweep() {
    for (const o of this.orders.values()) if (o.status === 'sending') o.status = 'paid';
    for (const o of this.orders.values()) this.send(o);
  }
  ships(id: string) {
    const o = this.orders.get(id)!;
    if (o.printed && o.status === 'sent') o.status = 'shipped';
  }

  /** the spec's invariants */
  check(): string | null {
    for (const [id, o] of this.orders) {
      if (o.printed && o.stripe !== 'paid') return `${id}: printed but not paid`;
      if (o.early && o.printed) return `${id}: printed after an early refund`;
      if (o.drawn !== null && o.drawn !== o.design) return `${id}: print shows the wrong beach`;
    }
    return null;
  }
}
