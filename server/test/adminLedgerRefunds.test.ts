import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminApp } from '../src/adminApp.js';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/auth.js';
import { openTestDb, type TestDb } from './testDb.js';

const CLI_TOKEN = 'test-cli-token-ledger';

describe('admin user lookup, ledger corrections, debt forgiveness, and refunds', () => {
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

  it('searches users, inspects detail, applies ledger corrections, and forgives debt', async () => {
    const alice = await devUser('LedgerAlice');
    // Ensure home beach exists so beach code search works
    const meRes = await req('/neighbors', {}, alice.token);
    const { code: beachCode } = (await meRes.json()) as { code: string };

    // Search by name, UUID, and beach code
    for (const q of ['LedgerAlice', alice.user.id, beachCode]) {
      const s = await areq(`/api/users?q=${encodeURIComponent(q)}`);
      expect(s.status).toBe(200);
      const body = (await s.json()) as { users: { id: string; name: string; bucks: number; debt: number }[] };
      expect(body.users.some((u) => u.id === alice.user.id)).toBe(true);
    }

    // Validation errors on ledger correction
    expect((await areq(`/api/users/${alice.user.id}/ledger`, json('POST', { bucks: 0, reason: 'nope' }))).status).toBe(400);
    expect((await areq(`/api/users/${alice.user.id}/ledger`, json('POST', { bucks: 10, reason: '   ' }))).status).toBe(400);
    expect((await areq(`/api/users/${alice.user.id}/ledger`, json('POST', { bucks: -5, kind: 'admin_refund', reason: 'bad' }))).status).toBe(400);

    // Credit +50 bb via admin_adjustment
    const add = await areq(`/api/users/${alice.user.id}/ledger`, json('POST', { bucks: 50, reason: 'Comp for bug' }));
    expect(add.status).toBe(200);
    expect(await add.json()).toEqual({
      user: { id: alice.user.id, bucks: 50, debt: 0 },
      bucks: 50,
      kind: 'admin_adjustment',
      reason: 'Comp for bug',
    });

    // Debit -80 bb -> balance goes to 0, 30 bb becomes debt
    const sub = await areq(`/api/users/${alice.user.id}/ledger`, json('POST', { bucks: -80, reason: 'Duplicate credit reversal' }));
    expect(sub.status).toBe(200);
    expect(await sub.json()).toEqual(expect.objectContaining({ user: { id: alice.user.id, bucks: 0, debt: 30 } }));

    // Forgive 10 bb of debt -> debt becomes 20, balance stays 0
    const forg1 = await areq(`/api/users/${alice.user.id}/forgive-debt`, json('POST', { bucks: 10, reason: 'Partial goodwill waiver' }));
    expect(forg1.status).toBe(200);
    expect(await forg1.json()).toEqual({ user: { id: alice.user.id, bucks: 0, debt: 20 }, forgiven: 10, reason: 'Partial goodwill waiver' });

    // Forgive remaining debt
    const forg2 = await areq(`/api/users/${alice.user.id}/forgive-debt`, json('POST', { reason: 'Full waiver' }));
    expect(forg2.status).toBe(200);
    expect(await forg2.json()).toEqual({ user: { id: alice.user.id, bucks: 0, debt: 0 }, forgiven: 20, reason: 'Full waiver' });

    // Forgiving again when debt is 0 returns 409
    expect((await areq(`/api/users/${alice.user.id}/forgive-debt`, json('POST', { reason: 'none' }))).status).toBe(409);

    // Issue a bb refund (+15 bb)
    const bbRef = await areq(`/api/users/${alice.user.id}/ledger`, json('POST', { bucks: 15, kind: 'admin_refund', reason: 'Lost claw try' }));
    expect(bbRef.status).toBe(200);
    expect(await bbRef.json()).toEqual(expect.objectContaining({ user: { id: alice.user.id, bucks: 15, debt: 0 }, kind: 'admin_refund' }));

    // Inspect user detail: ledger has plain-words labels
    const detail = await areq(`/api/users/${alice.user.id}`);
    expect(detail.status).toBe(200);
    const dBody = (await detail.json()) as {
      user: { bucks: number; debt: number };
      ledger: { kind: string; bucks: number; what: string }[];
    };
    expect(dBody.user).toEqual(expect.objectContaining({ bucks: 15, debt: 0 }));
    expect(dBody.ledger.map((l) => [l.kind, l.bucks, l.what])).toContainEqual(['admin_refund', 15, 'Refund: Lost claw try']);
    expect(dBody.ledger.map((l) => [l.kind, l.bucks, l.what])).toContainEqual(['admin_adjustment', 50, 'Account adjustment: Comp for bug']);

    // Audit log recorded all actions
    const audit = (await (await areq('/api/audit')).json()) as { audit: { action: string }[] };
    const actions = audit.audit.map((a) => a.action);
    expect(actions).toContain('user.ledger_adjustment');
    expect(actions).toContain('user.forgive_debt');
    expect(actions).toContain('user.bb_refund');
  });

  it('issues a purchase refund from admin and refuses double refunds', async () => {
    const bob = await devUser('RefundBob');
    const buy = await req('/store/purchase', json('POST', { platform: 'dev', productId: 'bucks_50', token: 'tx-admin-ref-1' }), bob.token);
    expect(buy.status).toBe(200);

    const detail1 = (await (await areq(`/api/users/${bob.user.id}`)).json()) as {
      user: { bucks: number };
      purchases: { id: string; productId: string; refundedAt: number | null }[];
    };
    expect(detail1.user.bucks).toBe(60);
    expect(detail1.purchases).toHaveLength(1);
    expect(detail1.purchases[0].refundedAt).toBeNull();

    const pid = detail1.purchases[0].id;
    const ref = await areq(`/api/purchases/${pid}/refund`, json('POST', { reason: 'Accidental purchase' }));
    expect(ref.status).toBe(200);
    expect(await ref.json()).toEqual(expect.objectContaining({ purchaseId: pid, user: { id: bob.user.id, bucks: 0, debt: 0 } }));

    // Second refund attempt returns 409
    expect((await areq(`/api/purchases/${pid}/refund`, json('POST', { reason: 'again' }))).status).toBe(409);
    // Non-existent purchase returns 404
    expect((await areq('/api/purchases/999999/refund', json('POST', {}))).status).toBe(404);
  });
});
