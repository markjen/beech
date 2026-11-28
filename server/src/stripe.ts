// Web checkout through Stripe (docs/STRIPE_PAYMENTS.md). Stripe is the
// backup to Xsolla: the player pays on Stripe's hosted Checkout page,
// Stripe tells us by webhook, and we grant exactly what an Xsolla payment
// grants. Unlike Xsolla, Stripe does not act as merchant of record —
// Jenerator Labs is the seller, so tax/VAT, PCI scope and chargebacks land
// on us, and Stripe's 2.9% + $0.30 bites hard on $0.99 items. Xsolla stays
// the primary whenever it works.
//
// Two calls, both server-side:
//  - createCheckoutSession: Checkout Sessions API (POST
//    https://api.stripe.com/v1/checkout/sessions, Basic auth with the
//    secret key, form-encoded). One line item priced from
//    server/src/products.ts — no Stripe dashboard catalog to keep in step.
//    Our web order id goes in client_reference_id and metadata.web_order;
//    the player's id goes in metadata.user_id so the webhook can check the
//    buyer. The session id is stored as the order's provider_order_id and
//    is the purchases transaction id, like Xsolla's order id.
//  - verifyStripeSignature: Stripe signs each webhook as
//    `Stripe-Signature: t=<unix seconds>,v1=<hmac-sha256(secret,
//    "<t>.<raw body>")>`, hex, constant-time compared, 5-minute tolerance.
//
// Kept free of the app and the database so it can be unit tested on its own.

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface StripeConfig {
  /** the secret key (sk_test_... in test mode, sk_live_... live) */
  secretKey: string;
  /** the webhook endpoint's signing secret (whsec_...) */
  webhookSecret: string;
  /** test payments only (Stripe test mode and test cards) */
  sandbox: boolean;
  /** where Checkout sends the player back to, e.g. https://play.beech.games/ */
  returnUrl: string;
}

export const STRIPE_API = 'https://api.stripe.com/v1';

export interface SessionRequest {
  userId: string;
  /** our product id */
  productId: string;
  /** the name shown on the Checkout page */
  productName: string;
  /** what the player pays, in cents */
  amountCents: number;
  /** our web order id: client_reference_id and metadata.web_order */
  webOrderId: string;
  /** where Checkout comes back to, instead of cfg.returnUrl */
  returnUrl?: string;
}

export interface SessionResult {
  /** Stripe's Checkout Session id (cs_test_...); the purchases transaction id */
  sessionId: string;
  /** the hosted Checkout page to send the player to */
  url: string;
}

export type CreateCheckoutSession = (cfg: StripeConfig, req: SessionRequest) => Promise<SessionResult>;

/**
 * The form fields for a one-item Checkout Session (exported for tests).
 * Stripe's API is form-encoded, not JSON.
 */
export function sessionParams(cfg: StripeConfig, req: SessionRequest): URLSearchParams {
  const ret = new URL(req.returnUrl ?? cfg.returnUrl);
  ret.searchParams.set('web_order', req.webOrderId);
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('line_items[0][price_data][currency]', 'usd');
  p.set('line_items[0][price_data][unit_amount]', String(req.amountCents));
  p.set('line_items[0][price_data][product_data][name]', req.productName);
  p.set('line_items[0][quantity]', '1');
  p.set('success_url', `${ret.toString()}&session_id={CHECKOUT_SESSION_ID}`);
  // canceling comes straight back to the beach with no order id: nothing
  // was charged, and the created order just expires on read
  p.set('cancel_url', req.returnUrl ?? cfg.returnUrl);
  p.set('client_reference_id', req.webOrderId);
  p.set('metadata[web_order]', req.webOrderId);
  p.set('metadata[user_id]', req.userId);
  p.set('payment_intent_data[metadata][web_order]', req.webOrderId);
  p.set('payment_intent_data[metadata][user_id]', req.userId);
  return p;
}

export const createCheckoutSession: CreateCheckoutSession = async (cfg, req) => {
  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${cfg.secretKey}:`).toString('base64')}`,
    },
    body: sessionParams(cfg, req),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    error?: { message?: string; type?: string };
  };
  if (!res.ok || !data.id || !data.url) {
    // Stripe's error message only (it never echoes our secret key)
    throw new Error(`Stripe refused the checkout (${res.status}${data.error?.message ? `: ${data.error.message}` : ''})`);
  }
  return { sessionId: data.id, url: data.url };
};

/** Stripe's webhook signature header: `t=<seconds>,v1=<hex>`, possibly several v1. */
function parseStripeSignature(header: string | undefined): { t: string; v1s: string[] } | null {
  if (!header) return null;
  const parts = header.split(',').map((s) => s.trim());
  const t = parts.find((p) => p.startsWith('t='))?.slice(2);
  const v1s = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || !/^\d+$/.test(t) || v1s.length === 0) return null;
  return { t, v1s };
}

/**
 * Check a webhook's signature over the raw body bytes (never re-serialized
 * JSON: that changes the hash). Constant-time compare; rejects timestamps
 * more than 5 minutes from now, like Stripe's own libraries.
 */
export function verifyStripeSignature(
  rawBody: Uint8Array,
  signature: string | undefined,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  if (!secret) return false;
  const parsed = parseStripeSignature(signature);
  if (!parsed) return false;
  if (Math.abs(nowMs - Number(parsed.t) * 1000) > 300_000) return false;
  const want = createHmac('sha256', secret).update(`${parsed.t}.`).update(rawBody).digest();
  return parsed.v1s.some((v1) => {
    const got = Buffer.from(v1, 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/** The signature Stripe would send for `rawBody` (tests and local replays). */
export function signStripeWebhook(rawBody: string | Uint8Array, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : Buffer.from(rawBody);
  const v1 = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

/** The parts of a Stripe event we act on (checkout.session.completed, charge.refunded, checkout.session.expired). */
export interface StripeEvent {
  id?: string;
  type?: string;
  /** false in test mode, true for live payments */
  livemode?: boolean;
  data?: {
    object?: {
      id?: string;
      object?: string;
      client_reference_id?: string;
      metadata?: { web_order?: string; user_id?: string } | null;
      payment_status?: string;
      amount_total?: number;
      currency?: string;
      payment_intent?: string;
    };
  };
}

/**
 * Read the Stripe settings from the environment; null unless fully set up.
 *
 * The secret key comes from STRIPE_GAME_SECRET_KEY — the game's own
 * secret (Secret Manager beech-stripe-game-secret-key). It falls back to
 * STRIPE_SECRET_KEY, the merch store's key, for local setups that only
 * set the one key; in production the two must stay separate, because the
 * merch key went live (Nov 27, 2026) while the game checkout is still in
 * test mode, and a shared `:latest` would silently flip the game live.
 */
export function stripeFromEnv(env: Record<string, string | undefined>): { cfg: StripeConfig | null; missing: string[] } {
  const secretKey = env.STRIPE_GAME_SECRET_KEY || env.STRIPE_SECRET_KEY;
  const want = { STRIPE_GAME_SECRET_KEY: secretKey, STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET };
  const missing = Object.entries(want)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) return { cfg: null, missing };
  return {
    cfg: {
      secretKey: want.STRIPE_GAME_SECRET_KEY!,
      webhookSecret: want.STRIPE_WEBHOOK_SECRET!,
      sandbox: env.STRIPE_SANDBOX === '1',
      returnUrl: env.STRIPE_RETURN_URL || 'https://play.beech.games/',
    },
    missing: [],
  };
}
