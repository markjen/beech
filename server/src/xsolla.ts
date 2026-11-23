// Web checkout through Xsolla (docs/WEB_PAYMENTS.md). Xsolla is the merchant
// of record: the player pays on Xsolla's Pay Station page, Xsolla handles
// tax, fraud and refunds, and tells us by webhook. We never see card details.
//
// Two calls, both server-side:
//  - createPaymentToken: In-Game Store API "create payment token for
//    purchase" (POST https://store.xsolla.com/api/v3/project/{project_id}/admin/payment/token,
//    Basic auth project_id:api_key). One item by SKU (our product id); the
//    price comes from the Xsolla catalog, which mirrors server/src/products.ts.
//  - verifyWebhookSignature: Xsolla signs each webhook as
//    `Authorization: Signature <sha1(raw body + webhook secret key)>`, lower-case hex.
//
// Kept free of the app and the database so it can be unit tested on its own.

import { createHash, timingSafeEqual } from 'node:crypto';

export interface XsollaConfig {
  projectId: string;
  apiKey: string;
  /** the project's webhook secret key (not the API key) */
  webhookSecret: string;
  /** test payments only (Xsolla's sandbox and test cards) */
  sandbox: boolean;
  /** where Pay Station sends the player back to, e.g. https://beech.markjen.com/ */
  returnUrl: string;
}

export const STORE_API = 'https://store.xsolla.com/api';

/** The Pay Station page for a payment token. */
export function payStationUrl(token: string, sandbox: boolean): string {
  const host = sandbox ? 'https://sandbox-secure.xsolla.com' : 'https://secure.xsolla.com';
  return `${host}/paystation4/?token=${encodeURIComponent(token)}`;
}

/**
 * Check a webhook's signature over the raw body bytes (never re-serialized
 * JSON: that changes the hash). Constant-time compare; the header's hex is
 * lower-cased first.
 */
export function verifyWebhookSignature(rawBody: Uint8Array, authorization: string | undefined, secret: string): boolean {
  if (!secret || !authorization) return false;
  const m = /^Signature\s+([0-9a-fA-F]{40})$/.exec(authorization.trim());
  if (!m) return false;
  const want = createHash('sha1').update(rawBody).update(secret, 'utf8').digest();
  const got = Buffer.from(m[1].toLowerCase(), 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The signature Xsolla would send for `rawBody` (tests and local replays). */
export function signWebhook(rawBody: string | Uint8Array, secret: string): string {
  return `Signature ${createHash('sha1').update(rawBody).update(secret, 'utf8').digest('hex')}`;
}

export interface TokenRequest {
  userId: string;
  /** our product id, which is also the SKU in the Xsolla catalog */
  sku: string;
  /** our web order id: settings.external_id and custom_parameters.web_order */
  webOrderId: string;
  /** two-letter country, when known (Xsolla needs a country or the player's IPv4) */
  country?: string;
  /** the player's IPv4, passed as X-User-Ip when there is no country */
  ip?: string;
}

export interface TokenResult {
  token: string;
  /** Xsolla's order id; webhooks for this payment carry it as order.id */
  orderId: string;
}

export type CreateToken = (cfg: XsollaConfig, req: TokenRequest) => Promise<TokenResult>;

/** The request body for a one-item payment token (exported for tests). */
export function tokenBody(cfg: XsollaConfig, req: TokenRequest): Record<string, unknown> {
  const ret = new URL(cfg.returnUrl);
  ret.searchParams.set('web_order', req.webOrderId);
  return {
    sandbox: cfg.sandbox,
    user: { id: { value: req.userId }, ...(req.country ? { country: { value: req.country } } : {}) },
    purchase: { items: [{ sku: req.sku, quantity: 1 }] },
    settings: { external_id: req.webOrderId, return_url: ret.toString(), currency: 'USD' },
    custom_parameters: { web_order: req.webOrderId },
  };
}

export const createPaymentToken: CreateToken = async (cfg, req) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Basic ${Buffer.from(`${cfg.projectId}:${cfg.apiKey}`).toString('base64')}`,
  };
  if (!req.country && req.ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(req.ip)) headers['X-User-Ip'] = req.ip;
  const res = await fetch(`${STORE_API}/v3/project/${encodeURIComponent(cfg.projectId)}/admin/payment/token`, {
    method: 'POST',
    headers,
    body: JSON.stringify(tokenBody(cfg, req)),
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json().catch(() => ({}))) as { token?: string; order_id?: number | string; errorMessage?: string };
  if (!res.ok || !data.token || data.order_id === undefined) {
    // Xsolla's error message only (it never echoes our API key)
    throw new Error(`Xsolla refused the checkout (${res.status}${data.errorMessage ? `: ${data.errorMessage}` : ''})`);
  }
  return { token: data.token, orderId: String(data.order_id) };
};

/** The parts of an Xsolla webhook we act on (order_paid / order_canceled / user_validation / refund). */
export interface XsollaWebhook {
  notification_type?: string;
  order?: { id?: number | string; mode?: string; currency?: string; amount?: string | number; status?: string };
  items?: { sku?: string; quantity?: number }[];
  user?: { id?: string; external_id?: string };
  transaction?: { id?: number | string; external_id?: string; dry_run?: number };
  billing?: { transaction?: { id?: number | string; external_id?: string; dry_run?: number } };
  custom_parameters?: { web_order?: string } | null;
}

/** Xsolla's error body: 400 with { error: { code, message } }. */
export const xsollaError = (code: 'INVALID_SIGNATURE' | 'INVALID_USER' | 'INVALID_PARAMETER' | 'INCORRECT_AMOUNT' | 'INCORRECT_INVOICE', message: string) => ({
  error: { code, message },
});

/** Read the Xsolla settings from the environment; null unless fully set up. */
export function xsollaFromEnv(env: Record<string, string | undefined>): { cfg: XsollaConfig | null; missing: string[] } {
  const want = { XSOLLA_PROJECT_ID: env.XSOLLA_PROJECT_ID, XSOLLA_API_KEY: env.XSOLLA_API_KEY, XSOLLA_WEBHOOK_SECRET: env.XSOLLA_WEBHOOK_SECRET };
  const missing = Object.entries(want)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) return { cfg: null, missing };
  return {
    cfg: {
      projectId: want.XSOLLA_PROJECT_ID!,
      apiKey: want.XSOLLA_API_KEY!,
      webhookSecret: want.XSOLLA_WEBHOOK_SECRET!,
      sandbox: env.XSOLLA_SANDBOX === '1',
      returnUrl: env.WEB_CHECKOUT_RETURN_URL || 'https://beech.markjen.com/',
    },
    missing: [],
  };
}
