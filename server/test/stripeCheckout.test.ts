import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import {
  createCheckoutSession,
  sessionParams,
  signStripeWebhook,
  stripeFromEnv,
  verifyStripeSignature,
  type SessionRequest,
  type StripeConfig,
} from '../src/stripe.js';
import { openTestDb } from './testDb.js';

// Web checkout through Stripe (docs/STRIPE_PAYMENTS.md), the backup to
// Xsolla: the session call is faked; webhooks are signed here exactly as
// Stripe signs them.

const SECRET = 'whsec_test-secret';
const TEST: StripeConfig = { secretKey: 'sk_test_xxx', webhookSecret: SECRET, sandbox: true, returnUrl: 'https://beech.example/' };

let db: Db;
let skew = 0;
let app: ReturnType<typeof createApp>;
let liveApp: ReturnType<typeof createApp>;
let sessionCalls: SessionRequest[] = [];
let sessionFails = false;

beforeAll(async () => {
  db = await openTestDb();
  const session = async (_cfg: StripeConfig, req: SessionRequest) => {
    if (sessionFails) throw new Error('Stripe refused the checkout (500)');
    sessionCalls.push(req);
    return { sessionId: `cs_test_${req.webOrderId}`, url: `https://checkout.stripe.test/pay/cs_test_${req.webOrderId}` };
  };
  app = createApp(db, {
    googleClientIds: [],
    appleClientIds: [],
    allowedOrigins: [],
    devAuth: true,
    now: () => Date.now() + skew,
    stripe: TEST,
    stripeSession: session,
  });
  // the same server with live keys, for the test-event-on-live refusal
  liveApp = createApp(db, {
    googleClientIds: [],
    appleClientIds: [],
    allowedOrigins: [],
    devAuth: true,
    now: () => Date.now() + skew,
    stripe: { ...TEST, sandbox: false },
    stripeSession: session,
  });
});
afterAll(() => db.close());

const req = (path: string, init: RequestInit = {}, token?: string, a = app) =>
  a.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });

async function signIn(name: string): Promise<{ token: string; id: string }> {
  const r = await req('/auth/dev', json('POST', { name }));
  const b = (await r.json()) as { token: string; user: { id: string } };
  return { token: b.token, id: b.user.id };
}

/** POST a webhook the way Stripe does: raw JSON, signed over the exact bytes */
function hook(payload: unknown, secret = SECRET, a = app) {
  const raw = JSON.stringify(payload);
  return a.request('/store/stripe/webhook', { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signStripeWebhook(raw, secret) } });
}

async function checkout(token: string, productId = 'bucks_30') {
  const r = await req('/store/stripe-checkout', json('POST', { productId }), token);
  expect(r.status).toBe(200);
  const b = (await r.json()) as { order: string; url: string };
  const row = (await db.query<{ provider_order_id: string; provider: string }>('SELECT provider_order_id, provider FROM web_orders WHERE id = $1', [b.order]))[0];
  return { ...b, sessionId: row.provider_order_id, provider: row.provider };
}

const completed = (o: { order: string; sessionId: string | null }, userId: string, over: Record<string, unknown> = {}) => ({
  id: 'evt_completed',
  type: 'checkout.session.completed',
  livemode: false,
  data: {
    object: {
      id: o.sessionId,
      object: 'checkout.session',
      client_reference_id: o.order,
      metadata: { web_order: o.order, user_id: userId },
      payment_status: 'paid',
      amount_total: 299,
      currency: 'usd',
      ...over,
    },
  },
});

async function owned(token: string): Promise<number> {
  return ((await (await req('/credit', {}, token)).json()) as { bucks: number }).bucks;
}
async function orderStatus(token: string, id: string): Promise<string> {
  const r = await req(`/store/web-orders/${id}`, {}, token);
  return ((await r.json()) as { order: { status: string } }).order.status;
}

describe('Stripe helpers', () => {
  it('verifies the signature over the raw bytes, and nothing else', () => {
    const raw = '{"type":"checkout.session.completed","a":"é"}';
    const sig = signStripeWebhook(raw, SECRET);
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyStripeSignature(new TextEncoder().encode(raw), sig, SECRET)).toBe(true);
    expect(verifyStripeSignature(new TextEncoder().encode(raw), sig, 'other-secret')).toBe(false);
    expect(verifyStripeSignature(new TextEncoder().encode('{"type":"checkout.session.completed", "a":"é"}'), sig, SECRET)).toBe(false);
    expect(verifyStripeSignature(new TextEncoder().encode(raw), undefined, SECRET)).toBe(false);
    expect(verifyStripeSignature(new TextEncoder().encode(raw), sig, '')).toBe(false);
    // a signature from an hour ago is stale
    const stale = signStripeWebhook(raw, SECRET, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyStripeSignature(new TextEncoder().encode(raw), stale, SECRET)).toBe(false);
  });

  it('builds a one-item Checkout Session tied to the player and our order', () => {
    const p = sessionParams(TEST, { userId: 'u1', productId: 'bucks_30', productName: '33 beech bucks', amountCents: 299, webOrderId: 'o1' });
    expect(p.get('mode')).toBe('payment');
    expect(p.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('299');
    expect(p.get('line_items[0][price_data][product_data][name]')).toBe('33 beech bucks');
    expect(p.get('line_items[0][quantity]')).toBe('1');
    expect(p.get('success_url')).toBe('https://beech.example/?web_order=o1&session_id={CHECKOUT_SESSION_ID}');
    expect(p.get('cancel_url')).toBe('https://beech.example/');
    expect(p.get('client_reference_id')).toBe('o1');
    expect(p.get('metadata[web_order]')).toBe('o1');
    expect(p.get('metadata[user_id]')).toBe('u1');
    expect(p.get('payment_intent_data[metadata][web_order]')).toBe('o1');
  });

  it('calls Stripe with the secret key, and reports a refusal', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    fetch.mockImplementation(async () => Response.json({ id: 'cs_test_1', url: 'https://checkout.stripe.test/pay/cs_test_1' }));
    try {
      const s = await createCheckoutSession(TEST, { userId: 'u1', productId: 'bucks_30', productName: '33 beech bucks', amountCents: 299, webOrderId: 'o1' });
      expect(s).toEqual({ sessionId: 'cs_test_1', url: 'https://checkout.stripe.test/pay/cs_test_1' });
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Basic ${Buffer.from('sk_test_xxx:').toString('base64')}`);
      fetch.mockImplementation(async () =>
        new Response(JSON.stringify({ error: { message: 'Invalid API Key provided', type: 'invalid_request_error' } }), { status: 401 }),
      );
      await expect(
        createCheckoutSession(TEST, { userId: 'u1', productId: 'bucks_30', productName: '33 beech bucks', amountCents: 299, webOrderId: 'o1' }),
      ).rejects.toThrow('Stripe refused the checkout (401: Invalid API Key provided)');
    } finally {
      fetch.mockRestore();
    }
  });

  it('is on only when the secret key and webhook secret are both set', () => {
    expect(stripeFromEnv({}).cfg).toBeNull();
    expect(stripeFromEnv({}).missing).toEqual(['STRIPE_GAME_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']);
    expect(stripeFromEnv({ STRIPE_SECRET_KEY: 'sk_test_xxx' }).missing).toEqual(['STRIPE_WEBHOOK_SECRET']);
    const on = stripeFromEnv({ STRIPE_SECRET_KEY: 'sk_test_xxx', STRIPE_WEBHOOK_SECRET: 's', STRIPE_SANDBOX: '1' }).cfg!;
    expect(on.sandbox).toBe(true);
    expect(on.returnUrl).toBe('https://play.beech.games/');
  });

  it('prefers the game secret key over the merch-shared one', () => {
    // the merch key went live while the game checkout is still in test
    // mode: the game must never silently pick up the merch key's :latest
    const on = stripeFromEnv({
      STRIPE_GAME_SECRET_KEY: 'sk_test_game',
      STRIPE_SECRET_KEY: 'sk_live_merch',
      STRIPE_WEBHOOK_SECRET: 's',
    }).cfg!;
    expect(on.secretKey).toBe('sk_test_game');
    const fallback = stripeFromEnv({ STRIPE_SECRET_KEY: 'sk_test_shared', STRIPE_WEBHOOK_SECRET: 's' }).cfg!;
    expect(fallback.secretKey).toBe('sk_test_shared');
  });
});

describe('stripe checkout', () => {
  it('tells the shop Stripe can take payment, and makes a Checkout link for a signed-in player', async () => {
    const products = (await (await req('/store/products')).json()) as { webCheckout: boolean; stripeCheckout: boolean };
    expect(products).toMatchObject({ webCheckout: false, stripeCheckout: true });
    const p = await signIn('stripe-buyer-1');
    expect((await req('/store/stripe-checkout', json('POST', { productId: 'bucks_30' }))).status).toBe(401);
    expect((await req('/store/stripe-checkout', json('POST', { productId: 'nope' }), p.token)).status).toBe(404);
    // a code on something that is not a pack is refused before paying
    expect((await req('/store/stripe-checkout', json('POST', { productId: 'beach_1', promoCode: 'PACKPLUS' }), p.token)).status).toBe(400);
    sessionCalls = [];
    const o = await checkout(p.token);
    expect(o.url).toBe(`https://checkout.stripe.test/pay/cs_test_${o.order}`);
    expect(o.provider).toBe('stripe');
    expect(sessionCalls).toEqual([
      expect.objectContaining({ userId: p.id, productId: 'bucks_30', amountCents: 299, webOrderId: o.order }),
    ]);
    expect(await orderStatus(p.token, o.order)).toBe('created');
    const other = await signIn('stripe-other-1');
    expect((await req(`/store/web-orders/${o.order}`, {}, other.token)).status).toBe(404);
  });

  it('a failed session call leaves no order behind', async () => {
    const p = await signIn('stripe-buyer-fail');
    sessionFails = true;
    try {
      expect((await req('/store/stripe-checkout', json('POST', { productId: 'bucks_30' }), p.token)).status).toBe(502);
    } finally {
      sessionFails = false;
    }
    const n = await db.query<{ n: string }>('SELECT COUNT(*) AS n FROM web_orders WHERE user_id = $1', [p.id]);
    expect(Number(n[0].n)).toBe(0);
  });

  it('refuses webhooks without the right signature', async () => {
    const raw = JSON.stringify({ type: 'checkout.session.completed' });
    const none = await app.request('/store/stripe/webhook', { method: 'POST', body: raw });
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: 'invalid signature' });
    expect((await hook({ type: 'checkout.session.completed' }, 'wrong-secret')).status).toBe(400);
  });

  it('grants a paid order once, however often Stripe retries the webhook', async () => {
    const p = await signIn('stripe-buyer-2');
    const o = await checkout(p.token);
    expect(await owned(p.token)).toBe(0);
    expect((await hook(completed(o, p.id))).status).toBe(200);
    expect(await owned(p.token)).toBe(33);
    expect(await orderStatus(p.token, o.order)).toBe('paid');
    // retries, including two at once, grant nothing more
    const again = await Promise.all([hook(completed(o, p.id)), hook(completed(o, p.id))]);
    expect(again.map((r) => r.status)).toEqual([200, 200]);
    expect(await owned(p.token)).toBe(33);
    const rows = await db.query<{ store: string; transaction_id: string; environment: string }>(
      'SELECT store, transaction_id, environment FROM purchases WHERE user_id = $1',
      [p.id],
    );
    expect(rows).toEqual([{ store: 'stripe', transaction_id: o.sessionId, environment: 'Sandbox' }]);
  });

  it('grants nothing for the wrong amount, an unpaid session, the wrong player, or an unknown order', async () => {
    const p = await signIn('stripe-buyer-3');
    const o = await checkout(p.token);
    // the wrong price
    expect((await hook(completed(o, p.id, { amount_total: 99 }))).status).toBe(400);
    // the session never paid
    expect((await hook(completed(o, p.id, { payment_status: 'unpaid' }))).status).toBe(400);
    // paid by (or for) somebody else
    const other = await signIn('stripe-other-3');
    expect((await hook(completed(o, other.id))).status).toBe(400);
    // a session id we never issued
    expect((await hook(completed({ order: o.order, sessionId: 'cs_test_nope' }, p.id))).status).toBe(400);
    // a live event, on a test setup
    expect((await hook({ ...completed(o, p.id), livemode: true })).status).toBe(400);
    expect(await owned(p.token)).toBe(0);
    expect(await owned(other.token)).toBe(0);
    expect(await orderStatus(p.token, o.order)).toBe('created');
    // and the right one still grants after all that
    expect((await hook(completed(o, p.id))).status).toBe(200);
    expect(await owned(p.token)).toBe(33);
  });

  it('refuses a test event on a live setup', async () => {
    const p = await signIn('stripe-buyer-live');
    const r = await req('/store/stripe-checkout', json('POST', { productId: 'bucks_30' }), p.token, liveApp);
    expect(r.status).toBe(200);
    const b = (await r.json()) as { order: string };
    const row = (await db.query<{ provider_order_id: string }>('SELECT provider_order_id FROM web_orders WHERE id = $1', [b.order]))[0];
    expect((await hook(completed({ order: b.order, sessionId: row.provider_order_id }, p.id), SECRET, liveApp)).status).toBe(400);
    expect(await owned(p.token)).toBe(0);
  });

  it('a refund takes the beech bucks back, and a late payment does not bring them back', async () => {
    const p = await signIn('stripe-buyer-4');
    const o = await checkout(p.token, 'bucks_10');
    expect((await hook(completed(o, p.id, { amount_total: 99 }))).status).toBe(200);
    expect(await owned(p.token)).toBe(10);
    const refund = {
      id: 'evt_refund',
      type: 'charge.refunded',
      livemode: false,
      data: { object: { id: 'ch_test_1', object: 'charge', metadata: { web_order: o.order, user_id: p.id }, payment_intent: 'pi_test_1' } },
    };
    expect((await hook(refund)).status).toBe(200);
    expect(await owned(p.token)).toBe(0);
    expect(await orderStatus(p.token, o.order)).toBe('refunded');
    // a late repeat of the payment doesn't bring it back
    expect((await hook(completed(o, p.id, { amount_total: 99 }))).status).toBe(200);
    expect(await owned(p.token)).toBe(0);
    // and a repeat of the refund is harmless
    expect((await hook(refund)).status).toBe(200);
  });

  it('an expired session cancels the order, and a payment for it then grants nothing', async () => {
    const p = await signIn('stripe-buyer-5');
    const o = await checkout(p.token);
    const expired = {
      id: 'evt_expired',
      type: 'checkout.session.expired',
      livemode: false,
      data: { object: { id: o.sessionId, object: 'checkout.session', client_reference_id: o.order, metadata: { web_order: o.order, user_id: p.id } } },
    };
    expect((await hook(expired)).status).toBe(200);
    expect(await orderStatus(p.token, o.order)).toBe('canceled');
    expect((await hook(completed(o, p.id))).status).toBe(200);
    expect(await owned(p.token)).toBe(0);
  });

  it('an old unpaid order reads as expired, but a late payment still grants', async () => {
    const p = await signIn('stripe-buyer-6');
    const o = await checkout(p.token);
    skew = 25 * 3600 * 1000;
    try {
      expect(await orderStatus(p.token, o.order)).toBe('expired');
      expect((await hook(completed(o, p.id))).status).toBe(200);
      expect(await orderStatus(p.token, o.order)).toBe('paid');
      expect(await owned(p.token)).toBe(33);
    } finally {
      skew = 0;
    }
  });

  it('acknowledges webhooks it has no use for', async () => {
    expect((await hook({ id: 'evt_other', type: 'payment_intent.created', livemode: false, data: { object: {} } })).status).toBe(200);
  });

  it('a promo code charges the full price and adds the bonus when paid; a refund takes both back', async () => {
    await db.query('INSERT INTO promo_codes (code, kind, value, max_uses, active, created_at) VALUES ($1, $2, $3, $4, true, $5)', [
      'STRIPEPLUS',
      'percent',
      20,
      null,
      Date.now(),
    ]);
    const p = await signIn('stripe-promo-1');
    const r = await req('/store/stripe-checkout', json('POST', { productId: 'bucks_30', promoCode: 'stripe-plus' }), p.token);
    expect(r.status).toBe(200);
    const b = (await r.json()) as { order: string; promo: string; bonus: number };
    expect(b).toMatchObject({ promo: 'STRIPEPLUS', bonus: 6 }); // 20% of 33, rounded down
    const row = (await db.query<{ provider_order_id: string; promo_code: string | null; amount_cents: number }>(
      'SELECT provider_order_id, promo_code, amount_cents FROM web_orders WHERE id = $1',
      [b.order],
    ))[0];
    expect(row).toMatchObject({ promo_code: 'STRIPEPLUS', amount_cents: 299 }); // the full price
    expect((await hook(completed({ order: b.order, sessionId: row.provider_order_id }, p.id))).status).toBe(200);
    expect(await owned(p.token)).toBe(33 + 6);
    const refund = {
      id: 'evt_refund2',
      type: 'charge.refunded',
      livemode: false,
      data: { object: { id: 'ch_test_2', object: 'charge', metadata: { web_order: b.order, user_id: p.id }, payment_intent: 'pi_test_2' } },
    };
    expect((await hook(refund)).status).toBe(200);
    expect(await owned(p.token)).toBe(0);
  });
});

describe('stripe checkout switched off', () => {
  it('keeps the web shop pointing at the apps', async () => {
    const off = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true });
    const products = (await (await off.request('/store/products')).json()) as { webCheckout: boolean; stripeCheckout: boolean };
    expect(products).toMatchObject({ webCheckout: false, stripeCheckout: false });
    const r = await off.request('/auth/dev', json('POST', { name: 'stripe-off' }));
    const { token } = (await r.json()) as { token: string };
    const c = await off.request('/store/stripe-checkout', { ...json('POST', { productId: 'bucks_30' }), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    expect(c.status).toBe(404);
    expect((await hook({ type: 'checkout.session.completed' }, SECRET, off)).status).toBe(404);
  });
});
