// Stripe and Printful as the merch store sees them (docs/MERCH_STORE.md),
// behind one `fetch`, for the state-machine tests: Checkout sessions a test
// can pay, expire and refund; Printful orders keyed by external_id (a second
// POST for the same one is refused, as Printful does) with confirm.
import type { MerchConfig, StripeSession } from '../../src/merchProviders.js';
import { signStripe } from '../../src/merchProviders.js';

export const WEBHOOK_SECRET = 'whsec_test';
export const PRINTFUL_SECRET = 'pf-hook-secret';

export interface FakePrintfulOrder {
  id: number;
  external_id: string;
  status: 'draft' | 'pending';
  body: { items: { variant_id?: number; warehouse_product_variant_id?: number; files?: { type: string; url: string }[]; retail_price: string }[]; recipient: unknown };
}

export function fakeServices() {
  const sessions = new Map<string, StripeSession & { lineItems: string[] }>();
  const printful = new Map<string, FakePrintfulOrder>();
  const calls = { drafts: 0, confirms: 0, gets: 0 };
  let n = 0;
  const state = { printerUp: true };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.host === 'api.stripe.com') {
      if (method === 'POST' && url.pathname === '/v1/checkout/sessions') {
        const form = new URLSearchParams(String(init.body));
        const id = `cs_test_${++n}`;
        const orderId = form.get('metadata[order_id]')!;
        const lineItems = [...form.keys()].filter((k) => /^line_items\[\d+\]\[quantity\]$/.test(k));
        sessions.set(id, { id, url: `https://checkout.stripe.com/c/pay/${id}`, status: 'open', payment_status: 'unpaid', client_reference_id: orderId, metadata: { order_id: orderId }, lineItems });
        return json(200, sessions.get(id));
      }
      const s = /^\/v1\/checkout\/sessions\/(.+)$/.exec(url.pathname);
      if (method === 'GET' && s) return sessions.has(s[1]) ? json(200, sessions.get(s[1])) : json(404, { error: { message: 'no such session' } });
      const pi = /^\/v1\/payment_intents\/(.+)$/.exec(url.pathname);
      if (method === 'GET' && pi) {
        const found = [...sessions.values()].find((x) => x.payment_intent === pi[1]);
        return found ? json(200, { id: pi[1], metadata: found.metadata }) : json(404, { error: { message: 'no such payment intent' } });
      }
      return json(404, { error: { message: 'unknown stripe call' } });
    }
    if (url.host === 'api.printful.com') {
      if (!state.printerUp) return json(503, { error: { message: 'down' } });
      const ext = /^\/orders\/@([0-9a-f]{32})(\/confirm)?$/.exec(url.pathname);
      if (method === 'GET' && ext && !ext[2]) {
        calls.gets++;
        const o = printful.get(ext[1]);
        return o ? json(200, { result: o }) : json(404, { error: { message: 'not found' } });
      }
      if (method === 'POST' && url.pathname === '/orders') {
        const body = JSON.parse(String(init.body)) as FakePrintfulOrder['body'] & { external_id: string };
        if (printful.has(body.external_id)) return json(400, { error: { message: 'Order with this external ID already exists' } });
        calls.drafts++;
        const o: FakePrintfulOrder = { id: 1000 + printful.size, external_id: body.external_id, status: 'draft', body };
        printful.set(body.external_id, o);
        return json(200, { result: o });
      }
      if (method === 'POST' && ext?.[2]) {
        const o = printful.get(ext[1]);
        if (!o) return json(404, { error: { message: 'not found' } });
        if (o.status !== 'draft') return json(400, { error: { message: 'not a draft' } });
        calls.confirms++;
        o.status = 'pending';
        return json(200, { result: o });
      }
      return json(404, { error: { message: 'unknown printful call' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  const cfg: MerchConfig = {
    stripeSecretKey: 'sk_test',
    stripeWebhookSecret: WEBHOOK_SECRET,
    printfulToken: 'pf',
    printfulWebhookSecret: PRINTFUL_SECRET,
    storeUrl: 'https://store.example',
    sunglassesVariant: 777,
    stripeTax: false,
    printfulDraftsOnly: false,
    fetch: fetchFn,
  };

  /** Stripe: the shopper pays (with an address) */
  const pay = (sessionId: string) => {
    const s = sessions.get(sessionId)!;
    Object.assign(s, {
      status: 'complete',
      payment_status: 'paid',
      payment_intent: `pi_${sessionId}`,
      amount_total: 4200,
      customer_details: { email: 'shopper@example.com', name: 'Sandy Shore', phone: null },
      collected_information: { shipping_details: { name: 'Sandy Shore', address: { line1: '1 Beach Rd', city: 'Bondi', state: 'NSW', postal_code: '2026', country: 'AU' } } },
    });
    return s;
  };
  const lapse = (sessionId: string) => Object.assign(sessions.get(sessionId)!, { status: 'expired' });
  const event = (type: string, object: unknown, now: number) => {
    const raw = JSON.stringify({ id: `evt_${++n}`, type, data: { object } });
    return { raw, sig: signStripe(raw, WEBHOOK_SECRET, now) };
  };
  return { cfg, sessions, printful, calls, state, pay, lapse, event };
}
