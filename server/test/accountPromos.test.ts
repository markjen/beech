import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminApp } from '../src/adminApp.js';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/auth.js';
import { openTestDb, type TestDb } from './testDb.js';

const CLI_TOKEN = 'test-cli-token-promos';

describe('account-loaded promo codes for bb packs', () => {
  let db: TestDb;
  let now = Date.now();
  let app: ReturnType<typeof createApp>;
  let admin: ReturnType<typeof createAdminApp>;

  const json = (method: string, body: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const req = (path: string, init: RequestInit = {}, token?: string) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return app.request(path, { ...init, headers });
  };
  const areq = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${CLI_TOKEN}`);
    return admin.request(path, { ...init, headers });
  };

  async function devUser(name: string) {
    const r = await req('/auth/dev', json('POST', { name }));
    return (await r.json()) as { token: string; user: { id: string; name: string } };
  }

  async function buyPack(token: string, productId: string, txId: string) {
    return req('/store/purchase', json('POST', { platform: 'dev', productId, token: txId }), token);
  }

  async function balanceOf(token: string) {
    const r = await req('/credit', {}, token);
    const d = (await r.json()) as { bucks: number; debt: number };
    return { bucks: d.bucks, debt: d.debt };
  }

  beforeAll(async () => {
    db = await openTestDb();
    app = createApp(db, { devAuth: true, now: () => now });
    admin = createAdminApp(db, {
      googleClientId: null,
      adminEmails: [],
      adminTokenHash: await hashToken(CLI_TOKEN),
      now: () => now,
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it('collects multiple promo codes and automatically applies the best deal per pack', async () => {
    // Create two promos: +25 fixed bb and +20% bb
    expect((await areq('/api/promo-codes', json('POST', { code: 'FLAT25', kind: 'fixed', value: 25 }))).status).toBe(200);
    expect((await areq('/api/promo-codes', json('POST', { code: 'PCT20', kind: 'percent', value: 20 }))).status).toBe(200);

    const alice = await devUser('Alice');

    // Load both codes onto Alice's account
    const load1 = await req('/promo-codes/load', json('POST', { code: 'flat25' }), alice.token);
    expect(load1.status).toBe(200);
    const load2 = await req('/promo-codes/load', json('POST', { code: 'PCT20' }), alice.token);
    expect(load2.status).toBe(200);
    const body2 = (await load2.json()) as { packBonuses: Record<string, { code: string; bonusBucks: number }> };

    // On bucks_30 (33 bb): FLAT25 gives +25 vs PCT20 gives ceil(33*0.2)=+7 -> FLAT25 wins
    expect(body2.packBonuses.bucks_30).toEqual({ code: 'FLAT25', bonusBucks: 25 });
    // On bucks_200 (280 bb): PCT20 gives ceil(280*0.2)=+56 vs FLAT25 gives +25 -> PCT20 wins
    expect(body2.packBonuses.bucks_200).toEqual({ code: 'PCT20', bonusBucks: 56 });

    // Re-loading an already loaded code is rejected (409)
    expect((await req('/promo-codes/load', json('POST', { code: 'FLAT25' }), alice.token)).status).toBe(409);

    // Buy bucks_200 -> automatically uses PCT20 (+56 bonus bb on top of 280 bb = 336 bb)
    const buy1 = await buyPack(alice.token, 'bucks_200', 'tx-alice-1');
    expect(buy1.status).toBe(200);
    expect(await buy1.json()).toEqual(expect.objectContaining({ already: false, product: 'bucks_200', promo: { code: 'PCT20', bonusBucks: 56 } }));
    expect(await balanceOf(alice.token)).toEqual({ bucks: 336, debt: 0 });

    // PCT20 cannot be re-loaded or reused by Alice (once per account max)
    expect((await req('/promo-codes/load', json('POST', { code: 'PCT20' }), alice.token)).status).toBe(409);

    // Next purchase (bucks_30, 33 bb) automatically uses remaining FLAT25 (+25 bonus bb = 58 bb)
    const buy2 = await buyPack(alice.token, 'bucks_30', 'tx-alice-2');
    expect(buy2.status).toBe(200);
    expect(await buy2.json()).toEqual(expect.objectContaining({ promo: { code: 'FLAT25', bonusBucks: 25 } }));
    expect(await balanceOf(alice.token)).toEqual({ bucks: 336 + 33 + 25, debt: 0 });

    // Third purchase has no remaining ready promos -> normal grant only
    const buy3 = await buyPack(alice.token, 'bucks_10', 'tx-alice-3');
    expect(buy3.status).toBe(200);
    const buy3Body = (await buy3.json()) as { promo?: unknown };
    expect(buy3Body.promo).toBeUndefined();
    expect(await balanceOf(alice.token)).toEqual({ bucks: 336 + 58 + 10, debt: 0 });
  });

  it('respects pack restrictions, expiration, disable, and maxUses after loading', async () => {
    expect((await areq('/api/promo-codes', json('POST', { code: 'BIGONLY', kind: 'fixed', value: 100, appliesTo: 'bucks_200' }))).status).toBe(200);
    expect((await areq('/api/promo-codes', json('POST', { code: 'EXPIRING', kind: 'fixed', value: 50, expiresAt: now + 1000 }))).status).toBe(200);
    expect((await areq('/api/promo-codes', json('POST', { code: 'DISABLING', kind: 'fixed', value: 40 }))).status).toBe(200);
    expect((await areq('/api/promo-codes', json('POST', { code: 'FALLBACK5', kind: 'fixed', value: 5 }))).status).toBe(200);

    const bob = await devUser('Bob');
    for (const c of ['BIGONLY', 'EXPIRING', 'DISABLING', 'FALLBACK5']) {
      expect((await req('/promo-codes/load', json('POST', { code: c }), bob.token)).status).toBe(200);
    }

    // Expire EXPIRING and disable DISABLING before Bob buys
    now += 2000;
    expect((await areq('/api/promo-codes/DISABLING/disable', json('POST', {}))).status).toBe(200);

    // Buying bucks_10: BIGONLY doesn't apply, EXPIRING is expired, DISABLING is disabled -> FALLBACK5 applies
    const buy = await buyPack(bob.token, 'bucks_10', 'tx-bob-1');
    expect(buy.status).toBe(200);
    expect(await buy.json()).toEqual(expect.objectContaining({ promo: { code: 'FALLBACK5', bonusBucks: 5 } }));
    expect(await balanceOf(bob.token)).toEqual({ bucks: 15, debt: 0 });

    // Expired/disabled promos cannot be newly loaded by another account
    const carol = await devUser('Carol');
    expect((await req('/promo-codes/load', json('POST', { code: 'EXPIRING' }), carol.token)).status).toBe(400);
    expect((await req('/promo-codes/load', json('POST', { code: 'DISABLING' }), carol.token)).status).toBe(400);
  });

  it('concurrent buyers racing on a maxUses=1 promo: one claims it, the other falls through to next best', async () => {
    expect((await areq('/api/promo-codes', json('POST', { code: 'RACE50', kind: 'fixed', value: 50, maxUses: 1 }))).status).toBe(200);
    expect((await areq('/api/promo-codes', json('POST', { code: 'BACKUP10', kind: 'fixed', value: 10 }))).status).toBe(200);

    const u1 = await devUser('Racer1');
    const u2 = await devUser('Racer2');
    for (const u of [u1, u2]) {
      expect((await req('/promo-codes/load', json('POST', { code: 'RACE50' }), u.token)).status).toBe(200);
      expect((await req('/promo-codes/load', json('POST', { code: 'BACKUP10' }), u.token)).status).toBe(200);
    }

    const [r1, r2] = await Promise.all([
      buyPack(u1.token, 'bucks_10', 'tx-race-1'),
      buyPack(u2.token, 'bucks_10', 'tx-race-2'),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const b1 = (await r1.json()) as { promo?: { code: string; bonusBucks: number } };
    const b2 = (await r2.json()) as { promo?: { code: string; bonusBucks: number } };
    const codes = [b1.promo?.code, b2.promo?.code].sort();
    expect(codes).toEqual(['BACKUP10', 'RACE50']);

    const uses = await db.query<{ uses: number }>("SELECT uses FROM promo_codes WHERE code = 'RACE50'");
    expect(Number(uses[0].uses)).toBe(1);
  });

  it('refunding a pack purchase claws back both base pack bb and promo bonus bb', async () => {
    expect((await areq('/api/promo-codes', json('POST', { code: 'REFUND20', kind: 'fixed', value: 20 }))).status).toBe(200);
    const dave = await devUser('Dave');
    expect((await req('/promo-codes/load', json('POST', { code: 'REFUND20' }), dave.token)).status).toBe(200);

    const buy = await buyPack(dave.token, 'bucks_30', 'tx-dave-1');
    expect(buy.status).toBe(200);
    expect(await balanceOf(dave.token)).toEqual({ bucks: 53, debt: 0 }); // 33 + 20

    // Dave spends 30 bb on a lighthouse, leaving 23 bb
    const spend = await req('/store/credit-purchase', json('POST', { productId: 'item_lighthouse' }), dave.token);
    expect(spend.status).toBe(200);
    expect(await balanceOf(dave.token)).toEqual({ bucks: 23, debt: 0 });

    // Admin refunds Dave's purchase: 33 + 20 = 53 bb clawed back -> 23 bb balance goes to 0, 30 bb becomes debt
    const [pRow] = await db.query<{ id: string }>("SELECT id FROM purchases WHERE transaction_id = 'tx-dave-1'");
    const ref = await areq(`/api/purchases/${pRow.id}/refund`, json('POST', { reason: 'Customer requested refund' }));
    expect(ref.status).toBe(200);
    expect(await balanceOf(dave.token)).toEqual({ bucks: 0, debt: 30 });
  });
});
