// Shop orders and refunds, against specs/tla/ShopOrders.tla
// (docs/STATE_MACHINES.md). Fake app stores, Xsolla and Steam; the real
// server in-process, no rendering.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncSteamRefunds } from '../../src/steamStore.js';
import { signWebhook } from '../../src/xsolla.js';
import { rng, startServer, type Server } from './harness.js';
import { checkShop, NativeModel, SteamModel, XsollaModel, type Row } from './shopModel.js';

const SECRET = 'shop-test-secret';
const PACK = 'bucks_10';
const STEAM = { appId: '1', webApiKey: 'key', sandbox: false };
/** the fake stores' side of things */
const appStore = new Map<string, 'paid' | 'refunded'>();
const steamApproved = new Set<string>();
let xsollaOrder = 9000;

let s: Server;
beforeAll(async () => {
  s = await startServer({
    extra: {
      stores: {
        apple: async (jws: string) => {
          if (appStore.get(jws) !== 'paid') throw new Error('purchase was refunded');
          return { store: 'apple', transactionId: jws, productId: PACK, environment: 'Sandbox', purchasedAt: s.clock.now };
        },
        appleRefund: async (payload: string) => payload,
      },
      xsolla: { projectId: '1', apiKey: 'key', webhookSecret: SECRET, sandbox: false, returnUrl: 'https://play.beech.games/' },
      xsollaToken: async () => ({ token: 'test', orderId: String(xsollaOrder++) }),
      steamAuth: { appId: '1', webApiKey: 'key' },
      verifySteam: async (ticket: string, _cfg: unknown, name = '') => ({ provider: 'steam', sub: ticket, name }),
      steamStore: STEAM,
      steamTxn: {
        init: async (_cfg: unknown, args: { orderId: string }) => ({ transId: `steam-${args.orderId}` }),
        finalize: async (_cfg: unknown, id: string) => {
          if (!steamApproved.has(id)) throw new Error('not approved');
          return { transId: `steam-${id}` };
        },
      },
    } as never,
  });
});
afterAll(() => s.close());

let n = 0;
const bucks = async (id: string) =>
  Number((await s.db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [id]))[0].credit_cents) / 10;
const row = async (store: string, tx: string): Promise<Row> => {
  const r = (await s.db.query<{ refunded_at: string | null }>('SELECT refunded_at FROM purchases WHERE store = $1 AND transaction_id = $2', [store, tx]))[0];
  return !r ? 'none' : r.refunded_at === null ? 'granted' : 'revoked';
};

// app stores
async function nativeBuyer() {
  n++;
  const u = await s.signIn(`Shopper ${n}`);
  return { ...u, tx: `apple-${n}-${crypto.randomUUID()}` };
}
type NativeBuyer = Awaited<ReturnType<typeof nativeBuyer>>;
async function postPurchase(b: NativeBuyer) {
  const r = await s.post('/store/purchase', b.token, { platform: 'ios', productId: PACK, jws: b.tx });
  const j = (await r.json()) as { already?: boolean };
  return { status: r.status, already: j.already };
}
const refundNote = (b: NativeBuyer) => s.post('/store/apple/notifications', '', { signedPayload: b.tx });

// Xsolla
async function webOrder() {
  n++;
  const u = await s.signIn(`Web ${n}`);
  const r = await s.post('/store/web-checkout', u.token, { productId: PACK });
  expect(r.status).toBe(200);
  const order = ((await r.json()) as { order: string }).order;
  const provider = (await s.db.query<{ provider_order_id: string }>('SELECT provider_order_id FROM web_orders WHERE id = $1', [order]))[0].provider_order_id;
  return { ...u, order, provider };
}
type WebOrder = Awaited<ReturnType<typeof webOrder>>;
async function hook(o: WebOrder, type: 'order_paid' | 'refund' | 'order_canceled') {
  const payload = JSON.stringify(
    type === 'order_paid'
      ? {
          notification_type: type,
          items: [{ sku: PACK, quantity: 1, amount: '0.99', type: 'virtual_good' }],
          order: { id: Number(o.provider), mode: 'default', currency: 'USD', amount: '0.99', status: 'paid', platform: 'xsolla' },
          user: { external_id: o.id },
          custom_parameters: { web_order: o.order },
        }
      : { notification_type: type, order: { id: Number(o.provider) }, custom_parameters: { web_order: o.order } },
  );
  const r = await s.req('/store/xsolla/webhook', { method: 'POST', body: payload, headers: { Authorization: signWebhook(new TextEncoder().encode(payload), SECRET) } });
  return r.status;
}
const webStatus = async (o: WebOrder) => (await s.db.query<{ status: string }>('SELECT status FROM web_orders WHERE id = $1', [o.order]))[0].status;

// Steam
async function steamOrder() {
  n++;
  const r = await s.post('/auth/steam', '', { ticket: `7656119${String(n).padStart(10, '0')}`, name: `Steamer ${n}` });
  expect(r.status).toBe(200);
  const { token, user } = (await r.json()) as { token: string; user: { id: string } };
  const init = await s.post('/store/steam/init', token, { productId: PACK });
  expect(init.status).toBe(200);
  const orderId = ((await init.json()) as { orderId: string }).orderId;
  return { token, id: user.id, orderId, trans: `steam-${orderId}` };
}
type SteamOrder = Awaited<ReturnType<typeof steamOrder>>;
async function finalize(o: SteamOrder) {
  const r = await s.post('/store/steam/finalize', o.token, { orderId: o.orderId });
  const j = (await r.json().catch(() => ({}))) as { already?: boolean };
  return { status: r.status, already: j.already };
}
const steamCancel = (o: SteamOrder) => s.post('/store/steam/cancel', o.token, { orderId: o.orderId });
const steamSync = (o: SteamOrder) => syncSteamRefunds(s.db, STEAM, '2026-01-01T00:00:00Z', { getRefunds: async () => [o.trans], now: s.clock.now });
const steamStatus = async (o: SteamOrder) => (await s.db.query<{ status: string }>('SELECT status FROM steam_orders WHERE order_id = $1', [o.orderId]))[0].status;

/** run `first` until it is about to start its transaction, then `second`, then let `first` go */
async function beforeTransaction<T, U>(first: () => Promise<T>, second: () => Promise<U>) {
  const g = s.gate.pauseBefore(/^\b$/, { orTransaction: true });
  const a = first();
  await g.reached;
  const b = await second();
  g.release();
  return [await a, b] as const;
}

describe('shop: transitions', () => {
  it('NRecord: a purchase checked just before its refund and recorded just after grants nothing (the ShopOrders.cfg RefundIsFinal trace)', async () => {
    const b = await nativeBuyer();
    appStore.set(b.tx, 'paid');
    const [post, note] = await beforeTransaction(
      () => postPurchase(b),
      async () => {
        appStore.set(b.tx, 'refunded');
        return (await refundNote(b)).status;
      },
    );
    expect(note).toBe(200);
    expect(post.status).toBe(402);
    expect(await row('apple', b.tx)).toBe('none');
    expect(await bucks(b.id)).toBe(0);
  });

  it('NRecord and NNote: recorded, then refunded, then posted again: revoked, and "already"', async () => {
    const b = await nativeBuyer();
    appStore.set(b.tx, 'paid');
    const both = await Promise.all([postPurchase(b), postPurchase(b)]);
    expect(both.map((x) => x.already).sort()).toEqual([false, true]);
    expect(await bucks(b.id)).toBe(10);
    appStore.set(b.tx, 'refunded');
    expect((await refundNote(b)).status).toBe(200);
    expect(await row('apple', b.tx)).toBe('revoked');
    expect(await bucks(b.id)).toBe(0);
    expect((await postPurchase(b)).status).toBe(402); // the store says refunded
  });

  it('SFinGrant: a cancel while finalize is at Steam still grants what Steam charged (the PaidIsGranted trace)', async () => {
    const o = await steamOrder();
    steamApproved.add(o.orderId);
    const [fin, cancel] = await beforeTransaction(() => finalize(o), async () => (await steamCancel(o)).status);
    expect(cancel).toBe(204);
    expect(fin).toEqual({ status: 200, already: false });
    expect(await steamStatus(o)).toBe('paid');
    expect(await bucks(o.id)).toBe(10);
  });

  it('SSync: a refund synced while a canceled order is at Steam is final: the grant that follows is refused', async () => {
    const o = await steamOrder();
    steamApproved.add(o.orderId);
    const [fin] = await beforeTransaction(
      () => finalize(o),
      async () => {
        await steamCancel(o);
        await steamSync(o);
      },
    );
    expect(fin.status).toBe(409);
    expect(await steamStatus(o)).toBe('refunded');
    expect(await bucks(o.id)).toBe(0);
  });

  it('XPaidHook and XBackHook: repeats grant once; a refund before the payment is final', async () => {
    const a = await webOrder();
    expect(await Promise.all([hook(a, 'order_paid'), hook(a, 'order_paid')])).toEqual([204, 204]);
    expect(await bucks(a.id)).toBe(10);
    expect(await hook(a, 'refund')).toBe(204);
    expect([await webStatus(a), await bucks(a.id)]).toEqual(['refunded', 0]);
    const b = await webOrder();
    expect(await hook(b, 'order_canceled')).toBe(204);
    expect(await hook(b, 'order_paid')).toBe(204);
    expect([await webStatus(b), await bucks(b.id)]).toEqual(['canceled', 0]);
  });
});

describe('shop: random walks, server vs model', () => {
  for (const seed of [81, 82, 83, 84, 85, 86]) {
    it(`seed ${seed}: payments, retries, webhooks and refunds in any order agree with the model`, async () => {
      const r = rng(seed);
      for (let round = 0; round < 4; round++) {
        const nb = await nativeBuyer();
        const wo = await webOrder();
        const so = await steamOrder();
        const nm = new NativeModel();
        const xm = new XsollaModel();
        const sm = new SteamModel();
        const trace: string[] = [];
        for (let step = 0; step < 14; step++) {
          // every event that can happen now, on each way to pay
          const events: [string, () => Promise<string[]>][] = [];
          const expectPost = async () => {
            const got = await postPurchase(nb);
            const want = nm.post();
            return got.status === want.status && (want.already === undefined || got.already === want.already) ? [] : [`post ${JSON.stringify(got)} want ${JSON.stringify(want)}`];
          };
          if (nm.store === 'none') events.push(['n:pay', async () => (nm.pay(), appStore.set(nb.tx, 'paid'), [])]);
          if (nm.store === 'paid') events.push(['n:storeRefund', async () => (nm.storeRefund(), appStore.set(nb.tx, 'refunded'), [])]);
          if (nm.store !== 'none') events.push(['n:post', expectPost], ['n:post×2', async () => [...(await Promise.all([expectPost(), expectPost()])).flat()]]);
          if (nm.store === 'refunded') events.push(['n:note', async () => ((await refundNote(nb)).status === 200 ? (nm.refundNote(), []) : ['note'])]);
          if (xm.store === 'open') events.push(['x:pay', async () => ((xm.store = 'paid'), [])], ['x:cancel', async () => ((xm.store = 'canceled'), [])]);
          if (xm.store === 'paid') events.push(['x:refund', async () => ((xm.store = 'refunded'), [])]);
          if (xm.store === 'paid' || xm.store === 'refunded') events.push(['x:paidHook', async () => ((await hook(wo, 'order_paid')) === 204 ? (xm.paidHook(), []) : ['paidHook'])]);
          if (xm.store === 'refunded' || xm.store === 'canceled') events.push(['x:backHook', async () => ((await hook(wo, xm.store === 'canceled' ? 'order_canceled' : 'refund')) === 204 ? (xm.backHook(), []) : ['backHook'])]);
          if (sm.store === 'open') events.push(['s:approve', async () => ((sm.store = 'authorized'), steamApproved.add(so.orderId), [])], ['s:decline', async () => ((sm.store = 'declined'), [])]);
          if (sm.store === 'finalized') events.push(['s:refund', async () => ((sm.store = 'refunded'), steamApproved.delete(so.orderId), [])]);
          if (sm.store === 'refunded') events.push(['s:sync', async () => (await steamSync(so), sm.sync(), [])]);
          events.push(
            ['s:finalize', async () => {
              const got = await finalize(so);
              const want = sm.finalize();
              return got.status === want.status && (want.already === undefined || got.already === want.already) ? [] : [`finalize ${JSON.stringify(got)} want ${JSON.stringify(want)}`];
            }],
            ['s:cancel', async () => ((await steamCancel(so)).status === 204 ? (sm.cancel(), []) : ['cancel'])],
          );
          const [name, run] = r.pick(events);
          trace.push(name);
          const bad = [...(await run()), ...checkShop(nm, xm, sm)];
          expect(bad, trace.join(' ')).toEqual([]);
          expect(await row('apple', nb.tx), trace.join(' ')).toBe(nm.row);
          expect(await webStatus(wo), trace.join(' ')).toBe(xm.order);
          expect(await steamStatus(so), trace.join(' ')).toBe(sm.order);
          expect([await bucks(nb.id), await bucks(wo.id), await bucks(so.id)], trace.join(' ')).toEqual([
            nm.row === 'granted' ? 10 : 0,
            xm.live ? 10 : 0,
            sm.live ? 10 : 0,
          ]);
        }
      }
    });
  }
});
