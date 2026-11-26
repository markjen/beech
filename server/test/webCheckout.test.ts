import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { createPaymentToken, payStationUrl, signWebhook, tokenBody, verifyWebhookSignature, xsollaFromEnv, type TokenRequest, type XsollaConfig } from '../src/xsolla.js';
import { openTestDb } from './testDb.js';

// Web checkout through Xsolla (docs/WEB_PAYMENTS.md): the token call is
// faked; webhooks are signed here exactly as Xsolla signs them.

const SECRET = 'webhook-secret';
const LIVE: XsollaConfig = { projectId: '1234', apiKey: 'api-key', webhookSecret: SECRET, sandbox: false, returnUrl: 'https://beech.example/' };

let db: Db;
let skew = 0;
let app: ReturnType<typeof createApp>;
let tokenCalls: TokenRequest[] = [];
let tokenFails = false;
let nextXsollaOrder = 9000;

beforeAll(async () => {
  db = await openTestDb();
  app = createApp(db, {
    googleClientIds: [],
    appleClientIds: [],
    allowedOrigins: [],
    devAuth: true,
    now: () => Date.now() + skew,
    xsolla: LIVE,
    xsollaToken: async (_cfg, req) => {
      if (tokenFails) throw new Error('Xsolla refused the checkout (500)');
      tokenCalls.push(req);
      return { token: `tok-${req.webOrderId}`, orderId: String(nextXsollaOrder++) };
    },
  });
});
afterAll(() => db.close());

const req = (path: string, init: RequestInit = {}, token?: string) =>
  app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });

async function signIn(name: string): Promise<{ token: string; id: string }> {
  const r = await req('/auth/dev', json('POST', { name }));
  const b = (await r.json()) as { token: string; user: { id: string } };
  return { token: b.token, id: b.user.id };
}

/** POST a webhook the way Xsolla does: raw JSON, signed over the exact bytes */
function hook(payload: unknown, secret = SECRET, a = app) {
  const raw = JSON.stringify(payload);
  return a.request('/store/xsolla/webhook', { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', Authorization: signWebhook(raw, secret) } });
}

async function checkout(token: string, productId = 'bucks_30') {
  const r = await req('/store/web-checkout', json('POST', { productId }), token);
  expect(r.status).toBe(200);
  const b = (await r.json()) as { order: string; url: string };
  const row = (await db.query<{ provider_order_id: string }>('SELECT provider_order_id FROM web_orders WHERE id = $1', [b.order]))[0];
  return { ...b, xsollaOrder: row.provider_order_id };
}

const paid = (o: { order: string; xsollaOrder: string }, userId: string, over: Record<string, unknown> = {}, sku = 'bucks_30', amount = '2.99') => ({
  notification_type: 'order_paid',
  items: [{ sku, quantity: 1, amount, type: 'virtual_good' }],
  order: { id: Number(o.xsollaOrder), mode: 'default', currency: 'USD', amount, status: 'paid', platform: 'xsolla' },
  user: { external_id: userId, email: 'p@example.com' },
  billing: { transaction: { id: 555, external_id: o.order } },
  custom_parameters: { web_order: o.order },
  ...over,
});

async function owned(token: string, item: string): Promise<number> {
  // sand bucks (docs/SAND_BUCKS.md): what the web sells now
  if (item === 'bucks') return ((await (await req('/credit', {}, token)).json()) as { bucks: number }).bucks;
  const r = await req('/inventory', {}, token);
  const items = ((await r.json()) as { items: { item: string; quantity: number }[] }).items;
  return items.filter((i) => i.item === item).reduce((n, i) => n + i.quantity, 0);
}
async function orderStatus(token: string, id: string): Promise<string> {
  const r = await req(`/store/web-orders/${id}`, {}, token);
  return ((await r.json()) as { order: { status: string } }).order.status;
}

describe('Xsolla helpers', () => {
  it('verifies the signature over the raw bytes, in constant time, and nothing else', () => {
    const raw = new TextEncoder().encode('{"notification_type":"order_paid","a":"é"}');
    const sig = signWebhook(raw, SECRET);
    expect(sig).toMatch(/^Signature [0-9a-f]{40}$/);
    expect(verifyWebhookSignature(raw, sig, SECRET)).toBe(true);
    // upper-case hex is the same signature
    expect(verifyWebhookSignature(raw, `Signature ${sig.slice(10).toUpperCase()}`, SECRET)).toBe(true);
    expect(verifyWebhookSignature(raw, sig, 'other-secret')).toBe(false);
    expect(verifyWebhookSignature(new TextEncoder().encode('{"notification_type":"order_paid", "a":"é"}'), sig, SECRET)).toBe(false);
    expect(verifyWebhookSignature(raw, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(raw, sig.slice(10), SECRET)).toBe(false);
    expect(verifyWebhookSignature(raw, sig, '')).toBe(false);
  });

  it('builds a one-item token request tied to the player and our order', () => {
    const b = tokenBody({ ...LIVE, sandbox: true }, { userId: 'u1', sku: 'bucks_30', webOrderId: 'o1' });
    expect(b).toEqual({
      sandbox: true,
      user: { id: { value: 'u1' } },
      purchase: { items: [{ sku: 'bucks_30', quantity: 1 }] },
      settings: { external_id: 'o1', return_url: 'https://beech.example/?web_order=o1', currency: 'USD' },
      custom_parameters: { web_order: 'o1' },
    });
    expect(payStationUrl('a b', false)).toBe('https://secure.xsolla.com/paystation4/?token=a%20b');
    expect(payStationUrl('t', true)).toBe('https://sandbox-secure.xsolla.com/paystation4/?token=t');
  });

  it('puts the player country in the token body when the client sent one', () => {
    const b = tokenBody({ ...LIVE, sandbox: true }, { userId: 'u1', sku: 'bucks_30', webOrderId: 'o1', country: 'US' });
    expect((b.user as { country?: { value: string } }).country).toEqual({ value: 'US' });
    const noCountry = tokenBody({ ...LIVE, sandbox: true }, { userId: 'u1', sku: 'bucks_30', webOrderId: 'o1' });
    expect((noCountry.user as { country?: unknown }).country).toBeUndefined();
  });

  it('uses IPv4 first and falls back to the locale country', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    fetch.mockImplementation(async () => Response.json({ token: 'token', order_id: 1 }));
    try {
      const req = { userId: 'u1', sku: 'bucks_30', webOrderId: 'o1', country: 'US' };
      await createPaymentToken(LIVE, { ...req, ip: '192.0.2.1' });
      await createPaymentToken(LIVE, { ...req, ip: '2001:db8::1' });
      await createPaymentToken(LIVE, { ...req, ip: '999.0.2.1' });
      const sent = fetch.mock.calls.map(([, init]) => ({
        ip: new Headers(init?.headers).get('X-User-Ip'),
        country: JSON.parse(String(init?.body)).user.country?.value,
      }));
      expect(sent).toEqual([
        { ip: '192.0.2.1', country: undefined },
        { ip: null, country: 'US' },
        { ip: null, country: 'US' },
      ]);
    } finally {
      fetch.mockRestore();
    }
  });

  it('is on only when the project, key and webhook secret are all set', () => {
    expect(xsollaFromEnv({}).cfg).toBeNull();
    expect(xsollaFromEnv({ XSOLLA_PROJECT_ID: '1', XSOLLA_API_KEY: 'k' }).missing).toEqual(['XSOLLA_WEBHOOK_SECRET']);
    const on = xsollaFromEnv({ XSOLLA_PROJECT_ID: '1', XSOLLA_API_KEY: 'k', XSOLLA_WEBHOOK_SECRET: 's', XSOLLA_SANDBOX: '1' }).cfg!;
    expect(on.sandbox).toBe(true);
    expect(on.returnUrl).toBe('https://play.beech.games/');
  });
});

describe('web checkout', () => {
  it('tells the shop it can take payment, and makes a Pay Station link for a signed-in player', async () => {
    const products = (await (await req('/store/products')).json()) as { webCheckout: boolean };
    expect(products.webCheckout).toBe(true);
    const p = await signIn('web-buyer-1');
    expect((await req('/store/web-checkout', json('POST', { productId: 'bucks_30' }))).status).toBe(401);
    expect((await req('/store/web-checkout', json('POST', { productId: 'nope' }), p.token)).status).toBe(404);
    // a promo can't discount a card payment (Xsolla charges its catalog price)
    expect((await req('/store/web-checkout', json('POST', { productId: 'bucks_30', promoCode: 'LAUNCH20' }), p.token)).status).toBe(400);
    tokenCalls = [];
    const o = await checkout(p.token);
    expect(o.url).toBe(`https://secure.xsolla.com/paystation4/?token=tok-${o.order}`);
    expect(tokenCalls).toEqual([expect.objectContaining({ userId: p.id, sku: 'bucks_30', webOrderId: o.order })]);
    expect(await orderStatus(p.token, o.order)).toBe('created');
    // someone else's order is not yours to look at
    const other = await signIn('web-other-1');
    expect((await req(`/store/web-orders/${o.order}`, {}, other.token)).status).toBe(404);
    expect((await req('/store/web-orders/not-a-uuid', {}, p.token)).status).toBe(404);
  });

  it('forwards the client country to the token call, and refuses a bad one', async () => {
    const p = await signIn('web-buyer-country');
    tokenCalls = [];
    const r = await req('/store/web-checkout', json('POST', { productId: 'bucks_30', country: 'us' }), p.token);
    expect(r.status).toBe(200);
    expect(tokenCalls).toEqual([expect.objectContaining({ country: 'US' })]);
    // a three-letter country is not a country code: no order is created
    tokenCalls = [];
    for (const country of ['USA', null, 42, {}, 'ß']) {
      expect((await req('/store/web-checkout', json('POST', { productId: 'bucks_30', country }), p.token)).status).toBe(400);
    }
    expect(tokenCalls).toEqual([]);
    expect(await db.query('SELECT id FROM web_orders WHERE user_id = $1', [p.id])).toHaveLength(1);
  });

  it('a failed token call leaves no order behind', async () => {
    const p = await signIn('web-buyer-fail');
    tokenFails = true;
    try {
      expect((await req('/store/web-checkout', json('POST', { productId: 'bucks_30' }), p.token)).status).toBe(502);
    } finally {
      tokenFails = false;
    }
    const n = await db.query<{ n: string }>('SELECT COUNT(*) AS n FROM web_orders WHERE user_id = $1', [p.id]);
    expect(Number(n[0].n)).toBe(0);
  });

  it('refuses webhooks without the right signature', async () => {
    const raw = JSON.stringify({ notification_type: 'user_validation', user: { id: 'x' } });
    const none = await app.request('/store/xsolla/webhook', { method: 'POST', body: raw });
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } });
    expect((await hook({ notification_type: 'user_validation' }, 'wrong-secret')).status).toBe(400);
  });

  it('validates users', async () => {
    const p = await signIn('web-validate');
    expect((await hook({ notification_type: 'user_validation', user: { id: p.id } })).status).toBe(204);
    const bad = await hook({ notification_type: 'user_validation', user: { id: '00000000-0000-4000-8000-000000000000' } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('INVALID_USER');
  });

  it('grants a paid order once, however often Xsolla retries the webhook', async () => {
    const p = await signIn('web-buyer-2');
    const o = await checkout(p.token);
    expect(await owned(p.token, 'bucks')).toBe(0);
    expect((await hook(paid(o, p.id))).status).toBe(204);
    expect(await owned(p.token, 'bucks')).toBe(33);
    expect(await orderStatus(p.token, o.order)).toBe('paid');
    // retries, including two at once, grant nothing more
    const again = await Promise.all([hook(paid(o, p.id)), hook(paid(o, p.id))]);
    expect(again.map((r) => r.status)).toEqual([204, 204]);
    expect(await owned(p.token, 'bucks')).toBe(33);
    const rows = await db.query<{ store: string; transaction_id: string; environment: string }>(
      'SELECT store, transaction_id, environment FROM purchases WHERE user_id = $1',
      [p.id],
    );
    expect(rows).toEqual([{ store: 'xsolla', transaction_id: o.xsollaOrder, environment: 'Production' }]);
  });

  it('grants a bigger pack in full', async () => {
    const p = await signIn('web-buyer-pack');
    const o = await checkout(p.token, 'bucks_100');
    expect((await hook(paid(o, p.id, {}, 'bucks_100', '9.99'))).status).toBe(204);
    expect(await owned(p.token, 'bucks')).toBe(130);
  });

  it('grants nothing for the wrong amount, items, player or order, or a test payment on live', async () => {
    const p = await signIn('web-buyer-3');
    const o = await checkout(p.token);
    const code = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
    // the wrong price in US dollars
    let r = await hook(paid(o, p.id, {}, 'bucks_30', '0.99'));
    expect(r.status).toBe(400);
    expect(await code(r)).toBe('INCORRECT_AMOUNT');
    // a different product, or more than one
    r = await hook(paid(o, p.id, {}, 'bucks_100', '2.99'));
    expect(await code(r)).toBe('INCORRECT_INVOICE');
    r = await hook(paid(o, p.id, { items: [{ sku: 'bucks_30', quantity: 5 }] }));
    expect(await code(r)).toBe('INCORRECT_INVOICE');
    // paid by (or for) somebody else
    const other = await signIn('web-other-3');
    r = await hook(paid(o, other.id));
    expect(await code(r)).toBe('INVALID_USER');
    // an order id we never issued
    r = await hook(paid({ order: o.order, xsollaOrder: '1' }, p.id));
    expect(await code(r)).toBe('INCORRECT_INVOICE');
    // a sandbox payment, on a live setup
    r = await hook(paid(o, p.id, { order: { id: Number(o.xsollaOrder), mode: 'sandbox', currency: 'USD', amount: '2.99' } }));
    expect(r.status).toBe(400);
    r = await hook(paid(o, p.id, { billing: { transaction: { id: 1, dry_run: 1 } } }));
    expect(r.status).toBe(400);
    expect(await owned(p.token, 'bucks')).toBe(0);
    expect(await owned(other.token, 'bucks')).toBe(0);
    expect(await orderStatus(p.token, o.order)).toBe('created');
    // a local-currency payment of the right item is fine (Xsolla converts)
    r = await hook(paid(o, p.id, { order: { id: Number(o.xsollaOrder), mode: 'default', currency: 'EUR', amount: '2.79' } }));
    expect(r.status).toBe(204);
    expect(await owned(p.token, 'bucks')).toBe(33);
  });

  it('a refund or cancellation takes the sand bucks back', async () => {
    const p = await signIn('web-buyer-4');
    const o = await checkout(p.token, 'bucks_10');
    expect((await hook(paid(o, p.id, {}, 'bucks_10', '0.99'))).status).toBe(204);
    expect(await owned(p.token, 'bucks')).toBe(10);
    const cancel = { notification_type: 'order_canceled', items: [{ sku: 'bucks_10', quantity: 1 }], order: { id: Number(o.xsollaOrder), status: 'canceled' }, user: { external_id: p.id }, custom_parameters: { web_order: o.order } };
    expect((await hook(cancel)).status).toBe(204);
    expect(await owned(p.token, 'bucks')).toBe(0);
    expect(await orderStatus(p.token, o.order)).toBe('refunded');
    // a late repeat of the payment doesn't bring it back
    expect((await hook(paid(o, p.id, {}, 'bucks_10', '0.99'))).status).toBe(204);
    expect(await owned(p.token, 'bucks')).toBe(0);
    // and a repeat of the cancellation is harmless
    expect((await hook(cancel)).status).toBe(204);
  });

  it('a payment for an order canceled before it was paid grants nothing', async () => {
    const p = await signIn('web-buyer-5');
    const o = await checkout(p.token);
    expect((await hook({ notification_type: 'order_canceled', order: { id: Number(o.xsollaOrder) }, custom_parameters: { web_order: o.order } })).status).toBe(204);
    expect(await orderStatus(p.token, o.order)).toBe('canceled');
    expect((await hook(paid(o, p.id))).status).toBe(204);
    expect(await owned(p.token, 'bucks')).toBe(0);
  });

  it('an old unpaid order reads as expired, but a late payment still grants', async () => {
    const p = await signIn('web-buyer-6');
    const o = await checkout(p.token);
    skew = 25 * 3600 * 1000;
    try {
      expect(await orderStatus(p.token, o.order)).toBe('expired');
      expect((await hook(paid(o, p.id))).status).toBe(204);
      expect(await orderStatus(p.token, o.order)).toBe('paid');
      expect(await owned(p.token, 'bucks')).toBe(33);
    } finally {
      skew = 0;
    }
  });

  it('acknowledges webhooks it has no use for', async () => {
    expect((await hook({ notification_type: 'payment', transaction: { id: 1 } })).status).toBe(204);
  });
});

describe('web checkout switched off', () => {
  it('keeps the web shop pointing at the apps', async () => {
    const off = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true });
    const products = (await (await off.request('/store/products')).json()) as { webCheckout: boolean };
    expect(products.webCheckout).toBe(false);
    const r = await off.request('/auth/dev', json('POST', { name: 'web-off' }));
    const { token } = (await r.json()) as { token: string };
    const c = await off.request('/store/web-checkout', { ...json('POST', { productId: 'bucks_30' }), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
    expect(c.status).toBe(404);
    expect((await hook({ notification_type: 'user_validation' }, SECRET, off)).status).toBe(404);
  });
});
