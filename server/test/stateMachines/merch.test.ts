// The merch store's orders, against specs/tla/MerchOrders.tla
// (docs/MERCH_STORE.md, docs/STATE_MACHINES.md): paid once however Stripe
// tells us, never printed unpaid or after an early refund, always the beach
// as it was at checkout, and a late "completed" wins over "expired".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { beachPng } from '../../src/beachImage.js';
import { MERCH } from '../../src/merchCatalog.js';
import { beachBytes, rng, startServer, type Server } from './harness.js';
import { fakeServices, PRINTFUL_SECRET } from './merchFakes.js';
import { MerchModel, type Status } from './merchModel.js';

let s: Server;
let f: ReturnType<typeof fakeServices>;
beforeAll(async () => {
  f = fakeServices();
  s = await startServer({ merch: f.cfg });
});
afterAll(() => s.close());

const TEE = { product: 'tee', quantity: 1, color: 'white', size: 'M' };
let people = 0;
/** A shopper with a saved beach and a shore token (what store.beech.games holds). */
async function shopper() {
  const p = await s.signIn(`Shopper ${++people}`);
  await s.db.query('UPDATE beach SET sand = $1, nx = 16, ny = 16, location = $2 WHERE owner_id = $3', [beachBytes({}), 'bondi', p.id]);
  const [b] = await s.db.query<{ id: string }>('SELECT id FROM beach WHERE owner_id = $1', [p.id]);
  const r = await s.post('/item-submissions/connect', p.token);
  const { token } = (await r.json()) as { token: string };
  return { ...p, shore: token, beach: b.id };
}
async function checkout(lines: unknown[], shoreToken = '') {
  const r = await s.post('/merch/checkout', shoreToken, { lines });
  const out = (await r.json()) as { id?: string; url?: string; error?: string };
  return { status: r.status, ...out };
}
const sessionOf = async (id: string) => (await s.db.query<{ stripe_session: string }>('SELECT stripe_session FROM merch_orders WHERE id = $1', [id]))[0].stripe_session;
const statusOf = async (id: string) => (await s.db.query<{ status: Status }>('SELECT status FROM merch_orders WHERE id = $1', [id]))[0].status;
const hook = (type: string, object: unknown) => {
  const e = f.event(type, object, s.clock.now);
  return s.app.request('/merch/stripe-webhook', { method: 'POST', body: e.raw, headers: { 'Stripe-Signature': e.sig, 'Content-Type': 'application/json' } });
};
const page = (id: string) => s.req(`/merch/orders/${id}`);
const ext = (id: string) => id.replace(/-/g, '');
const shipped = (id: string) =>
  s.app.request(`/merch/printful-webhook?s=${PRINTFUL_SECRET}`, {
    method: 'POST',
    body: JSON.stringify({ type: 'package_shipped', data: { order: { external_id: ext(id) }, shipment: { carrier: 'USPS', tracking_number: '9400', tracking_url: 'https://t.example/9400' } } }),
    headers: { 'Content-Type': 'application/json' },
  });
const refundOf = (sessionId: string) => ({ id: 'ch_1', refunded: true, payment_intent: `pi_${sessionId}` });

describe('merch orders: transitions', () => {
  it('Checkout prices on the server and opens a Stripe session; nothing a shopper sends sets a price', async () => {
    const o = await checkout([{ ...TEE, quantity: 2, cents: 1 }]);
    expect(o.status).toBe(200);
    expect(o.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const [row] = await s.db.query<{ status: string; subtotal_cents: number; shipping_cents: number }>('SELECT * FROM merch_orders WHERE id = $1', [o.id]);
    expect(row).toMatchObject({ status: 'open', subtotal_cents: 6000, shipping_cents: MERCH.shippingCents });
    // refusals
    expect((await checkout([])).status).toBe(400);
    expect((await checkout([{ ...TEE, size: 'XS' }])).error).toBe('pick a size for the beech tee');
    expect((await checkout([{ ...TEE, quantity: 11 }])).status).toBe(400);
    expect((await checkout([{ product: 'yacht', quantity: 1 }])).status).toBe(400);
  });

  it('Completed: the webhook pays it, the send drafts and confirms it at Printful, with the logo for the colour', async () => {
    const o = await checkout([TEE, { product: 'hoodie', quantity: 1, color: 'navy', size: 'L' }]);
    const sid = await sessionOf(o.id!);
    expect((await hook('checkout.session.completed', f.pay(sid))).status).toBe(200);
    expect(await statusOf(o.id!)).toBe('sent');
    const pf = f.printful.get(ext(o.id!))!;
    expect(pf.status).toBe('pending');
    expect(pf.body.items.map((i) => [i.variant_id, i.files?.[0].url])).toEqual([
      [4012, 'https://store.example/merch-art/logo-front.png'],
      [5596, 'https://store.example/merch-art/logo-front-light.png'],
    ]);
    expect(pf.body.recipient).toMatchObject({ name: 'Sandy Shore', country_code: 'AU', zip: '2026' });
    // Ships
    expect((await shipped(o.id!)).status).toBe(200);
    const view = (await (await page(o.id!)).json()) as { status: string; tracking: { url: string } };
    expect(view).toMatchObject({ status: 'shipped', tracking: { url: 'https://t.example/9400' } });
  });

  it('OneReceipt: the webhook twice and the return page mark it paid once, and it is sent once', async () => {
    const o = await checkout([TEE]);
    const sid = await sessionOf(o.id!);
    const before = { ...f.calls };
    const done = f.pay(sid);
    await Promise.all([hook('checkout.session.completed', done), hook('checkout.session.completed', done), page(o.id!)]);
    expect(await statusOf(o.id!)).toBe('sent');
    expect(f.calls.gets - before.gets).toBe(1); // one send looked the order up at Printful
    expect(f.calls.confirms - before.confirms).toBe(1);
  });

  it('PaidIsFulfilled: Stripe’s "expired" then a late "completed": the order is paid and sent', async () => {
    const o = await checkout([TEE]);
    const sid = await sessionOf(o.id!);
    const paid = f.pay(sid);
    await hook('checkout.session.expired', { ...paid, status: 'expired', payment_status: 'unpaid' });
    expect(await statusOf(o.id!)).toBe('expired');
    await hook('checkout.session.completed', paid);
    expect(await statusOf(o.id!)).toBe('sent');
  });

  it('an expired checkout stays expired, and the order page says so', async () => {
    const o = await checkout([TEE]);
    const sid = await sessionOf(o.id!);
    await hook('checkout.session.expired', f.lapse(sid));
    expect(((await (await page(o.id!)).json()) as { status: string }).status).toBe('expired');
  });

  it('RefundIsFinal: a refund before "completed" arrives cancels it, and the late "completed" changes nothing', async () => {
    const o = await checkout([TEE]);
    const sid = await sessionOf(o.id!);
    const paid = f.pay(sid);
    await hook('charge.refunded', refundOf(sid)); // finds the order through the payment intent's metadata
    expect(await statusOf(o.id!)).toBe('canceled');
    await hook('checkout.session.completed', paid);
    expect(await statusOf(o.id!)).toBe('canceled');
    expect(f.printful.has(ext(o.id!))).toBe(false);
  });

  it('a refund after it was sent is a refund after production; a partial refund changes nothing', async () => {
    const o = await checkout([TEE]);
    const sid = await sessionOf(o.id!);
    await hook('checkout.session.completed', f.pay(sid));
    await hook('charge.refunded', { ...refundOf(sid), refunded: false });
    expect(await statusOf(o.id!)).toBe('sent');
    await hook('charge.refunded', refundOf(sid));
    expect(await statusOf(o.id!)).toBe('refunded');
  });

  it('NoPrintAfterEarlyRefund (TLC’s trace): a refund between the draft and Mark stops the confirm', async () => {
    const o = await checkout([TEE]);
    const sid = await sessionOf(o.id!);
    const before = f.calls.confirms;
    // the send pauses just before Mark (its draft is at Printful already)
    const gate = s.gate.pauseBefore(/SET status = 'sent'/);
    const paying = hook('checkout.session.completed', f.pay(sid));
    await gate.reached;
    expect(f.printful.get(ext(o.id!))?.status).toBe('draft');
    await hook('charge.refunded', refundOf(sid));
    gate.release();
    await paying;
    expect(await statusOf(o.id!)).toBe('canceled');
    expect(f.calls.confirms).toBe(before);
    expect(f.printful.get(ext(o.id!))?.status).toBe('draft');
  });

  it('Recover: Printful down leaves the claim; the sweep gives it back once stale and sends it', async () => {
    const o = await checkout([TEE]);
    const sid = await sessionOf(o.id!);
    f.state.printerUp = false;
    await hook('checkout.session.completed', f.pay(sid));
    expect(await statusOf(o.id!)).toBe('sending');
    f.state.printerUp = true;
    expect(await s.merch!.tick()).toMatchObject({ recovered: 0 }); // not stale yet
    expect(await statusOf(o.id!)).toBe('sending');
    s.clock.now += MERCH.staleClaimMs + 1000;
    expect(await s.merch!.tick()).toMatchObject({ recovered: 1, sent: 1 });
    expect(await statusOf(o.id!)).toBe('sent');
  });

  it('refuses a bad Stripe signature and a wrong Printful secret', async () => {
    const bad = await s.app.request('/merch/stripe-webhook', { method: 'POST', body: '{}', headers: { 'Stripe-Signature': 't=1,v1=00' } });
    expect(bad.status).toBe(400);
    const wrong = await s.app.request('/merch/printful-webhook?s=nope', { method: 'POST', body: '{}' });
    expect(wrong.status).toBe(404);
  });
});

describe('merch orders: your beach', () => {
  it('PrintIsWhatTheyBought: the print is the beach at checkout, not after more building', async () => {
    const me = await shopper();
    const before = beachBytes({ rock: 2 });
    await s.db.query('UPDATE beach SET sand = $1 WHERE id = $2', [before, me.beach]);
    const o = await checkout([{ product: 'beach-tee', quantity: 1, color: 'cream', size: 'L', beachId: me.beach }], me.shore);
    expect(o.status).toBe(200);
    // they keep building
    await s.db.query('UPDATE beach SET sand = $1 WHERE id = $2', [beachBytes({ rock: 9 }), me.beach]);
    await hook('checkout.session.completed', f.pay(await sessionOf(o.id!)));
    const item = f.printful.get(ext(o.id!))!.body.items[0];
    expect(item.variant_id).toBe(4153);
    const url = new URL(item.files![0].url);
    expect(url.origin).toBe('https://store.example');
    const key = url.pathname.replace('/api/print/', '');
    const png = new Uint8Array(await (await s.req(`/merch/print/${key}`)).arrayBuffer());
    const want = beachPng(before, { width: MERCH.printWidth, height: MERCH.printHeight, location: 'bondi', pier: false, sections: [] });
    expect(Buffer.from(png).equals(want)).toBe(true);
  });

  it('a beach print needs you signed in, and your own beach', async () => {
    const me = await shopper();
    const other = await shopper();
    const line = { product: 'beach-hoodie', quantity: 1, color: 'sand', size: 'M', beachId: other.beach };
    expect((await checkout([line])).status).toBe(401);
    expect((await checkout([line], me.shore)).status).toBe(403);
    expect((await checkout([{ ...line, beachId: undefined }], me.shore)).status).toBe(400);
    const mine = (await (await s.req('/merch/my-beaches', {}, me.shore)).json()) as { beaches: { id: string }[] };
    expect(mine.beaches.map((b) => b.id)).toEqual([me.beach]);
    expect((await s.req(`/merch/beach-preview/${other.beach}`, {}, me.shore)).status).toBe(404);
    expect((await s.req(`/merch/beach-preview/${me.beach}`, {}, me.shore)).headers.get('content-type')).toBe('image/png');
  });

  it('the set expands to all five, its price split so the slip adds up', async () => {
    const o = await checkout([
      { product: 'set', quantity: 1, parts: { tee: { color: 'aqua', size: 'S' }, hoodie: { color: 'sand', size: 'XL' }, hat: { color: 'navy' }, flipflops: { size: 'M' } } },
    ]);
    expect(o.status).toBe(200);
    await hook('checkout.session.completed', f.pay(await sessionOf(o.id!)));
    const items = f.printful.get(ext(o.id!))!.body.items;
    expect(items.map((i) => i.variant_id ?? `warehouse:${i.warehouse_product_variant_id}`)).toEqual([4021, 13000, 7857, 10171, 8874]);
    expect(items.reduce((sum, i) => sum + Math.round(Number(i.retail_price) * 100), 0)).toBe(16000);
    expect(items[2].files?.[0]).toEqual({ type: 'embroidery_front', url: 'https://store.example/merch-art/logo-hat-light.png' });
  });
});

describe('merch orders: random walk against the model', () => {
  it('server and model agree, and the rules hold, over 300 steps', async () => {
    const walk = await startServer({ merch: (f = fakeServices()).cfg });
    const prev = s;
    s = walk;
    try {
      const m = new MerchModel();
      const r = rng(20261127);
      const me = await shopper();
      const ids: string[] = [];
      const sids = new Map<string, string>();
      for (let step = 0; step < 300; step++) {
        const id = ids.length ? r.pick(ids) : '';
        const o = id ? m.orders.get(id)! : null;
        const sid = id ? sids.get(id)! : '';
        const act = ids.length < 2 ? 'checkout' : r.pick(['checkout', 'edit', 'pays', 'lapses', 'refund', 'hookCompleted', 'pageCompleted', 'hookExpired', 'hookRefunded', 'sweep', 'ships', 'printer'] as const);
        switch (act) {
          case 'checkout': {
            if (ids.length >= 6) break;
            const out = await checkout([{ product: 'beach-tee', quantity: 1, color: 'white', size: 'M', beachId: me.beach }], me.shore);
            expect(out.status).toBe(200);
            ids.push(out.id!);
            sids.set(out.id!, await sessionOf(out.id!));
            m.checkout(out.id!);
            break;
          }
          case 'edit':
            m.edit();
            await s.db.query('UPDATE beach SET sand = $1 WHERE id = $2', [beachBytes({ rock: m.beachV % 7 }), me.beach]);
            break;
          case 'pays':
            if (m.pays(id)) f.pay(sid);
            break;
          case 'lapses':
            if (m.lapses(id)) f.lapse(sid);
            break;
          case 'refund':
            m.refund(id);
            break;
          case 'hookCompleted':
            if (!o!.events.has('completed')) break;
            await hook('checkout.session.completed', f.sessions.get(sid));
            m.completed(id);
            break;
          case 'pageCompleted':
            // the return page asks Stripe only while the order looks unpaid
            await page(id);
            if (o!.stripe === 'paid') m.completed(id);
            break;
          case 'hookExpired':
            if (!o!.events.has('expired')) break;
            await hook('checkout.session.expired', f.sessions.get(sid));
            m.expired(id);
            break;
          case 'hookRefunded':
            if (!o!.events.has('refunded')) break;
            await hook('charge.refunded', refundOf(sid));
            m.refunded(id);
            break;
          case 'sweep':
            s.clock.now += MERCH.staleClaimMs + 1000;
            await s.merch!.tick();
            m.sweep();
            break;
          case 'ships':
            if (!f.printful.has(ext(id)) || f.printful.get(ext(id))!.status !== 'pending') break;
            await shipped(id);
            m.ships(id);
            break;
          case 'printer':
            m.printerUp = f.state.printerUp = !f.state.printerUp;
            break;
        }
        for (const x of ids) {
          expect(await statusOf(x), `step ${step} (${act}) order ${x}`).toBe(m.orders.get(x)!.status);
          const pf = f.printful.get(ext(x));
          expect(pf?.status === 'pending', `step ${step} printed ${x}`).toBe(m.orders.get(x)!.printed);
        }
        expect(m.check()).toBeNull();
      }
      // the walk reached the interesting places
      const seen = new Set([...m.orders.values()].map((o) => o.status));
      expect(seen.size).toBeGreaterThan(2);
    } finally {
      s = prev;
      await walk.close();
    }
  });
});
