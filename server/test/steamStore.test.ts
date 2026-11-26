import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { openTestDb } from './testDb.js';
import {
  finalizeSteamTxn,
  getSteamRefunds,
  initSteamTxn,
  querySteamTxn,
  steamStoreFromEnv,
  syncSteamRefunds,
  type SteamStoreConfig,
} from '../src/steamStore.js';

const SANDBOX: SteamStoreConfig = { appId: '480', webApiKey: 'test-key', sandbox: true };
const LIVE: SteamStoreConfig = { appId: '480', webApiKey: 'test-key', sandbox: false };

describe('steamStore Web API helpers', () => {
  it('parses env config and picks sandbox vs live interface', async () => {
    expect(steamStoreFromEnv({})).toBeNull();
    expect(steamStoreFromEnv({ STEAM_APP_ID: '480', STEAM_WEB_API_KEY: 'k', STEAM_SANDBOX: '1' })).toEqual({
      appId: '480',
      webApiKey: 'k',
      sandbox: true,
    });

    const urls: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ response: { result: 'OK', params: { orderid: '1', transid: '9001', status: 'Succeeded' } } }));
    };

    await initSteamTxn(SANDBOX, { orderId: '1', steamId: '76561198000000001', itemId: 1002, amountCents: 299, description: 'Extra beach' }, fakeFetch);
    await finalizeSteamTxn(LIVE, '1', fakeFetch);
    await querySteamTxn(LIVE, '1', fakeFetch);

    expect(urls[0]).toContain('/ISteamMicroTxnSandbox/InitTxn/v3/');
    expect(urls[1]).toContain('/ISteamMicroTxn/FinalizeTxn/v2/');
    expect(urls[2]).toContain('/ISteamMicroTxn/QueryTxn/v3/');
  });

  it('collects refunded and charged-back transids from GetReport/v5', async () => {
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('type=CHARGEBACK')) {
        return new Response(JSON.stringify({ response: { result: 'OK', params: { orders: [{ transid: 'tx-cb' }] } } }));
      }
      return new Response(
        JSON.stringify({
          response: {
            result: 'OK',
            params: {
              orders: [
                { transid: 'tx-ok', status: 'Succeeded' },
                { transid: 'tx-ref', status: 'Refunded' },
              ],
            },
          },
        }),
      );
    };
    const ids = await getSteamRefunds(LIVE, '2026-11-23T00:00:00Z', fakeFetch);
    expect(ids.sort()).toEqual(['tx-cb', 'tx-ref']);
  });
});

describe('Steam Wallet microtransaction routes', () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let nextTrans = 50000;
  let failInit = false;
  let failFinalize = false;

  beforeAll(async () => {
    db = await openTestDb();
    app = createApp(db, {
      googleClientIds: [],
      appleClientIds: [],
      allowedOrigins: [],
      devAuth: true,
      steamAuth: { appId: '480', webApiKey: 'test-key' },
      steamStore: SANDBOX,
      verifySteam: async (ticket, _cfg, name = '') => ({ provider: 'steam', sub: `765611980000001${ticket.slice(-2)}`, name }),
      steamTxn: {
        init: async (_cfg, req) => {
          if (failInit) throw new Error('Steam down');
          return { transId: `tx-${nextTrans++}-${req.orderId}` };
        },
        finalize: async (_cfg, orderId) => {
          if (failFinalize) throw new Error('Not authorized');
          const r = await db.query<{ trans_id: string }>('SELECT trans_id FROM steam_orders WHERE order_id = $1', [orderId]);
          return { transId: r[0]?.trans_id ?? `tx-fin-${orderId}` };
        },
      },
    });
  });

  afterAll(async () => {
    await db?.close();
  });

  const post = (path: string, body: unknown, token?: string) =>
    app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  const signInSteam = async (suffix: string) => {
    const r = await post('/auth/steam', { ticket: `0123456789abcdef0123456789abcd${suffix}`, name: `Steam${suffix}` });
    return (await r.json()) as { token: string; user: { id: string } };
  };

  it('initializes, finalizes once, and grants a sand-buck pack idempotently', async () => {
    const { token } = await signInSteam('10');

    const initRes = await post('/store/steam/init', { productId: 'bucks_100' }, token);
    expect(initRes.status).toBe(200);
    const { orderId } = (await initRes.json()) as { orderId: string };

    const fin1 = await post('/store/steam/finalize', { orderId }, token);
    expect(fin1.status).toBe(200);
    expect(await fin1.json()).toEqual(expect.objectContaining({ ok: true, already: false }));

    // Repeat finalize is idempotent and does not double-grant
    const fin2 = await post('/store/steam/finalize', { orderId }, token);
    expect(fin2.status).toBe(200);
    expect(await fin2.json()).toEqual(expect.objectContaining({ ok: true, already: true }));

    // Steam sells sand-buck packs (docs/SAND_BUCKS.md): 130 to the balance, once
    const credit = (await (await app.request('/credit', { headers: { Authorization: `Bearer ${token}` } })).json()) as { bucks: number };
    expect(credit.bucks).toBe(130);
    // the Steam builds already out still buy things directly (PR #118 review)
    expect((await post('/store/steam/init', { productId: 'item_parasol' }, token)).status).toBe(200);
  });

  it('rejects non-Steam accounts, canceled orders, and init failures cleanly', async () => {
    const dev = (await (await post('/auth/dev', { name: 'WebOnly' })).json()) as { token: string };
    expect((await post('/store/steam/init', { productId: 'bucks_30' }, dev.token)).status).toBe(400);

    const { token } = await signInSteam('11');
    failInit = true;
    expect((await post('/store/steam/init', { productId: 'bucks_30' }, token)).status).toBe(502);
    failInit = false;

    const { orderId } = (await (await post('/store/steam/init', { productId: 'bucks_30' }, token)).json()) as { orderId: string };
    expect((await post('/store/steam/cancel', { orderId }, token)).status).toBe(204);
    expect((await post('/store/steam/finalize', { orderId }, token)).status).toBe(409);

    const { orderId: oid2 } = (await (await post('/store/steam/init', { productId: 'bucks_10' }, token)).json()) as { orderId: string };
    failFinalize = true;
    expect((await post('/store/steam/finalize', { orderId: oid2 }, token)).status).toBe(402);
    failFinalize = false;
  });

  it('takes the sand bucks back when syncSteamRefunds reports a refund', async () => {
    const { token } = await signInSteam('12');
    const { orderId } = (await (await post('/store/steam/init', { productId: 'bucks_30' }, token)).json()) as { orderId: string };
    expect((await post('/store/steam/finalize', { orderId }, token)).status).toBe(200);

    const rows = await db.query<{ trans_id: string }>('SELECT trans_id FROM steam_orders WHERE order_id = $1', [orderId]);
    const transId = rows[0]!.trans_id;

    const revoked = await syncSteamRefunds(db, SANDBOX, '2026-11-23T00:00:00Z', {
      getRefunds: async () => [transId],
    });
    expect(revoked).toBe(1);

    const credit = (await (await app.request('/credit', { headers: { Authorization: `Bearer ${token}` } })).json()) as { bucks: number; debt: number };
    expect(credit).toEqual(expect.objectContaining({ bucks: 0, debt: 0 }));
  });
});
