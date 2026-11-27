// Promo codes give bonus beech bucks, never a discount, against
// specs/tla/PromoBucks.tla (docs/GIFT_CARDS_PROMOS.md, docs/STATE_MACHINES.md).
// Fast: the real server in-process, web checkout faked, webhooks signed the
// way Xsolla signs them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signWebhook, type XsollaConfig } from '../../src/xsolla.js';
import { rng, startServer, type Server } from './harness.js';
import { PromoModel } from './promoModel.js';

const SECRET = 'webhook-secret';
const LIVE: XsollaConfig = { projectId: '1234', apiKey: 'api-key', webhookSecret: SECRET, sandbox: false, returnUrl: 'https://beech.example/' };
let s: Server;
let xsollaOrder = 9000;
beforeAll(async () => {
  s = await startServer({
    extra: { xsolla: LIVE, xsollaToken: async (_cfg, req) => ({ token: `tok-${req.webOrderId}`, orderId: String(xsollaOrder++) }) },
  });
});
afterAll(() => s.close());

let n = 0;
let codeN = 0;
const person = (label: string) => s.signIn(`${label} ${++n}`);
type Who = Awaited<ReturnType<typeof person>>;
/** a fresh code: `bonus` bucks, at most `maxUses` uses */
async function code(bonus: number, maxUses: number | null) {
  const c = `WALK${++codeN}X`;
  await s.db.query('INSERT INTO promo_codes (code, kind, value, max_uses, active, created_at) VALUES ($1, $2, $3, $4, true, 0)', [c, 'bucks', bonus, maxUses]);
  return c;
}
const redeem = (w: Who, c: string) => s.post('/codes/redeem', w.token, { code: c });
async function checkout(w: Who, c: string) {
  const r = await s.post('/store/web-checkout', w.token, { productId: 'bucks_10', promoCode: c });
  if (r.status !== 200) return { status: r.status, order: null as string | null };
  const { order } = (await r.json()) as { order: string };
  return { status: 200, order };
}
async function webhook(payload: unknown) {
  const raw = JSON.stringify(payload);
  const r = await s.app.request('/store/xsolla/webhook', { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', Authorization: signWebhook(raw, SECRET) } });
  expect(r.status).toBe(204);
}
async function providerId(order: string) {
  return (await s.db.query<{ provider_order_id: string }>('SELECT provider_order_id FROM web_orders WHERE id = $1', [order]))[0].provider_order_id;
}
async function pay(w: Who, order: string) {
  const id = Number(await providerId(order));
  await webhook({
    notification_type: 'order_paid',
    items: [{ sku: 'bucks_10', quantity: 1, amount: '0.99' }],
    order: { id, mode: 'default', currency: 'USD', amount: '0.99', status: 'paid' },
    user: { external_id: w.id },
    custom_parameters: { web_order: order },
  });
}
async function refund(w: Who, order: string) {
  const id = Number(await providerId(order));
  await webhook({ notification_type: 'refund', items: [{ sku: 'bucks_10', quantity: 1 }], order: { id }, user: { external_id: w.id }, custom_parameters: { web_order: order } });
}
/** bonus bucks in, net of clawbacks (packs left out) */
async function bonusOf(w: Who) {
  const r = await s.db.query<{ c: string | null }>("SELECT SUM(amount_cents) AS c FROM credit_ledger WHERE user_id = $1 AND kind IN ('promo_bonus', 'promo_bonus_refund')", [w.id]);
  return Number(r[0].c ?? 0) / 10;
}
const usesOf = async (c: string) => Number((await s.db.query<{ uses: number }>('SELECT uses FROM promo_codes WHERE code = $1', [c]))[0].uses);
const useRowsOf = async (c: string) => Number((await s.db.query<{ n: string }>('SELECT COUNT(*) AS n FROM promo_uses WHERE code = $1', [c]))[0].n);

describe('promo bucks: transitions', () => {
  it('Redeem: once each, up to the cap', async () => {
    const c = await code(5, 2);
    const [a, b, d] = [await person('A'), await person('B'), await person('D')];
    expect((await redeem(a, c)).status).toBe(200);
    expect((await redeem(a, c)).status).toBe(409);
    expect((await redeem(b, c)).status).toBe(200);
    expect((await redeem(d, c)).status).toBe(409);
    expect([await bonusOf(a), await bonusOf(b), await bonusOf(d), await usesOf(c)]).toEqual([5, 5, 0, 2]);
  });

  it('Checkout keeps the code without using it; Pay uses it; Refund takes the bonus back', async () => {
    const c = await code(7, 1);
    const a = await person('A');
    const o = await checkout(a, c);
    expect(o.status).toBe(200);
    expect(await usesOf(c)).toBe(0);
    await pay(a, o.order!);
    expect([await bonusOf(a), await usesOf(c)]).toEqual([7, 1]);
    await refund(a, o.order!);
    expect([await bonusOf(a), await usesOf(c)]).toEqual([0, 1]);
  });

  it('Pay after Disable: the pack, no bonus', async () => {
    const c = await code(7, null);
    const a = await person('A');
    const o = await checkout(a, c);
    await s.db.query('UPDATE promo_codes SET active = false WHERE code = $1', [c]);
    await pay(a, o.order!);
    expect([await bonusOf(a), await usesOf(c)]).toEqual([0, 0]);
    expect(Number((await s.db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [a.id]))[0].credit_cents)).toBe(100);
  });
});

describe('promo bucks: replays of PromoBucks.cfg', () => {
  it('WithinCap: a redeem past its check, then someone takes the last use, then its write: refused', async () => {
    const c = await code(5, 1);
    const [a, b] = [await person('A'), await person('B')];
    // stop A's redeem just before its transaction (after anything it checks outside one)
    const p = s.gate.pauseBefore(/^\b$/, { orTransaction: true });
    const pending = redeem(a, c);
    await p.reached;
    expect((await redeem(b, c)).status).toBe(200);
    p.release();
    expect((await pending).status).toBe(409);
    expect([await usesOf(c), await useRowsOf(c)]).toEqual([1, 1]);
  });

  it('OncePerPlayer: a payment past its check, then the same player redeems, then its write: no second bonus', async () => {
    const c = await code(5, null);
    const a = await person('A');
    const o = await checkout(a, c);
    const p = s.gate.pauseBefore(/^\b$/, { orTransaction: true });
    const pending = pay(a, o.order!);
    await p.reached;
    expect((await redeem(a, c)).status).toBe(200);
    p.release();
    await pending;
    expect([await bonusOf(a), await usesOf(c)]).toEqual([5, 1]);
    // the pack itself still arrived
    expect(Number((await s.db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [a.id]))[0].credit_cents)).toBe(150);
  });
});

describe('promo bucks: random walks, server vs model', () => {
  for (const seed of [51, 52, 53, 54]) {
    it(`seed ${seed}: redeems, checkouts, payments, refunds and a disable agree with the model`, async () => {
      const r = rng(seed);
      const c = await code(4, 2);
      const people = [await person('P'), await person('Q'), await person('R')];
      const ids = people.map((p) => p.id);
      const m = new PromoModel(2, 4);
      const orders = new Map<string, string>();
      for (let step = 0; step < 20; step++) {
        const w = r.pick(people);
        const roll = r.next();
        if (roll < 0.3) {
          expect((await redeem(w, c)).status, `step ${step} redeem`).toBe(m.redeem(w.id));
        } else if (roll < 0.55) {
          const want = m.checkout(w.id);
          if (orders.has(w.id)) continue; // one order each, as in the spec
          const got = await checkout(w, c);
          expect(got.status, `step ${step} checkout`).toBe(want);
          if (got.order) orders.set(w.id, got.order);
        } else if (roll < 0.8) {
          const o = orders.get(w.id);
          if (o && m.order.get(w.id) === 'created') {
            await pay(w, o);
            m.pay(w.id);
          }
        } else if (roll < 0.95) {
          const o = orders.get(w.id);
          if (o && m.order.get(w.id) === 'paid') {
            await refund(w, o);
            m.refund(w.id);
          }
        } else {
          await s.db.query('UPDATE promo_codes SET active = false WHERE code = $1', [c]);
          m.disable();
        }
        expect(m.check(ids)).toEqual([]);
        expect(await usesOf(c)).toBe(m.uses);
        for (const p of people) expect(await bonusOf(p), `step ${step} bonus`).toBe(m.bal.get(p.id) ?? 0);
      }
    });
  }
});
