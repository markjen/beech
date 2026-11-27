import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { createApp } from '../src/app.js';
import { ADMIN_COOKIE, createAdminApp } from '../src/adminApp.js';
import type { VerifiedIdentity } from '../src/auth.js';
import { type Db } from '../src/db.js';
import { claimCreditPurchase } from '../src/giftCards.js';
import { openTestDb } from './testDb.js';

let db: Db;
/** the server's clock in these tests: real time plus however far a test moved it on */
let skew = 0;
let app: ReturnType<typeof createApp>;
let admin: ReturnType<typeof createAdminApp>;
const audiences: string[][] = [];

const verifyGoogle = async (t: string): Promise<VerifiedIdentity> => {
  if (t === 'admin-google') return { provider: 'google', sub: 'g-admin', name: 'Ada', email: 'Admin@Example.com' };
  if (t === 'other-google') return { provider: 'google', sub: 'g-other', name: 'Otto', email: 'someone@example.com' };
  if (t === 'unverified-google') return { provider: 'google', sub: 'g-unv', name: 'Uma' };
  throw new Error('bad token');
};

const PEPPER = 'test-pepper';
const CLI_TOKEN = 'cli-secret-token';

beforeAll(async () => {
  db = await openTestDb();
  app = createApp(db, {
    googleClientIds: ['web'],
    appleClientIds: [],
    allowedOrigins: ['capacitor://localhost'],
    devAuth: true,
    now: () => Date.now() + skew,
    codePepper: PEPPER,
    verifyGoogle,
  });
  admin = createAdminApp(db, {
    googleClientId: 'web',
    adminEmails: ['admin@example.com'],
    adminTokenHash: createHash('sha256').update(CLI_TOKEN).digest('hex'),
    codePepper: PEPPER,
    appUrl: 'https://beech.example',
    now: () => Date.now() + skew,
    verifyGoogle: async (t, aud) => {
      audiences.push(aud);
      return verifyGoogle(t);
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
/** sign in to the admin console: the session cookie's value */
async function adminSignIn(credential: string): Promise<Response> {
  return admin.request('/auth/google', { method: 'POST', body: JSON.stringify({ credential }), headers: { 'Content-Type': 'application/json', 'X-Beech-Admin': '1' } });
}
const cookieOf = (r: Response) => {
  const m = new RegExp(`${ADMIN_COOKIE.replace(/[-]/g, '\\-')}=([^;]+)`).exec(r.headers.get('set-cookie') ?? '');
  return m ? m[1] : '';
};
/**
 * An admin console request. `who` is the session cookie's value (sent with
 * the CSRF header), or the CLI token (sent as a bearer token).
 */
const areq = (path: string, init: RequestInit = {}, who?: string, opts: { csrf?: boolean } = {}) => {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (who === CLI_TOKEN || who === 'wrong-token') headers.Authorization = `Bearer ${who}`;
  else if (who) {
    headers.Cookie = `${ADMIN_COOKIE}=${who}`;
    if (opts.csrf !== false) headers['X-Beech-Admin'] = '1';
  }
  return admin.request(path, { ...init, headers });
};

let adminToken: string;
let playerToken: string;
let issuedCode = '';
let issuedId = '';

describe('the admin console is its own app', () => {
  it('the game no longer serves any admin route', async () => {
    const dev = await signInDev('dev-player-0');
    expect((await req('/admin/me', {}, dev)).status).toBe(404);
    expect((await req('/admin/gift-cards', json('POST', { amountCents: 999 }), dev)).status).toBe(404);
    expect((await req('/config')).status).toBe(404);
  });

  it('shows only the sign-in page until signed in', async () => {
    const r = await admin.request('/');
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('beech admin sign-in');
    // none of the console is in it
    expect(html).not.toContain('gift-form');
    expect(html).not.toContain('/api/');
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects the unauthenticated, non-allowlisted and unverified Google accounts', async () => {
    expect((await areq('/api/me')).status).toBe(401);
    expect((await areq('/api/me', {}, 'nonsense')).status).toBe(401);
    expect((await areq('/api/me', {}, 'wrong-token')).status).toBe(401);
    for (const cred of ['other-google', 'unverified-google']) {
      const r = await adminSignIn(cred);
      expect(r.status).toBe(403);
      expect(r.headers.get('set-cookie')).toBeNull();
    }
    expect((await adminSignIn('garbage')).status).toBe(401);
    // a player's game session is not an admin session
    const dev = await signInDev('dev-player');
    expect((await areq('/api/me', {}, dev)).status).toBe(401);
    // sign-in without the CSRF header is refused
    const noHeader = await admin.request('/auth/google', { method: 'POST', body: JSON.stringify({ credential: 'admin-google' }), headers: { 'Content-Type': 'application/json' } });
    expect(noHeader.status).toBe(403);
  });

  it('admits the allowlisted Google account (verified email, case-insensitive) and the CLI token', async () => {
    const r = await adminSignIn('admin-google');
    expect(r.status).toBe(204);
    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    adminToken = cookieOf(r);
    expect(adminToken.length).toBeGreaterThan(20);
    // the audience is the web client only
    expect(audiences.at(-1)).toEqual(['web']);
    // only the hash of the session token is stored
    const rows = await db.query<{ token_hash: string; email: string }>('SELECT token_hash, email FROM admin_sessions');
    expect(rows.some((x) => x.token_hash === createHash('sha256').update(adminToken).digest('hex'))).toBe(true);
    expect(rows.every((x) => x.token_hash !== adminToken)).toBe(true);

    const me = await areq('/api/me', {}, adminToken);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ admin: true, via: 'session', email: 'admin@example.com' });
    const cli = await areq('/api/me', {}, CLI_TOKEN);
    expect(cli.status).toBe(200);
    expect(await cli.json()).toEqual({ admin: true, via: 'token', email: null });
    // signed in, the page is the console
    const page = await areq('/', {}, adminToken);
    const html = await page.text();
    expect(html).toContain('gift-form');
    expect(html).toContain('admin@example.com');
    // signing in made no game account
    expect((await db.query("SELECT 1 FROM users WHERE provider_sub = 'g-admin'")).length).toBe(0);
  });

  it('a session cookie without the CSRF header gets nothing', async () => {
    expect((await areq('/api/me', {}, adminToken, { csrf: false })).status).toBe(403);
    expect((await areq('/api/gift-cards', json('POST', { amountCents: 999 }), adminToken, { csrf: false })).status).toBe(403);
  });

  it('expired sessions and sign-out end access', async () => {
    const r = await adminSignIn('admin-google');
    const t = cookieOf(r);
    expect((await areq('/api/me', {}, t)).status).toBe(200);
    skew = 13 * 3600000; // past the 12-hour session
    try {
      expect((await areq('/api/me', {}, t)).status).toBe(401);
      expect(await (await areq('/', {}, t)).text()).toContain('beech admin sign-in');
    } finally {
      skew = 0;
    }
    const out = await areq('/auth/logout', { method: 'POST' }, t);
    expect(out.status).toBe(204);
    expect((await areq('/api/me', {}, t)).status).toBe(401);
  });

  it('taking an email off the allowlist locks its sessions out at once', async () => {
    const strict = createAdminApp(db, { googleClientId: 'web', adminEmails: ['someone-else@example.com'], verifyGoogle });
    const r = await strict.request('/api/me', { headers: { Cookie: `${ADMIN_COOKIE}=${adminToken}`, 'X-Beech-Admin': '1' } });
    expect(r.status).toBe(401);
  });
});

describe('gift cards', () => {
  it('issues a card, shows the code once, and never stores it', async () => {
    const r = await areq('/api/gift-cards', json('POST', { amountCents: 999, note: 'for a friend' }), adminToken);
    expect(r.status).toBe(200);
    const g = (await r.json()) as { id: string; code: string; amountCents: number; status: string };
    expect(g.amountCents).toBe(999);
    expect(g.status).toBe('active');
    expect(g.code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
    issuedCode = g.code;
    issuedId = g.id;
    // the list never shows the code…
    const list = await areq('/api/gift-cards', {}, adminToken);
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).not.toContain(g.code);
    // …and the database only holds its hash
    const rows = await db.query<{ code_hash: string }>('SELECT code_hash FROM gift_cards WHERE id = $1', [g.id]);
    expect(rows[0].code_hash).toBe(createHmac('sha256', PEPPER).update(g.code).digest('hex'));
    // bad amounts are refused
    expect((await areq('/api/gift-cards', json('POST', { amountCents: 10 }), adminToken)).status).toBe(400);
    expect((await areq('/api/gift-cards', json('POST', { amountCents: 100001 }), adminToken)).status).toBe(400);
    expect((await areq('/api/gift-cards', json('POST', { amountCents: 999 }))).status).toBe(401);
  });

  it('redeems once into credit, then refuses the same code', async () => {
    playerToken = await signInDev('player-one');
    const r = await req('/gift-cards/redeem', json('POST', { code: issuedCode }), playerToken);
    expect(r.status).toBe(200);
    // $9.99 is 99.9 beech bucks: the part buck rounds up (docs/BEECH_BUCKS.md)
    expect(await r.json()).toEqual({ creditedCents: 1000, creditCents: 1000, credited: 100, bucks: 100 });
    const credit = await req('/credit', {}, playerToken);
    expect(await credit.json()).toEqual({ creditCents: 1000, bucks: 100, debt: 0 });
    // a second redeem of the same card fails (and takes no more credit)
    expect((await req('/gift-cards/redeem', json('POST', { code: issuedCode }), playerToken)).status).toBe(409);
    expect(((await (await req('/credit', {}, playerToken)).json()) as { creditCents: number }).creditCents).toBe(1000);
    // unknown and wrong-shaped codes are the same flat 404
    expect((await req('/gift-cards/redeem', json('POST', { code: 'AAAAAAAAAAAAAAAA' }), playerToken)).status).toBe(404);
    expect((await req('/gift-cards/redeem', json('POST', { code: 'nope' }), playerToken)).status).toBe(404);
    // unauthenticated redeem is refused
    expect((await req('/gift-cards/redeem', json('POST', { code: issuedCode }))).status).toBe(401);
  });

  it('a disabled card cannot be redeemed', async () => {
    const r = await areq('/api/gift-cards', json('POST', { amountCents: 500 }), adminToken);
    const g = (await r.json()) as { id: string; code: string };
    const dis = await areq(`/api/gift-cards/${g.id}/disable`, json('POST', {}), adminToken);
    expect(dis.status).toBe(200);
    expect((await req('/gift-cards/redeem', json('POST', { code: g.code }), playerToken)).status).toBe(409);
    expect((await areq(`/api/gift-cards/${g.id}/disable`, json('POST', {}), adminToken)).status).toBe(404);
  });

  it('an expired card cannot be redeemed', async () => {
    const r = await areq('/api/gift-cards', json('POST', { amountCents: 500, expiresAt: Date.now() + 60_000 }), adminToken);
    const g = (await r.json()) as { id: string; code: string };
    skew = 120_000; // past the expiry
    try {
      expect((await req('/gift-cards/redeem', json('POST', { code: g.code }), playerToken)).status).toBe(409);
    } finally {
      skew = 0;
    }
  });

  it('the CLI token can issue and list gift cards', async () => {
    const r = await areq('/api/gift-cards', json('POST', { amountCents: 100 }), CLI_TOKEN);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { code: string }).code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
  });
});

describe('promo codes and credit purchases', () => {
  it('creates a percent promo, rejects fixed kind and bad values, and credit purchases charge full price', async () => {
    const c = await areq('/api/promo-codes', json('POST', { code: 'launch20', kind: 'percent', value: 20 }), adminToken);
    expect(c.status).toBe(200);
    expect((await c.json()) as { promo: { code: string } }).toEqual(
      expect.objectContaining({ promo: expect.objectContaining({ code: 'LAUNCH20' }) }),
    );
    // a duplicate code is refused
    expect((await areq('/api/promo-codes', json('POST', { code: 'LAUNCH20', kind: 'percent', value: 10 }), adminToken)).status).toBe(409);
    // bad definitions are refused: promo codes are percent-only
    expect((await areq('/api/promo-codes', json('POST', { code: 'X', kind: 'percent', value: 10 }), adminToken)).status).toBe(400);
    expect((await areq('/api/promo-codes', json('POST', { code: 'BADPCT', kind: 'percent', value: 101 }), adminToken)).status).toBe(400);
    expect((await areq('/api/promo-codes', json('POST', { code: 'BADKIND', kind: 'fixed', value: 100 }), adminToken)).status).toBe(400);
    expect((await areq('/api/promo-codes', json('POST', { code: 'BADPROD', kind: 'percent', value: 100, appliesTo: 'nope' }), adminToken)).status).toBe(400);

    // quoting is full price: promo codes never discount a credit purchase
    const q = await req('/store/quote', json('POST', { productId: 'beach_1' }), playerToken);
    expect(q.status).toBe(200);
    expect(await q.json()).toEqual({ product: 'beach_1', priceCents: 300, discountCents: 0, finalCents: 300, price: 30, final: 30 });

    const buy = await req('/store/credit-purchase', json('POST', { productId: 'beach_1' }), playerToken);
    expect(buy.status).toBe(200);
    const bought = (await buy.json()) as { paidCents: number; discountCents: number; creditCents: number };
    expect(bought.paidCents).toBe(300);
    expect(bought.discountCents).toBe(0);
    expect(bought.creditCents).toBe(1000 - 300);
    // the product was granted
    const inv = await req('/inventory', {}, playerToken);
    const items = ((await inv.json()) as { items: { item: string; quantity: number; source: string }[] }).items;
    expect(items.find((i) => i.item === 'beach')?.quantity).toBe(1);
    // bought in the shop (with credit), not a gift from someone
    expect(items.find((i) => i.item === 'beach')?.source).toBe('shop');
  });

  it('refuses a purchase the credit does not cover', async () => {
    const poor = await signInDev('player-broke');
    const r = await req('/store/credit-purchase', json('POST', { productId: 'beach_1' }), poor);
    expect(r.status).toBe(402);
  });

  it('a promo code sent to quote or credit-purchase is refused, never consumed', async () => {
    await areq('/api/promo-codes', json('POST', { code: 'FREEPARA', kind: 'percent', value: 100, maxUses: 1 }), adminToken);
    expect((await req('/store/quote', json('POST', { productId: 'item_parasol', promoCode: 'FREEPARA' }), playerToken)).status).toBe(400);
    expect((await req('/store/credit-purchase', json('POST', { productId: 'item_parasol', promoCode: 'FREEPARA' }), playerToken)).status).toBe(400);
    const list = await areq('/api/promo-codes', {}, adminToken);
    const promos = ((await list.json()) as { promos: { code: string; uses: number }[] }).promos;
    expect(promos.find((p) => p.code === 'FREEPARA')?.uses).toBe(0);
  });

  it('expired and disabled promos cannot be loaded onto an account', async () => {
    await areq('/api/promo-codes',
      json('POST', { code: 'SHORTLIVED', kind: 'percent', value: 100, expiresAt: Date.now() + 60_000 }),
      adminToken,
    );
    await areq('/api/promo-codes', json('POST', { code: 'LIGHTONLY', kind: 'percent', value: 50, appliesTo: 'item_lighthouse' }), adminToken);
    const late = await signInDev('player-late');
    skew = 120_000;
    try {
      expect((await req('/promo-codes/load', json('POST', { code: 'SHORTLIVED' }), late)).status).toBe(400);
    } finally {
      skew = 0;
    }
    // a disabled promo is refused too
    const dis = await areq('/api/promo-codes/LIGHTONLY/disable', json('POST', {}), adminToken);
    expect(dis.status).toBe(200);
    expect((await req('/promo-codes/load', json('POST', { code: 'LIGHTONLY' }), late)).status).toBe(400);
  });

  it('the CLI token can create promos and read redemptions', async () => {
    const c = await areq('/api/promo-codes', json('POST', { code: 'CLICODE', kind: 'percent', value: 100 }), CLI_TOKEN);
    expect(c.status).toBe(200);
    const red = await areq('/api/redemptions', {}, CLI_TOKEN);
    expect(red.status).toBe(200);
    const body = (await red.json()) as { giftCards: { id: string }[]; promoUses: { code: string }[]; credit: { kind: string }[] };
    expect(body.giftCards.some((g) => g.id === issuedId)).toBe(true);
    expect(Array.isArray(body.promoUses)).toBe(true);
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

  it('two concurrent buys on one credit grant exactly once', async () => {
    // beach_1 is $2.99. Give a fresh player exactly that, then fire two buys
    // at once: the loser's credit is gone by the time its payment runs, so it
    // must fail without taking any more credit.
    const racer = await signInDev('player-race-one');
    const issue = await areq('/api/gift-cards', json('POST', { amountCents: 300 }), adminToken);
    expect(issue.status).toBe(200);
    const card = (await issue.json()) as { code: string };
    expect((await req('/gift-cards/redeem', json('POST', { code: card.code }), racer)).status).toBe(200);
    const [r1, r2] = await Promise.all([
      req('/store/credit-purchase', json('POST', { productId: 'beach_1' }), racer),
      req('/store/credit-purchase', json('POST', { productId: 'beach_1' }), racer),
    ]);
    // Exactly one buy goes through; the loser is refused (402 if its
    // pre-check runs after the winner's debit, 409 if it reaches the
    // statement) — either way it takes no credit.
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).not.toBe(200);
    expect(((await (await req('/credit', {}, racer)).json()) as { creditCents: number }).creditCents).toBe(0);
    const items = ((await (await req('/inventory', {}, racer)).json()) as { items: { item: string; quantity: number }[] }).items;
    expect(items.find((i) => i.item === 'beach')?.quantity).toBe(1);
  });

  it('two concurrent buyers each pay full price and each get the item', async () => {
    const fund = async (name: string) => {
      const t = await signInDev(name);
      const issue = await areq('/api/gift-cards', json('POST', { amountCents: 500 }), adminToken);
      expect(issue.status).toBe(200);
      const card = (await issue.json()) as { code: string };
      expect((await req('/gift-cards/redeem', json('POST', { code: card.code }), t)).status).toBe(200);
      return t;
    };
    const buyerA = await fund('player-race-two-a');
    const buyerB = await fund('player-race-two-b');
    const [r1, r2] = await Promise.all([
      req('/store/credit-purchase', json('POST', { productId: 'beach_1' }), buyerA),
      req('/store/credit-purchase', json('POST', { productId: 'beach_1' }), buyerB),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const creditOf = async (t: string) => ((await (await req('/credit', {}, t)).json()) as { creditCents: number }).creditCents;
    // beach_1 is $2.99 full price for both; no promo involved
    expect((await creditOf(buyerA)) + (await creditOf(buyerB))).toBe(500 + 500 - 300 - 300);
    const beaches = async (t: string) =>
      ((await (await req('/inventory', {}, t)).json()) as { items: { item: string; quantity: number }[] }).items.find((i) => i.item === 'beach')?.quantity ?? 0;
    expect((await beaches(buyerA)) + (await beaches(buyerB))).toBe(2);
  });
});

describe('credit purchase statement', () => {
  // The endpoint tests above can refuse the loser at the pre-checks
  // (402/409) before the statement ever runs. These call the statement
  // directly, so both claims genuinely race — the loser reaches the
  // statement and must still change nothing.
  const userIdOf = async (name: string) => (await db.query<{ id: string }>('SELECT id FROM users WHERE name = $1', [name]))[0].id;
  const creditOfId = async (id: string) =>
    Number((await db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [id]))[0].credit_cents);
  const beachesOfId = async (id: string) =>
    Number(
      (await db.query<{ q: string }>("SELECT COALESCE(SUM(quantity), 0) AS q FROM inventory WHERE user_id = $1 AND item_id = 'beach'", [id]))[0]
        .q,
    );

  it('two concurrent claims on one credit grant exactly once', async () => {
    await signInDev('player-race-stmt');
    const id = await userIdOf('player-race-stmt');
    await db.query('UPDATE users SET credit_cents = 300 WHERE id = $1', [id]);
    const args = {
      userId: id,
      productId: 'beach_1',
      finalCents: 300,
      items: ['beach'],
      quantities: [1],
      unitCents: [300],
      now: Date.now(),
    };
    const [a, b] = await Promise.all([claimCreditPurchase(db, args), claimCreditPurchase(db, args)]);
    expect([a.length, b.length].sort()).toEqual([0, 1]);
    expect(await creditOfId(id)).toBe(0);
    expect(await beachesOfId(id)).toBe(1);
  });

  it('two concurrent claims by different users each grant once', async () => {
    await signInDev('player-race-stmt-a');
    await signInDev('player-race-stmt-b');
    const aId = await userIdOf('player-race-stmt-a');
    const bId = await userIdOf('player-race-stmt-b');
    await db.query('UPDATE users SET credit_cents = 500 WHERE id IN ($1, $2)', [aId, bId]);
    const argsFor = (userId: string) => ({
      userId,
      productId: 'beach_1',
      finalCents: 300,
      items: ['beach'],
      quantities: [1],
      unitCents: [300],
      now: Date.now(),
    });
    const [a, b] = await Promise.all([claimCreditPurchase(db, argsFor(aId)), claimCreditPurchase(db, argsFor(bId))]);
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect((await creditOfId(aId)) + (await creditOfId(bId))).toBe(500 + 500 - 300 - 300);
    expect((await beachesOfId(aId)) + (await beachesOfId(bId))).toBe(2);
  });
});

describe('reports (docs/INBOX_NOTIFICATIONS.md)', () => {
  it('lists a reported note, hides it (closing every report on it), and audits it', async () => {
    const ana = await signInDev(`report-ana-${Date.now()}`);
    const ben = await signInDev(`report-ben-${Date.now()}`);
    const anaCode = ((await (await req('/neighbors', {}, ana)).json()) as { code: string }).code;
    expect((await req(`/beaches/${anaCode}/visit`, json('POST', { note: 'Lovely beach!', quick: true }), ben)).status).toBe(200);
    const box = (await (await req('/inbox', {}, ana)).json()) as { entries: { note: { id: number } }[] };
    const noteId = box.entries[0].note.id;
    expect((await req(`/notes/${noteId}/report`, json('POST', { reason: 'spam' }), ana)).status).toBe(204);

    const list = (await (await areq('/api/reports', {}, CLI_TOKEN)).json()) as { reports: { id: number; noteId: number; note: string; reason: string; from: { name: string } }[] };
    const r = list.reports.find((x) => x.noteId === noteId)!;
    expect(r).toMatchObject({ note: 'Lovely beach!', reason: 'spam' });
    expect(r.from.name).toContain('report-ben');
    expect((await areq(`/api/reports/${r.id}/resolve`, json('POST', { action: 'nope' }), CLI_TOKEN)).status).toBe(400);
    expect((await areq(`/api/reports/${r.id}/resolve`, json('POST', { action: 'hide' }), CLI_TOKEN)).status).toBe(200);
    // gone from the open list, still in "all", and the recipient sees it removed
    expect(((await (await areq('/api/reports', {}, CLI_TOKEN)).json()) as { reports: { noteId: number }[] }).reports.some((x) => x.noteId === noteId)).toBe(false);
    const all = (await (await areq('/api/reports?all=1', {}, CLI_TOKEN)).json()) as { reports: { noteId: number; resolution: string; hidden: boolean }[] };
    expect(all.reports.find((x) => x.noteId === noteId)).toMatchObject({ resolution: 'hidden', hidden: true });
    const after = (await (await req('/inbox', {}, ana)).json()) as { entries: { note: { removed?: boolean } }[] };
    expect(after.entries[0].note.removed).toBe(true);
    const audit = (await (await areq('/api/audit', {}, CLI_TOKEN)).json()) as { audit: { action: string; target: string }[] };
    expect(audit.audit[0]).toMatchObject({ action: 'report.hide', target: `note:${noteId}` });
    // players can't reach it
    expect((await areq('/api/reports')).status).toBe(401);
  });
});

describe('referrals (who invited whom)', () => {
  type Ref = { code: string; inviter: { name: string }; invitee: { name: string; provider: string }; settledAt: number | null };
  type Refs = { totals: { referrals: number; settled: number; lastDay: number }; top: { id: string; name: string; invited: number; lastDay: number; sameProvider: number }[]; referrals: Ref[]; more: boolean };
  const codeOf = async (t: string) => ((await (await req('/neighbors', {}, t)).json()) as { code: string }).code;

  it('lists referrals and the top inviters, and finds one player’s by name, code or id', async () => {
    const ivy = await signInDev('Ivy Inviter');
    const code = await codeOf(ivy);
    for (const name of ['Fern Friend', 'Finn Friend']) {
      const t = await signInDev(name);
      expect((await req('/referrals/claim', json('POST', { code }), t)).status).toBe(200);
    }
    const all = (await (await areq('/api/referrals', {}, CLI_TOKEN)).json()) as Refs;
    expect(all.totals.referrals).toBeGreaterThanOrEqual(2);
    expect(all.totals.lastDay).toBeGreaterThanOrEqual(2);
    const top = all.top.find((t) => t.name === 'Ivy Inviter')!;
    expect(top).toMatchObject({ invited: 2, lastDay: 2, sameProvider: 2 });
    expect(all.referrals.filter((r) => r.inviter.name === 'Ivy Inviter').map((r) => r.invitee.name).sort()).toEqual(['Fern Friend', 'Finn Friend']);

    const byName = (await (await areq('/api/referrals?q=fern', {}, CLI_TOKEN)).json()) as Refs;
    expect(byName.referrals.map((r) => r.invitee.name)).toEqual(['Fern Friend']);
    expect(byName.referrals[0]).toMatchObject({ code, inviter: { name: 'Ivy Inviter' }, invitee: { provider: 'dev' }, settledAt: null });
    const byCode = (await (await areq(`/api/referrals?q=${code}`, {}, CLI_TOKEN)).json()) as Refs;
    expect(byCode.referrals).toHaveLength(2);
    const byId = (await (await areq(`/api/referrals?q=${top.id}`, {}, CLI_TOKEN)).json()) as Refs;
    expect(byId.referrals).toHaveLength(2);
    // a LIKE wildcard is searched for as itself
    expect(((await (await areq('/api/referrals?q=%25', {}, CLI_TOKEN)).json()) as Refs).referrals).toEqual([]);
    expect((await areq('/api/referrals?offset=-1', {}, CLI_TOKEN)).status).toBe(400);
    // players can't reach it
    expect((await areq('/api/referrals')).status).toBe(401);
  });
});

describe('beech bucks: trade-ins and debts', () => {
  type Bucks = {
    totals: { tradeInsDay: number; bucksDay: number; tradeInsWeek: number; bucksWeek: number; debtors: number; debtBucks: number; balanceBucks: number };
    tradeIns: { item: string; quantity: number; bucks: number; player: { id: string; name: string } }[];
    debts: { player: { name: string }; debtBucks: number; balanceBucks: number }[];
    more: boolean;
  };
  const idOf = async (t: string) => ((await (await req('/me', {}, t)).json()) as { user: { id: string } }).user.id;

  it('lists recent trade-ins, searchable, and who owes bucks', async () => {
    const tess = await idOf(await signInDev('Tess Trader'));
    const dan = await idOf(await signInDev('Dan Debtor'));
    const now = Date.now() + skew;
    const trade = (user: string, item: string, quantity: number, cents: number, at: number) =>
      db.query('INSERT INTO trade_ins (user_id, item_id, quantity, value_cents, created_at) VALUES ($1, $2, $3, $4, $5)', [user, item, quantity, cents, at]);
    await trade(tess, 'parasol', 1, 100, now - 1000);
    await trade(tess, 'surfboard', 2, 300, now - 3 * 86400000);
    await db.query('UPDATE users SET creator_credit_debt_cents = 250, credit_cents = 0 WHERE id = $1', [dan]);

    const all = (await (await areq('/api/bucks', {}, CLI_TOKEN)).json()) as Bucks;
    expect(all.totals.tradeInsDay).toBeGreaterThanOrEqual(1);
    expect(all.totals.tradeInsWeek).toBeGreaterThanOrEqual(2);
    expect(all.totals.bucksWeek).toBeGreaterThanOrEqual(40);
    expect(all.totals.debtors).toBeGreaterThanOrEqual(1);
    expect(all.debts.find((d) => d.player.name === 'Dan Debtor')).toMatchObject({ debtBucks: 25, balanceBucks: 0 });

    const mine = (await (await areq('/api/bucks?q=tess', {}, CLI_TOKEN)).json()) as Bucks;
    expect(mine.tradeIns.map((t) => [t.item, t.quantity, t.bucks])).toEqual([
      ['parasol', 1, 10],
      ['surfboard', 2, 30],
    ]);
    expect(((await (await areq('/api/bucks?q=surfboard', {}, CLI_TOKEN)).json()) as Bucks).tradeIns.every((t) => t.item === 'surfboard')).toBe(true);
    expect(((await (await areq(`/api/bucks?q=${tess}`, {}, CLI_TOKEN)).json()) as Bucks).tradeIns).toHaveLength(2);
    expect((await areq('/api/bucks?offset=x', {}, CLI_TOKEN)).status).toBe(400);
    expect((await areq('/api/bucks')).status).toBe(401);
  });
});
