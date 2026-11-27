// Checking purchases with Apple and Google. The app buys through the store
// (StoreKit 2 / Google Play Billing); nothing is granted until the server has
// checked the purchase here. No card details ever reach us.
//
//  Apple   a StoreKit 2 transaction is a JWS signed by a certificate chain
//          that ends at Apple Root CA - G3. We check the chain (pinned root,
//          Apple's marker extensions, validity) and the signature, offline.
//  Google  the purchase token is looked up with the Google Play Developer
//          API (androidpublisher v3), using the server's own service account.
//
// Refunds arrive as App Store Server Notifications (a signed JWS, checked the
// same way) and Google Play real-time developer notifications (Pub/Sub push,
// authenticated with a Google-signed OIDC token).

import { revokeGrant } from './bucksDb.js';
import { storeProductById } from './products.js';
import { X509Certificate } from 'node:crypto';
import { compactVerify, createRemoteJWKSet, decodeProtectedHeader, jwtVerify, SignJWT, importPKCS8 } from 'jose';

import type { Db } from './db.js';
import { reverseCreatorCredit } from './creatorCredit.js';

import { APPLE_ROOT_CA_G3_DER_BASE64 } from './appleRoot.js';

export interface VerifiedPurchase {
  store: 'apple' | 'google' | 'dev';
  transactionId: string;
  productId: string;
  /** 'Production' / 'Sandbox' (Apple), 'Production' / 'Test' (Google) */
  environment: string;
  purchasedAt: number;
  /** the account the app tied the purchase to (appAccountToken / obfuscatedAccountId), if any */
  account?: string;
}

// ---------------------------------------------------------------- Apple

/** OID markers Apple puts in its StoreKit signing certificates. */
const LEAF_OID = Buffer.from('060a2a864886f76364060b01', 'hex'); // 1.2.840.113635.100.6.11.1
const INTERMEDIATE_OID = Buffer.from('060a2a864886f76364060201', 'hex'); // 1.2.840.113635.100.6.2.1

export interface AppleOptions {
  /** trusted roots (DER); default: Apple Root CA - G3 */
  roots?: Buffer[];
  now?: number;
}

/** Check an Apple-signed JWS (transaction or notification) and return its payload. */
export async function verifyAppleJws<T = Record<string, unknown>>(jws: string, opts: AppleOptions = {}): Promise<T> {
  const roots = opts.roots ?? [Buffer.from(APPLE_ROOT_CA_G3_DER_BASE64, 'base64')];
  const header = decodeProtectedHeader(jws);
  if (header.alg !== 'ES256') throw new Error('unexpected algorithm');
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length !== 3) throw new Error('expected a 3-certificate chain');
  const [leaf, mid, root] = x5c.map((b64) => new X509Certificate(Buffer.from(b64, 'base64')));
  if (!roots.some((r) => r.equals(root.raw))) throw new Error('not signed by Apple');
  if (!leaf.raw.includes(LEAF_OID) || !mid.raw.includes(INTERMEDIATE_OID)) throw new Error('not a StoreKit certificate');
  if (!leaf.verify(mid.publicKey) || !mid.verify(root.publicKey) || !leaf.checkIssued(mid) || !mid.checkIssued(root)) {
    throw new Error('broken certificate chain');
  }
  const now = opts.now ?? Date.now();
  for (const c of [leaf, mid, root]) {
    if (now < Date.parse(c.validFrom) || now > Date.parse(c.validTo)) throw new Error('certificate out of date');
  }
  const { payload } = await compactVerify(jws, leaf.publicKey, { algorithms: ['ES256'] });
  return JSON.parse(new TextDecoder().decode(payload)) as T;
}

interface AppleTransaction {
  transactionId: string;
  originalTransactionId?: string;
  bundleId: string;
  productId: string;
  purchaseDate: number;
  environment: string;
  type?: string;
  revocationDate?: number;
  appAccountToken?: string;
}

export async function verifyAppleTransaction(jws: string, bundleId: string, opts: AppleOptions = {}): Promise<VerifiedPurchase> {
  const t = await verifyAppleJws<AppleTransaction>(jws, opts);
  if (t.bundleId !== bundleId) throw new Error('purchase is for another app');
  if (t.revocationDate) throw new Error('purchase was refunded');
  return {
    store: 'apple',
    transactionId: String(t.transactionId),
    productId: t.productId,
    environment: t.environment,
    purchasedAt: Number(t.purchaseDate),
    account: t.appAccountToken,
  };
}

/** App Store Server Notifications V2: the refunded/revoked transaction id, if this is one. */
export async function appleRefund(signedPayload: string, bundleId: string, opts: AppleOptions = {}): Promise<string | null> {
  const n = await verifyAppleJws<{ notificationType: string; data?: { bundleId?: string; signedTransactionInfo?: string } }>(signedPayload, opts);
  if (n.notificationType !== 'REFUND' && n.notificationType !== 'REVOKE') return null;
  if (!n.data?.signedTransactionInfo) return null;
  const t = await verifyAppleJws<AppleTransaction>(n.data.signedTransactionInfo, opts);
  if (t.bundleId !== bundleId) return null;
  return String(t.transactionId);
}

// ---------------------------------------------------------------- Google

const PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

/**
 * An access token for the Play Developer API. On Cloud Run the server's own
 * service account is used (add it in Play Console → Users and permissions);
 * elsewhere GOOGLE_PLAY_SERVICE_ACCOUNT can hold a service-account JSON key.
 */
async function playToken(): Promise<string> {
  const keyJson = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT;
  if (keyJson) {
    const key = JSON.parse(keyJson) as { client_email: string; private_key: string; token_uri?: string };
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: PUBLISHER_SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(key.client_email)
      .setAudience(key.token_uri ?? 'https://oauth2.googleapis.com/token')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(await importPKCS8(key.private_key, 'RS256'));
    const res = await fetch(key.token_uri ?? 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throw new Error(`play token: ${res.status}`);
    return ((await res.json()) as { access_token: string }).access_token;
  }
  const res = await fetch(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(PUBLISHER_SCOPE)}`,
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!res.ok) throw new Error(`play token (metadata): ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

interface PlayProductPurchase {
  purchaseState?: number; // 0 purchased, 1 cancelled, 2 pending
  orderId?: string;
  purchaseTimeMillis?: string;
  purchaseType?: number; // 0 test
  obfuscatedExternalAccountId?: string;
}

export async function verifyGooglePurchase(packageName: string, productId: string, token: string): Promise<VerifiedPurchase> {
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}` +
    `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await playToken()}` } });
  if (res.status === 404 || res.status === 400) throw new Error('Google Play does not know this purchase');
  if (!res.ok) throw new Error(`Google Play: ${res.status}`);
  const p = (await res.json()) as PlayProductPurchase;
  if (p.purchaseState !== 0) throw new Error(p.purchaseState === 2 ? 'purchase still pending' : 'purchase was cancelled');
  return {
    store: 'google',
    // the order id is stable per purchase (the token can be long); fall back to the token
    transactionId: p.orderId || token,
    productId,
    environment: p.purchaseType === 0 ? 'Test' : 'Production',
    purchasedAt: Number(p.purchaseTimeMillis ?? Date.now()),
    account: p.obfuscatedExternalAccountId,
  };
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/**
 * A request from a Google service account (Pub/Sub push, Cloud Scheduler):
 * a Google-signed OIDC token for our audience, from that account.
 */
export async function verifyGoogleOidc(authorization: string | undefined, expect: { audience: string; email: string }): Promise<void> {
  const m = /^Bearer\s+(\S+)$/.exec(authorization ?? '');
  if (!m) throw new Error('missing push token');
  const { payload } = await jwtVerify(m[1], GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: expect.audience,
  });
  if (payload.email !== expect.email || payload.email_verified !== true) throw new Error('unexpected push sender');
}

/**
 * Google Play real-time developer notification, pushed by Pub/Sub. Returns
 * the voided (refunded) order id, if this is one. The push must carry a
 * Google-signed OIDC token for our audience and push service account.
 */
export async function googleVoided(
  authorization: string | undefined,
  body: { message?: { data?: string } },
  expect: { audience: string; email: string },
): Promise<string | null> {
  await verifyGoogleOidc(authorization, expect);
  const data = body.message?.data ? JSON.parse(Buffer.from(body.message.data, 'base64').toString('utf8')) : null;
  const v = data?.voidedPurchaseNotification as { orderId?: string; purchaseToken?: string } | undefined;
  return v?.orderId ?? null;
}

/**
 * A refund, from any store: the purchase is marked, what it granted
 * expires now, and a pack's beech bucks (plus any promo bonus or traded-in
 * thing's bucks) come back out. Shared by the Apple/Google notification
 * handlers (via `refund()` in app.ts), the Steam `GetReport/v5` sync
 * (`syncSteamRefunds` in steamStore.ts), and admin-issued refunds.
 */
async function revokePurchaseEffects(
  tx: Db,
  purchase: { id: string; user_id: string; product_id: string },
  now: number,
): Promise<void> {
  await tx.query('UPDATE inventory SET expires_at = $2 WHERE purchase_id = $1', [purchase.id, now]);
  await reverseCreatorCredit(tx, purchase.id, now);
  // beech bucks (docs/BEECH_BUCKS.md): a pack's bucks (and any promo bonus)
  // come back out, and so do the bucks of any of its things that were traded in
  await revokeGrant(tx, { purchaseId: purchase.id, userId: purchase.user_id, product: storeProductById(purchase.product_id), now });
}

export async function revokeStorePurchase(
  db: Db,
  store: 'apple' | 'google' | 'xsolla' | 'steam',
  transactionId: string,
  now: number,
): Promise<void> {
  await db.withTransaction(async (tx) => {
    const [purchase] = await tx.query<{ id: string; user_id: string; product_id: string }>(
      `UPDATE purchases SET refunded_at = $3 WHERE store = $1 AND transaction_id = $2 AND refunded_at IS NULL RETURNING id, user_id, product_id`,
      [store, transactionId, now],
    );
    if (!purchase) return;
    await revokePurchaseEffects(tx, purchase, now);
  });
}

/**
 * Admin-issued refund of a recorded purchase by its internal `purchases.id`.
 * Run inside a transaction. Returns the refunded purchase row, or null if not
 * found or already refunded.
 */
export async function revokePurchaseById(
  tx: Db,
  purchaseId: string,
  now: number,
): Promise<{ id: string; user_id: string; store: string; transaction_id: string; product_id: string } | null> {
  const [purchase] = await tx.query<{ id: string; user_id: string; store: string; transaction_id: string; product_id: string }>(
    `UPDATE purchases SET refunded_at = $2 WHERE id = $1 AND refunded_at IS NULL
     RETURNING id, user_id, store, transaction_id, product_id`,
    [purchaseId, now],
  );
  if (!purchase) return null;
  if (purchase.store === 'xsolla') {
    await tx.query(`UPDATE web_orders SET status = 'refunded' WHERE provider_order_id = $1 AND status = 'paid'`, [purchase.transaction_id]);
  } else if (purchase.store === 'steam') {
    await tx.query(`UPDATE steam_orders SET status = 'refunded' WHERE trans_id = $1 AND status = 'paid'`, [purchase.transaction_id]);
  }
  await revokePurchaseEffects(tx, purchase, now);
  return purchase;
}
