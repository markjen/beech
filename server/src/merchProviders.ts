// The merch store's two outside services (docs/MERCH_STORE.md): Stripe takes
// the payment (Checkout, hosted by Stripe: no card details reach us) and
// Printful prints and ships. Plain fetch, no SDKs; tests pass their own
// `fetch` and answer as the services would.
import { createHmac, timingSafeEqual } from 'node:crypto';

import { MERCH, type PrintItem } from './merchCatalog.js';

type Fetch = typeof fetch;

export interface MerchConfig {
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  printfulToken: string;
  /** Printful store id, for account-level tokens (X-PF-Store-Id); unset for a store token */
  printfulStoreId?: string;
  /** the secret in the Printful webhook's URL (Printful's v1 webhooks are unsigned) */
  printfulWebhookSecret: string;
  /** the store's public origin: Stripe returns here, and Printful fetches print files from it */
  storeUrl: string;
  /** Printful Warehousing variant id of the sunglasses; null: sold out */
  sunglassesVariant: number | null;
  /** Stripe Tax on the checkout (needs Stripe Tax set up in the dashboard) */
  stripeTax: boolean;
  /** drafts only: orders go to Printful but are never confirmed (testing the whole path without printing) */
  printfulDraftsOnly: boolean;
  fetch?: Fetch;
}

/** Settings from the environment; null (with what's missing) until all four secrets are there. */
export function merchFromEnv(env: Record<string, string | undefined>): { cfg: MerchConfig | null; missing: string[] } {
  // The merch webhook has its own signing secret (and env var): the game's
  // Stripe checkout (docs/STRIPE_PAYMENTS.md, PR #191) uses
  // STRIPE_WEBHOOK_SECRET / beech-stripe-webhook-secret for a different
  // endpoint, and one Stripe signing secret verifies only its own endpoint.
  const need = ['STRIPE_SECRET_KEY', 'STRIPE_MERCH_WEBHOOK_SECRET', 'PRINTFUL_TOKEN', 'PRINTFUL_WEBHOOK_SECRET'] as const;
  const missing = need.filter((k) => !env[k]);
  if (missing.length) return { cfg: null, missing };
  const glasses = Number(env.MERCH_SUNGLASSES_VARIANT);
  return {
    missing: [],
    cfg: {
      stripeSecretKey: env.STRIPE_SECRET_KEY!,
      stripeWebhookSecret: env.STRIPE_MERCH_WEBHOOK_SECRET!,
      printfulToken: env.PRINTFUL_TOKEN!,
      printfulStoreId: env.PRINTFUL_STORE_ID || undefined,
      printfulWebhookSecret: env.PRINTFUL_WEBHOOK_SECRET!,
      storeUrl: (env.STORE_URL || 'https://store.beech.games').replace(/\/$/, ''),
      sunglassesVariant: Number.isInteger(glasses) && glasses > 0 ? glasses : null,
      stripeTax: env.MERCH_STRIPE_TAX === '1',
      printfulDraftsOnly: env.PRINTFUL_DRAFTS_ONLY === '1',
    },
  };
}

// ------------------------------------------------------------------ Stripe

const STRIPE = 'https://api.stripe.com/v1';

/** Stripe's form encoding: nested keys as a[b][0][c]=v. */
export function stripeForm(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? stripeForm(x as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === 'object') stripeForm(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripeCall<T>(cfg: MerchConfig, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const f = cfg.fetch ?? fetch;
  const res = await f(`${STRIPE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.stripeSecretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? stripeForm(body).toString() : undefined,
  });
  const out = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`stripe ${res.status}: ${out.error?.message ?? 'error'}`);
  return out;
}

export interface CheckoutLine {
  name: string;
  description: string;
  unitCents: number;
  quantity: number;
}

export interface StripeSession {
  id: string;
  url?: string | null;
  status?: 'open' | 'complete' | 'expired';
  payment_status?: 'paid' | 'unpaid' | 'no_payment_required';
  payment_intent?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
  customer_details?: { email?: string | null; name?: string | null; phone?: string | null } | null;
  shipping_details?: StripeShipping | null;
  collected_information?: { shipping_details?: StripeShipping | null } | null;
  shipping_cost?: { amount_total?: number } | null;
  total_details?: { amount_tax?: number } | null;
}
export interface StripeShipping {
  name?: string | null;
  address?: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null } | null;
}

/** A Stripe Checkout session for one order. The order id is the idempotency key, so a retried POST makes one session. */
export function createCheckoutSession(
  cfg: MerchConfig,
  order: { id: string; lines: CheckoutLine[]; shippingCents: number; email?: string },
): Promise<StripeSession> {
  return stripeCall<StripeSession>(
    cfg,
    'POST',
    '/checkout/sessions',
    {
      mode: 'payment',
      client_reference_id: order.id,
      metadata: { order_id: order.id },
      payment_intent_data: { metadata: { order_id: order.id } },
      success_url: `${cfg.storeUrl}/order/${order.id}`,
      cancel_url: `${cfg.storeUrl}/bag`,
      customer_email: order.email,
      line_items: order.lines.map((l) => ({
        quantity: l.quantity,
        price_data: { currency: 'usd', unit_amount: l.unitCents, product_data: { name: l.name, ...(l.description ? { description: l.description } : {}) } },
      })),
      shipping_address_collection: { allowed_countries: [...MERCH.countries] },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: order.shippingCents ? 'Standard shipping' : 'Free shipping',
            fixed_amount: { amount: order.shippingCents, currency: 'usd' },
          },
        },
      ],
      phone_number_collection: { enabled: true },
      ...(cfg.stripeTax ? { automatic_tax: { enabled: true } } : {}),
    },
    `merch-checkout-${order.id}`,
  );
}

export const retrieveCheckoutSession = (cfg: MerchConfig, id: string): Promise<StripeSession> =>
  stripeCall<StripeSession>(cfg, 'GET', `/checkout/sessions/${encodeURIComponent(id)}`);

/** Stripe's webhook signature: `t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`, within 5 minutes. */
export function verifyStripeSignature(raw: string, header: string | undefined, secret: string, nowMs: number, toleranceS = 300): boolean {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > toleranceS) return false;
  const want = createHmac('sha256', secret).update(`${t}.${raw}`).digest();
  return parts
    .filter(([k]) => k === 'v1')
    .some(([, v]) => {
      const got = Buffer.from(v ?? '', 'hex');
      return got.length === want.length && timingSafeEqual(got, want);
    });
}

/** Sign a body the way Stripe does (tests, and `stripe trigger`-free local runs). */
export const signStripe = (raw: string, secret: string, nowMs: number): string => {
  const t = Math.floor(nowMs / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
};

// ---------------------------------------------------------------- Printful

const PRINTFUL = 'https://api.printful.com';

export interface Recipient {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state_code?: string;
  country_code: string;
  zip: string;
  email?: string;
  phone?: string;
}

export interface PrintfulOrder {
  id: number;
  external_id: string;
  status: string;
}

async function printfulCall<T>(cfg: MerchConfig, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; result: T | null; error: string }> {
  const f = cfg.fetch ?? fetch;
  const res = await f(`${PRINTFUL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.printfulToken}`,
      ...(cfg.printfulStoreId ? { 'X-PF-Store-Id': cfg.printfulStoreId } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = (await res.json().catch(() => ({}))) as { result?: T; error?: { message?: string } | string };
  const error = typeof out.error === 'string' ? out.error : (out.error?.message ?? '');
  return { status: res.status, result: res.ok ? (out.result ?? null) : null, error };
}

/** Printful's external_id: our order id without dashes (Printful allows 32 characters). */
export const externalId = (orderId: string) => orderId.replace(/-/g, '');

/**
 * Make (or find) the draft Printful order for one of ours. Printful keeps
 * one order per external_id, so asking twice, or after a worker died
 * between the two, finds the first (specs/tla/MerchOrders.tla, Draft).
 */
export async function printfulDraft(cfg: MerchConfig, orderId: string, recipient: Recipient, items: PrintItem[], shippingCents: number): Promise<PrintfulOrder> {
  const ext = externalId(orderId);
  const found = await printfulCall<PrintfulOrder>(cfg, 'GET', `/orders/@${ext}`);
  if (found.result) return found.result;
  if (found.status !== 404) throw new Error(`printful ${found.status}: ${found.error}`);
  const dollars = (c: number) => (c / 100).toFixed(2);
  const made = await printfulCall<PrintfulOrder>(cfg, 'POST', '/orders', {
    external_id: ext,
    shipping: 'STANDARD',
    recipient,
    items: items.map((i) => ({
      ...(i.warehouseVariantId ? { warehouse_product_variant_id: i.warehouseVariantId } : { variant_id: i.variantId }),
      quantity: i.quantity,
      name: i.name,
      retail_price: dollars(i.retailCents),
      ...(i.files ? { files: i.files } : {}),
      ...(i.options ? { options: i.options } : {}),
    })),
    retail_costs: { shipping: dollars(shippingCents) },
  });
  if (made.result) return made.result;
  // a second POST for the same external_id: Printful refuses it; the first one is the order
  const again = await printfulCall<PrintfulOrder>(cfg, 'GET', `/orders/@${ext}`);
  if (again.result) return again.result;
  throw new Error(`printful ${made.status}: ${made.error}`);
}

/** Confirm the draft: it goes into production. Confirming one already confirmed is fine. */
export async function printfulConfirm(cfg: MerchConfig, orderId: string): Promise<PrintfulOrder> {
  const ext = externalId(orderId);
  const r = await printfulCall<PrintfulOrder>(cfg, 'POST', `/orders/@${ext}/confirm`);
  if (r.result) return r.result;
  const now = await printfulCall<PrintfulOrder>(cfg, 'GET', `/orders/@${ext}`);
  if (now.result && now.result.status !== 'draft') return now.result;
  throw new Error(`printful ${r.status}: ${r.error}`);
}
