// Steam Wallet microtransactions (ISteamMicroTxn / ISteamMicroTxnSandbox).
// See docs/STEAM.md.
//
// Flow:
//   1. Server calls InitTxn/v3 -> Steam opens Wallet overlay on the client.
//   2. Client receives MicroTxnAuthorizationResponse_t and posts orderId to
//      /api/store/steam/finalize (or /cancel).
//   3. Server calls FinalizeTxn/v2 and atomically records purchases + inventory.
//   4. Hourly refund sync calls GetReport/v5 and revokes refunded/charged-back
//      transactions through the same refund() path as Apple/Google/Xsolla.

export interface SteamStoreConfig {
  appId: string;
  webApiKey: string;
  sandbox: boolean;
}

export function steamStoreFromEnv(env: NodeJS.ProcessEnv): SteamStoreConfig | null {
  const appId = (env.STEAM_APP_ID ?? '').trim();
  const webApiKey = (env.STEAM_WEB_API_KEY ?? '').trim();
  if (!appId || !webApiKey) return null;
  return { appId, webApiKey, sandbox: env.STEAM_SANDBOX === '1' };
}

const ifaceOf = (cfg: SteamStoreConfig) => (cfg.sandbox ? 'ISteamMicroTxnSandbox' : 'ISteamMicroTxn');

interface SteamApiEnvelope<P> {
  response?: {
    result?: string;
    params?: P;
    error?: { errorcode?: number; errordesc?: string };
  };
}

function unwrap<P>(data: SteamApiEnvelope<P>, label: string): P {
  const r = data.response;
  if (!r || r.result !== 'OK') {
    const desc = r?.error?.errordesc || (r?.error?.errorcode ? `error ${r.error.errorcode}` : 'rejected');
    throw new Error(`Steam ${label} failed: ${desc}`);
  }
  return (r.params ?? {}) as P;
}

export interface SteamInitRequest {
  orderId: string;
  steamId: string;
  itemId: number;
  amountCents: number;
  description: string;
  currency?: string;
  language?: string;
}

export async function initSteamTxn(
  cfg: SteamStoreConfig,
  req: SteamInitRequest,
  fetchFn: typeof fetch = fetch,
): Promise<{ transId: string }> {
  const body = new URLSearchParams({
    key: cfg.webApiKey,
    orderid: req.orderId,
    steamid: req.steamId,
    appid: cfg.appId,
    itemcount: '1',
    language: req.language ?? 'en',
    currency: req.currency ?? 'USD',
    'itemid[0]': String(req.itemId),
    'qty[0]': '1',
    'amount[0]': String(req.amountCents),
    'description[0]': req.description.slice(0, 128),
  });
  const res = await fetchFn(`https://partner.steam-api.com/${ifaceOf(cfg)}/InitTxn/v3/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Steam InitTxn HTTP ${res.status}`);
  const params = unwrap<{ orderid?: string; transid?: string }>((await res.json()) as SteamApiEnvelope<{ orderid?: string; transid?: string }>, 'InitTxn');
  if (!params.transid) throw new Error('Steam InitTxn returned no transid');
  return { transId: String(params.transid) };
}

export async function finalizeSteamTxn(
  cfg: SteamStoreConfig,
  orderId: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ transId: string }> {
  const body = new URLSearchParams({
    key: cfg.webApiKey,
    orderid: orderId,
    appid: cfg.appId,
  });
  const res = await fetchFn(`https://partner.steam-api.com/${ifaceOf(cfg)}/FinalizeTxn/v2/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Steam FinalizeTxn HTTP ${res.status}`);
  const params = unwrap<{ orderid?: string; transid?: string }>(
    (await res.json()) as SteamApiEnvelope<{ orderid?: string; transid?: string }>,
    'FinalizeTxn',
  );
  if (!params.transid) throw new Error('Steam FinalizeTxn returned no transid');
  return { transId: String(params.transid) };
}

export async function querySteamTxn(
  cfg: SteamStoreConfig,
  orderId: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ status: string; transId?: string }> {
  const qs = new URLSearchParams({
    key: cfg.webApiKey,
    appid: cfg.appId,
    orderid: orderId,
  });
  const res = await fetchFn(`https://partner.steam-api.com/${ifaceOf(cfg)}/QueryTxn/v3/?${qs.toString()}`);
  if (!res.ok) throw new Error(`Steam QueryTxn HTTP ${res.status}`);
  const params = unwrap<{ status?: string; transid?: string }>(
    (await res.json()) as SteamApiEnvelope<{ status?: string; transid?: string }>,
    'QueryTxn',
  );
  return { status: String(params.status ?? ''), transId: params.transid ? String(params.transid) : undefined };
}

interface ReportOrder {
  transid?: string;
  status?: string;
}

const REVOKED_STATUSES = new Set(['Refunded', 'PartialRefund', 'ChargedBack', 'Chargeback']);

import type { Db } from './db.js';

/**
 * Fetch refunded or charged-back transaction IDs from ISteamMicroTxn/GetReport/v5
 * starting at `sinceIso` (RFC 3339 UTC, e.g. `2026-11-23T00:00:00Z`).
 */
export async function getSteamRefunds(
  cfg: SteamStoreConfig,
  sinceIso: string,
  fetchFn: typeof fetch = fetch,
): Promise<string[]> {
  const found = new Set<string>();
  for (const type of ['CHARGEBACK', 'GAMESALES'] as const) {
    const qs = new URLSearchParams({
      key: cfg.webApiKey,
      appid: cfg.appId,
      type,
      time: sinceIso,
      maxresults: '1000',
    });
    const res = await fetchFn(`https://partner.steam-api.com/${ifaceOf(cfg)}/GetReport/v5/?${qs.toString()}`);
    if (!res.ok) throw new Error(`Steam GetReport(${type}) HTTP ${res.status}`);
    const params = unwrap<{ orders?: ReportOrder[] }>(
      (await res.json()) as SteamApiEnvelope<{ orders?: ReportOrder[] }>,
      `GetReport(${type})`,
    );
    for (const o of params.orders ?? []) {
      if (o.transid && (type === 'CHARGEBACK' || (o.status && REVOKED_STATUSES.has(o.status)))) {
        found.add(String(o.transid));
      }
    }
  }
  return [...found];
}

/**
 * Poll Steam for refunds/chargebacks since `sinceIso` and revoke any matching
 * purchases + inventory rows identically to Apple/Google/Xsolla refunds.
 */
export async function syncSteamRefunds(
  db: Db,
  cfg: SteamStoreConfig,
  sinceIso: string,
  opts: { getRefunds?: typeof getSteamRefunds; now?: number } = {},
): Promise<number> {
  const fetchRefunds = opts.getRefunds ?? getSteamRefunds;
  const transIds = await fetchRefunds(cfg, sinceIso);
  const now = opts.now ?? Date.now();
  let revoked = 0;
  for (const tx of transIds) {
    const res = await db.query<{ id: string }>(
      `WITH p AS (
         UPDATE purchases SET refunded_at = $2
          WHERE store = 'steam' AND transaction_id = $1 AND refunded_at IS NULL
         RETURNING id
       ), inv AS (
         UPDATE inventory SET expires_at = $2 WHERE purchase_id IN (SELECT id FROM p)
       )
       UPDATE steam_orders SET status = 'refunded'
        WHERE trans_id = $1 AND status = 'paid'
       RETURNING order_id::text AS id`,
      [tx, now],
    );
    if (res.length) revoked++;
  }
  return revoked;
}
