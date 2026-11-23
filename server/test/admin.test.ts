import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';

let db: Db;
/** the server's clock in these tests: real time plus however far a test moved it on */
let skew = 0;
let app: ReturnType<typeof createApp>;

const PEPPER = 'test-pepper';
const CLI_TOKEN = 'cli-secret-token';

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  app = createApp(db, {
    googleClientIds: ['web'],
    appleClientIds: [],
    allowedOrigins: ['capacitor://localhost'],
    devAuth: true,
    now: () => Date.now() + skew,
    adminEmails: ['markjen@gmail.com'],
    adminTokenHash: createHash('sha256').update(CLI_TOKEN).digest('hex'),
    codePepper: PEPPER,
    verifyGoogle: async (t) => {
      if (t === 'admin-google') return { provider: 'google', sub: 'g-admin', name: 'Mark', email: 'markjen@gmail.com' };
      if (t === 'other-google') return { provider: 'google', sub: 'g-other', name: 'Otto', email: 'someone@example.com' };
      if (t === 'unverified-google') return { provider: 'google', sub: 'g-unv', name: 'Uma' };
      throw new Error('bad token');
    },
  });
});

afterAll(() => db.close());

const req = (path: string, init: RequestInit = {}, token?: string) =>
  app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });

async function signInDev(name: string): Promise<string> {
  const r = await req('/auth/dev', json('POST', { name }));
  expect(r.status).toBe(200);
  return ((await r.json()) as { token: string }).token;
}
async function signInGoogle(credential: string): Promise<string> {
  const r = await req('/auth/google', json('POST', { credential }));
  expect(r.status).toBe(200);
  return ((await r.json()) as { token: string }).token;
}

let adminToken: string;
let playerToken: string;
let issuedCode = '';
let issuedId = '';

describe('admin gating', () => {
  it('rejects the unauthenticated, dev users, and non-allowlisted Google accounts', async () => {
    expect((await req('/admin/me')).status).toBe(401);
    expect((await req('/admin/me', {}, 'nonsense')).status).toBe(401);
    const dev = await signInDev('dev-player');
    expect((await req('/admin/me', {}, dev)).status).toBe(403); // DEV_AUTH never counts as admin
    const other = await signInGoogle('other-google');
    expect((await req('/admin/me', {}, other)).status).toBe(403);
    const unverified = await signInGoogle('unverified-google');
    expect((await req('/admin/me', {}, unverified)).status).toBe(403); // no verified email
  });

  it('admits the allowlisted Google account and the CLI token', async () => {
    adminToken = await signInGoogle('admin-google');
    const r = await req('/admin/me', {}, adminToken);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ admin: true, via: 'session', email: 'markjen@gmail.com' });
    const cli = await req('/admin/me', {}, CLI_TOKEN);
    expect(cli.status).toBe(200);
    expect(await cli.json()).toEqual({ admin: true, via: 'token', email: null });
    // a wrong CLI token alone gets in nowhere
    expect((await req('/admin/me', {}, 'wrong-token')).status).toBe(401);
  });
});

describe('gift cards', () => {
  it('issues a card, shows the code once, and never stores it', async () => {
    const r = await req('/admin/gift-cards', json('POST', { amountCents: 999, note: 'for a friend' }), adminToken);
    expect(r.status).toBe(200);
    const g = (await r.json()) as { id: string; code: string; amountCents: number; status: string };
    expect(g.amountCents).toBe(999);
    expect(g.status).toBe('active');
    expect(g.code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
    issuedCode = g.code;
    issuedId = g.id;
    // the list never shows the code…
    const list = await req('/admin/gift-cards', {}, adminToken);
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).not.toContain(g.code);
    // …and the database only holds its hash
    const rows = await db.query<{ code_hash: string }>('SELECT code_hash FROM gift_cards WHERE id = $1', [g.id]);
    expect(rows[0].code_hash).toBe(createHmac('sha256', PEPPER).update(g.code).digest('hex'));
    // bad amounts are refused
    expect((await req('/admin/gift-cards', json('POST', { amountCents: 10 }), adminToken)).status).toBe(400);
    expect((await req('/admin/gift-cards', json('POST', { amountCents: 100001 }), adminToken)).status).toBe(400);
    expect((await req('/admin/gift-cards', json('POST', { amountCents: 999 }))).status).toBe(401);
  });

  it('redeems once into credit, then refuses the same code', async () => {
    playerToken = await signInDev('player-one');
    const r = await req('/gift-cards/redeem', json('POST', { code: issuedCode }), playerToken);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ creditedCents: 999, creditCents: 999 });
    const credit = await req('/credit', {}, playerToken);
    expect(await credit.json()).toEqual({ creditCents: 999 });
    // a second redeem of the same card fails (and takes no more credit)
    expect((await req('/gift-cards/redeem', json('POST', { code: issuedCode }), playerToken)).status).toBe(409);
    expect(((await (await req('/credit', {}, playerToken)).json()) as { creditCents: number }).creditCents).toBe(999);
    // unknown and wrong-shaped codes are the same flat 404
    expect((await req('/gift-cards/redeem', json('POST', { code: 'AAAAAAAAAAAAAAAA' }), playerToken)).status).toBe(404);
    expect((await req('/gift-cards/redeem', json('POST', { code: 'nope' }), playerToken)).status).toBe(404);
    // unauthenticated redeem is refused
    expect((await req('/gift-cards/redeem', json('POST', { code: issuedCode }))).status).toBe(401);
  });

  it('a disabled card cannot be redeemed', async () => {
    const r = await req('/admin/gift-cards', json('POST', { amountCents: 500 }), adminToken);
    const g = (await r.json()) as { id: string; code: string };
    const dis = await req(`/admin/gift-cards/${g.id}/disable`, json('POST', {}), adminToken);
    expect(dis.status).toBe(200);
    expect((await req('/gift-cards/redeem', json('POST', { code: g.code }), playerToken)).status).toBe(409);
    expect((await req(`/admin/gift-cards/${g.id}/disable`, json('POST', {}), adminToken)).status).toBe(404);
  });

  it('an expired card cannot be redeemed', async () => {
    const r = await req('/admin/gift-cards', json('POST', { amountCents: 500, expiresAt: Date.now() + 60_000 }), adminToken);
    const g = (await r.json()) as { id: string; code: string };
    skew = 120_000; // past the expiry
    try {
      expect((await req('/gift-cards/redeem', json('POST', { code: g.code }), playerToken)).status).toBe(409);
    } finally {
      skew = 0;
    }
  });

  it('the CLI token can issue and list gift cards', async () => {
    const r = await req('/admin/gift-cards', json('POST', { amountCents: 100 }), CLI_TOKEN);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { code: string }).code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
  });
});

describe('promo codes and credit purchases', () => {
  it('creates a promo, quotes it, and spends credit with it', async () => {
    const c = await req('/admin/promo-codes', json('POST', { code: 'launch20', kind: 'percent', value: 20 }), adminToken);
    expect(c.status).toBe(200);
    expect((await c.json()) as { promo: { code: string } }).toEqual(
      expect.objectContaining({ promo: expect.objectContaining({ code: 'LAUNCH20' }) }),
    );
    // a duplicate code is refused
    expect((await req('/admin/promo-codes', json('POST', { code: 'LAUNCH20', kind: 'percent', value: 10 }), adminToken)).status).toBe(409);
    // bad definitions are refused
    expect((await req('/admin/promo-codes', json('POST', { code: 'X', kind: 'percent', value: 10 }), adminToken)).status).toBe(400);
    expect((await req('/admin/promo-codes', json('POST', { code: 'BADPCT', kind: 'percent', value: 101 }), adminToken)).status).toBe(400);
    expect((await req('/admin/promo-codes', json('POST', { code: 'BADPROD', kind: 'fixed', value: 100, appliesTo: 'nope' }), adminToken)).status).toBe(400);

    const q = await req('/store/quote', json('POST', { productId: 'beach_1', promoCode: 'launch20' }), playerToken);
    expect(q.status).toBe(200);
    expect(await q.json()).toEqual({ product: 'beach_1', priceCents: 299, discountCents: 59, finalCents: 240, promo: 'LAUNCH20' });

    const buy = await req('/store/credit-purchase', json('POST', { productId: 'beach_1', promoCode: 'LAUNCH20' }), playerToken);
    expect(buy.status).toBe(200);
    const bought = (await buy.json()) as { paidCents: number; discountCents: number; creditCents: number };
    expect(bought.paidCents).toBe(240);
    expect(bought.discountCents).toBe(59);
    expect(bought.creditCents).toBe(999 - 240);
    // the product was granted
    const inv = await req('/inventory', {}, playerToken);
    const items = ((await inv.json()) as { items: { item: string; quantity: number }[] }).items;
    expect(items.find((i) => i.item === 'beach')?.quantity).toBe(1);
  });

  it('refuses a purchase the credit does not cover', async () => {
    const poor = await signInDev('player-broke');
    const r = await req('/store/credit-purchase', json('POST', { productId: 'beach_1' }), poor);
    expect(r.status).toBe(402);
  });

  it('a one-use promo is spent after one purchase', async () => {
    await req('/admin/promo-codes', json('POST', { code: 'FREEPARA', kind: 'percent', value: 100, maxUses: 1 }), adminToken);
    const first = await req('/store/credit-purchase', json('POST', { productId: 'item_parasol', promoCode: 'FREEPARA' }), playerToken);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { paidCents: number }).paidCents).toBe(0);
    const second = await req('/store/quote', json('POST', { productId: 'item_parasol', promoCode: 'FREEPARA' }), playerToken);
    expect(second.status).toBe(400);
    const list = await req('/admin/promo-codes', {}, adminToken);
    const promos = ((await list.json()) as { promos: { code: string; uses: number }[] }).promos;
    expect(promos.find((p) => p.code === 'FREEPARA')?.uses).toBe(1);
  });

  it('refuses expired and wrong-product promos', async () => {
    await req(
      '/admin/promo-codes',
      json('POST', { code: 'SHORTLIVED', kind: 'fixed', value: 100, expiresAt: Date.now() + 60_000 }),
      adminToken,
    );
    await req('/admin/promo-codes', json('POST', { code: 'LIGHTONLY', kind: 'percent', value: 50, appliesTo: 'item_lighthouse' }), adminToken);
    skew = 120_000;
    try {
      expect((await req('/store/quote', json('POST', { productId: 'beach_1', promoCode: 'SHORTLIVED' }), playerToken)).status).toBe(400);
    } finally {
      skew = 0;
    }
    expect((await req('/store/quote', json('POST', { productId: 'beach_1', promoCode: 'LIGHTONLY' }), playerToken)).status).toBe(400);
    expect((await req('/store/quote', json('POST', { productId: 'beach_1', promoCode: 'NOSUCHCODE' }), playerToken)).status).toBe(404);
    // a disabled promo is refused too
    const dis = await req('/admin/promo-codes/LIGHTONLY/disable', json('POST', {}), adminToken);
    expect(dis.status).toBe(200);
    expect((await req('/store/quote', json('POST', { productId: 'item_lighthouse', promoCode: 'LIGHTONLY' }), playerToken)).status).toBe(400);
  });

  it('the CLI token can create promos and read redemptions', async () => {
    const c = await req('/admin/promo-codes', json('POST', { code: 'CLICODE', kind: 'fixed', value: 100 }), CLI_TOKEN);
    expect(c.status).toBe(200);
    const red = await req('/admin/redemptions', {}, CLI_TOKEN);
    expect(red.status).toBe(200);
    const body = (await red.json()) as { giftCards: { id: string }[]; promoUses: { code: string }[]; credit: { kind: string }[] };
    expect(body.giftCards.some((g) => g.id === issuedId)).toBe(true);
    expect(body.promoUses.some((p) => p.code === 'LAUNCH20')).toBe(true);
    expect(body.credit.some((l) => l.kind === 'gift_card')).toBe(true);
    expect(body.credit.some((l) => l.kind === 'spend')).toBe(true);
  });

  it('admin actions are audited, without any code value', async () => {
    const rows = await db.query<{ action: string; detail: string }>('SELECT action, detail FROM admin_audit ORDER BY created_at');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.action)).toContain('gift_card.issue');
    expect(rows.map((r) => r.action)).toContain('promo.create');
    // no audit row holds a gift card code
    for (const r of rows) expect(r.detail).not.toContain(issuedCode);
  });
});
