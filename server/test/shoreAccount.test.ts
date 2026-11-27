// Your account on beechshore (/account): balance, history, top-ups, gift
// cards, gifts and invites, through the shore site's forwarded
// /account/api/* calls (docs/BEECH_BUCKS.md, "Your account on beechshore").
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { hashGiftCode, newGiftCardCode } from '../src/giftCards.js';
import { INVITE_BONUS } from '../src/referrals.js';
import { createRootApp } from '../src/rootApp.js';
import { openTestDb } from './testDb.js';

const shore = 'https://beechshore.com';
let db: Db;
let root: ReturnType<typeof createRootApp>;
let tokenReturn = '';
let order = 1;

beforeAll(async () => {
  db = await openTestDb();
  const api = createApp(db, {
    googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true,
    xsolla: { projectId: '1', apiKey: 'key', webhookSecret: 's', sandbox: false, returnUrl: 'https://play.beech.games/' },
    xsollaToken: async (_cfg, req) => {
      tokenReturn = req.returnUrl ?? '';
      return { token: 'tok', orderId: String(order++) };
    },
  });
  root = createRootApp(db, api, '/no-static-files-needed');
});
afterAll(() => db?.close());

const post = (path: string, data: unknown, token?: string) =>
  root.request('/api' + path, {
    method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
const account = (path: string, token?: string, data?: unknown) =>
  root.request(`${shore}/account/api${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Host: 'beechshore.com', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

let seq = 0;
async function user(name = `p${++seq}`) {
  const r = await post('/auth/dev', { name: `${name}-${++seq}` });
  const s = (await r.json()) as { token: string; user: { id: string } };
  const code = ((await (await root.request('/api/neighbors', { headers: { Authorization: `Bearer ${s.token}` } })).json()) as { code: string }).code;
  const scoped = ((await (await post('/item-submissions/connect', {}, s.token)).json()) as { token: string }).token;
  return { id: s.user.id, token: s.token, scoped, code };
}

interface Summary {
  user: { name: string };
  bucks: number;
  ledger: { kind: string; bucks: number; what: string }[];
  bag: { item: string; owned: number }[];
  invites: { code: string; joined: number; earned: number; bonus: number };
  packs: { id: string }[];
  webCheckout: boolean;
}

describe('the account page', () => {
  it('serves the page, uncached and unframed', async () => {
    const r = await root.request(`${shore}/account`, { headers: { Host: 'beechshore.com' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    const html = await r.text();
    expect(html).toContain('Your account');
    expect(html).toContain('play.beech.games/shore/submit/connect?destination=shore');
  });

  it('needs the connection token, and only takes it on these routes', async () => {
    const a = await user();
    expect((await account('/summary')).status).toBe(401);
    // the game session itself isn't the shore token
    expect((await account('/summary', a.token)).status).toBe(401);
    // and the shore token can't reach the rest of the game
    expect((await root.request('/api/bag', { headers: { Authorization: `Bearer ${a.scoped}` } })).status).toBe(401);
    expect((await account('/anything', a.scoped)).status).toBe(404);
  });

  it('shows the balance, history, bag and invites', async () => {
    const a = await user('Ana');
    const f = await user('Fran');
    expect((await post('/referrals/claim', { code: a.code }, f.token)).status).toBe(200);
    // buy a parasol, then trade it in
    expect((await post('/store/credit-purchase', { productId: 'item_parasol', requestId: crypto.randomUUID() }, a.token)).status).toBe(200);
    expect((await post('/bag/trade-in', { item: 'parasol' }, a.token)).status).toBe(200);
    expect((await post('/dev/grant', { item: 'lighthouse', quantity: 2 }, a.token)).status).toBe(204);
    const r = await account('/summary', a.scoped);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const s = (await r.json()) as Summary;
    expect(s.bucks).toBe(INVITE_BONUS);
    expect(s.ledger.map((l) => [l.kind, l.bucks])).toEqual([
      ['trade_in', 10],
      ['spend', -10],
      ['invite_bonus', INVITE_BONUS],
    ]);
    expect(s.ledger[0].what).toBe('Traded in Parasol');
    expect(s.ledger[1].what).toBe('Bought Parasol');
    expect(s.ledger[2].what).toContain('joined through your invite');
    expect(s.bag).toContainEqual(expect.objectContaining({ item: 'lighthouse', owned: 2 }));
    expect(s.invites).toMatchObject({ code: a.code, joined: 1, earned: INVITE_BONUS, bonus: INVITE_BONUS });
    expect(s.packs.length).toBeGreaterThan(0);
    expect(s.webCheckout).toBe(true);
    const fs = (await (await account('/summary', f.scoped)).json()) as Summary;
    expect(fs.ledger[0].what).toContain('Joined through');
  });

  it('gifts a thing to a beach code', async () => {
    const a = await user();
    const b = await user();
    await post('/dev/grant', { item: 'lighthouse' }, a.token);
    const r = await account('/gift', a.scoped, { code: b.code, item: 'lighthouse' });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { to: { code: string } }).to.code).toBe(b.code);
    const again = await account('/gift', a.scoped, { code: b.code, item: 'lighthouse' });
    expect(again.status).toBe(409);
    const bs = (await (await account('/summary', b.scoped)).json()) as Summary;
    expect(bs.bag).toContainEqual(expect.objectContaining({ item: 'lighthouse', owned: 1 }));
  });

  it('redeems a gift card', async () => {
    const a = await user();
    const code = newGiftCardCode();
    await db.query('INSERT INTO gift_cards (id, code_hash, amount_cents, issued_at) VALUES ($1, $2, 500, 0)', [crypto.randomUUID(), hashGiftCode(code, '')]);
    const r = await account('/redeem', a.scoped, { code });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { credited: number }).credited).toBe(50);
    expect((await account('/redeem', a.scoped, { code })).status).toBe(409);
    const s = (await (await account('/summary', a.scoped)).json()) as Summary;
    expect(s.ledger[0]).toMatchObject({ kind: 'gift_card', bucks: 50, what: 'Redeemed a gift card' });
  });

  it('tops up with a pack, coming back to the account page', async () => {
    const a = await user();
    const r = await account('/top-up', a.scoped, { productId: 'bucks_30', mount: 'shore' });
    expect(r.status).toBe(200);
    const { url } = (await r.json()) as { url: string };
    expect(url).toContain('tok');
    expect(tokenReturn).toBe('https://beechshore.com/account');
    await account('/top-up', a.scoped, { productId: 'bucks_30', mount: 'game' });
    expect(tokenReturn).toBe('https://play.beech.games/shore/account');
    // only packs here
    expect((await account('/top-up', a.scoped, { productId: 'item_lighthouse' })).status).toBe(400);
    const [o] = await db.query<{ id: string }>('SELECT id FROM web_orders WHERE user_id = $1 LIMIT 1', [a.id]);
    const w = await account(`/web-orders/${o.id}`, a.scoped);
    expect(w.status).toBe(200);
    expect(((await w.json()) as { order: { status: string } }).order.status).toBe('created');
  });

  it('labels paid extra tries on the claw and vending machines in history', async () => {
    const a = await user();
    await db.query('UPDATE users SET credit_cents = 500 WHERE id = $1', [a.id]);
    expect((await post('/pulls/daily/paid', {}, a.token)).status).toBe(200);
    expect((await post('/pulls/vending/paid', {}, a.token)).status).toBe(200);
    const s = (await (await account('/summary', a.scoped)).json()) as Summary;
    expect(s.ledger.map((l) => l.what)).toEqual([
      'Extra ball from the vending machine',
      'Extra go on the claw machine',
    ]);
  });

  it('redeems a bucks promo code through the redeem box and logs it in history', async () => {
    const a = await user();
    await db.query(
      "INSERT INTO promo_codes (code, kind, value, active, created_at) VALUES ('SHORE25', 'bucks', 25, true, $1)",
      [Date.now()],
    );
    const r = await account('/redeem', a.scoped, { code: 'shore25' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ credited: 25, promo: 'SHORE25' });
    const s = (await (await account('/summary', a.scoped)).json()) as Summary;
    expect(s.bucks).toBe(25);
    expect(s.ledger[0]?.what).toBe('Promo bonus (SHORE25)');
  });
});

describe('signing in on the shore', () => {
  // Stubbed provider checks: the credential is the identity ('bad' fails).
  let rootAuth: ReturnType<typeof createRootApp>;
  beforeAll(async () => {
    const apiAuth = createApp(db, {
      googleClientIds: ['web'],
      appleClientIds: ['app.beech.beach', 'app.beech.beach.web'],
      allowedOrigins: [],
      devAuth: true,
      verifyGoogle: async (token) => {
        if (token === 'bad') throw new Error('nope');
        return { provider: 'google', sub: `g-${token}`, name: `G ${token}`, email: `${token}@example.com` };
      },
      verifyApple: async (token, _clientIds, name = '') => {
        if (token === 'bad') throw new Error('nope');
        return { provider: 'apple', sub: `a-${token}`, name: name || `A ${token}`, clientId: 'app.beech.beach.web' };
      },
      appleTokenExchange: async () => 'refresh-token',
    });
    rootAuth = createRootApp(db, apiAuth, '/no-static-files-needed', {
      shore: { hosts: ['beechshore.com'], url: 'https://beechshore.com', gameUrl: 'https://play.beech.games', googleClientId: 'web', appleClientId: 'app.beech.beach.web' },
    });
  });

  const auth = (provider: string, data: unknown) =>
    rootAuth.request(`https://beechshore.com/account/auth/${provider}`, {
      method: 'POST',
      headers: { Host: 'beechshore.com', 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  const accountAuth = (path: string, token?: string, data?: unknown) =>
    rootAuth.request(`https://beechshore.com/account/api${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Host: 'beechshore.com', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });

  it('signs in with Google and Apple, and the shore token only opens the account', async () => {
    const g = await auth('google', { credential: 'gina' });
    expect(g.status).toBe(200);
    const gj = (await g.json()) as { token: string; user: { id: string; name: string } };
    expect(gj.user.name).toBe('G gina');
    expect((await accountAuth('/summary', gj.token)).status).toBe(200);
    // the shore token is not a game session token and can't reach the game
    expect((await rootAuth.request('/api/bag', { headers: { Authorization: `Bearer ${gj.token}` } })).status).toBe(401);
    // a second Google sign-in is the same account
    const g2 = await auth('google', { credential: 'gina' });
    expect(((await g2.json()) as { user: { id: string } }).user.id).toBe(gj.user.id);

    const a = await auth('apple', { identityToken: 'ana', name: 'Ana', authorizationCode: 'code-1', redirectUri: 'https://beechshore.com/' });
    expect(a.status).toBe(200);
    const aj = (await a.json()) as { token: string; user: { id: string } };
    expect((await accountAuth('/summary', aj.token)).status).toBe(200);
    // the Apple authorization code was exchanged and the refresh token stored
    const [row] = await db.query<{ apple_refresh_token: string | null }>(
      "SELECT apple_refresh_token FROM user_identities WHERE user_id = $1 AND provider = 'apple'",
      [aj.user.id],
    );
    expect(row?.apple_refresh_token).toBe('refresh-token');
  });

  it('rejects bad credentials and unknown providers', async () => {
    expect((await auth('google', { credential: 'bad' })).status).toBe(401);
    expect((await auth('apple', { identityToken: 'bad' })).status).toBe(401);
    expect((await auth('google', {})).status).toBe(400);
    expect((await auth('steam', { credential: 'x' })).status).toBe(404);
  });

  it('links providers on the shore, idempotently, and 409s across accounts', async () => {
    const a = (await (await auth('google', { credential: 'amy' })).json()) as { token: string; user: { id: string } };
    const b = (await (await auth('google', { credential: 'bob' })).json()) as { token: string; user: { id: string } };
    // link Apple to Amy's account, twice: the second is a no-op
    const link = await accountAuth('/identities', a.token, { provider: 'apple', credential: 'amy-apple', name: 'Amy' });
    expect(link.status).toBe(200);
    expect(((await link.json()) as { identities: string[] }).identities).toEqual(['apple', 'google']);
    const again = await accountAuth('/identities', a.token, { provider: 'apple', credential: 'amy-apple', name: 'Amy' });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { identities: string[] }).identities).toEqual(['apple', 'google']);
    // Bob can't take Amy's Apple identity
    expect((await accountAuth('/identities', b.token, { provider: 'apple', credential: 'amy-apple' })).status).toBe(409);
    // and Bob can't take her Google identity either
    expect((await accountAuth('/identities', b.token, { provider: 'google', credential: 'amy' })).status).toBe(409);
  });

  it('shows the sign-in buttons when the client IDs are configured', async () => {
    const r = await rootAuth.request('https://beechshore.com/account', { headers: { Host: 'beechshore.com' } });
    const html = await r.text();
    expect(html).toContain('"googleClientId":"web"');
    expect(html).toContain('"appleClientId":"app.beech.beach.web"');
    expect(html).toContain('Sign in with Apple');
    // and hides them when neither is configured (the default root)
    const plain = await (await root.request(`${shore}/account`, { headers: { Host: 'beechshore.com' } })).text();
    expect(plain).toContain('"googleClientId":""');
    expect(plain).toContain('"appleClientId":""');
  });
});
