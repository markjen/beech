// The reference model for shop orders and refunds: specs/tla/ShopOrders.tla
// with Fixed = TRUE (docs/STATE_MACHINES.md). One purchase per way to pay;
// each method is one request or event, taken atomically, and returns the
// status the server should answer.

export type Row = 'none' | 'granted' | 'revoked';

/** App stores (Apple, Google): the store's side and our purchases row */
export class NativeModel {
  store: 'none' | 'paid' | 'refunded' = 'none';
  row: Row = 'none';
  tomb = false;
  note = false;
  grants = 0;
  answered = false;

  pay() {
    this.store = 'paid';
  }
  storeRefund() {
    this.store = 'refunded';
  }
  /** POST /store/purchase: NCheck then NRecord */
  post(): { status: number; already?: boolean } {
    this.answered = true;
    if (this.store !== 'paid') return { status: 402 };
    if (this.row !== 'none') return { status: 200, already: true };
    if (this.tomb) return { status: 402 };
    this.row = 'granted';
    this.grants++;
    return { status: 200, already: false };
  }
  /** NNote */
  refundNote() {
    this.note = true;
    this.tomb = true;
    if (this.row === 'granted') this.row = 'revoked';
  }
}

export class XsollaModel {
  store: 'open' | 'paid' | 'refunded' | 'canceled' = 'open';
  order: 'created' | 'paid' | 'refunded' | 'canceled' = 'created';
  grants = 0;
  live = false;
  paidSeen = false;
  backSeen = false;
  /** XPaidHook */
  paidHook() {
    this.paidSeen = true;
    if (this.order === 'created') {
      this.order = 'paid';
      this.grants++;
      this.live = true;
    }
  }
  /** XBackHook */
  backHook() {
    this.backSeen = true;
    if (this.order === 'paid') this.order = 'refunded';
    else if (this.order === 'created') this.order = 'canceled';
    this.live = false;
  }
}

export class SteamModel {
  store: 'open' | 'authorized' | 'declined' | 'finalized' | 'refunded' = 'open';
  order: 'created' | 'paid' | 'refunded' | 'canceled' = 'created';
  grants = 0;
  live = false;
  answered = false;
  synced = false;
  /** SFinRead + SFinSteam + SFinGrant */
  finalize(): { status: number; already?: boolean } {
    if (this.order === 'paid') return { status: 200, already: true };
    if (this.order !== 'created') return { status: 409 };
    if (this.store !== 'authorized' && this.store !== 'finalized') return { status: 402 };
    this.store = 'finalized';
    this.answered = true;
    this.order = 'paid';
    this.grants++;
    this.live = true;
    return { status: 200, already: false };
  }
  cancel() {
    if (this.order === 'created') this.order = 'canceled';
  }
  sync() {
    this.synced = true;
    if (this.order !== 'refunded') this.order = 'refunded';
    this.live = false;
  }
}

/** the spec's invariants over one purchase of each kind */
export function checkShop(n: NativeModel, x: XsollaModel, s: SteamModel): string[] {
  const bad: string[] = [];
  if (n.grants > 1 || x.grants > 1 || s.grants > 1) bad.push('GrantedOnce');
  if (n.note && n.row === 'granted') bad.push('RefundIsFinal native');
  if (x.backSeen && x.live) bad.push('RefundIsFinal xsolla');
  if (s.synced && s.live) bad.push('RefundIsFinal steam');
  if (n.store === 'paid' && n.answered && n.row !== 'granted') bad.push('PaidIsGranted native');
  if (x.store === 'paid' && x.paidSeen && !x.live) bad.push('PaidIsGranted xsolla');
  if (s.store === 'finalized' && s.answered && !s.live) bad.push('PaidIsGranted steam');
  return bad;
}
