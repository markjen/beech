import { afterAll, beforeAll, expect, it } from 'vitest';

import { createAdminApp } from '../src/adminApp.js';
import { createApp } from '../src/app.js';
import { hashToken } from '../src/auth.js';
import { type Db } from '../src/db.js';
import { TERMS_VERSION } from '../src/itemSubmissions.js';
import { createRootApp } from '../src/rootApp.js';
import { ASSET_LIMIT, assetExample } from '../src/submissionAssets.js';
import { signWebhook } from '../src/xsolla.js';
import { openTestDb } from './testDb.js';

const adminToken = 'test-admin-token';
const secret = 'xsolla-test-secret';
const shore = 'https://beechshore.com';
let db: Db;
let root: ReturnType<typeof createRootApp>;
let admin: ReturnType<typeof createAdminApp>;
let now = Date.now();
let nativeBoughtAt = now;
let nextXsollaOrder = 880000;

beforeAll(async () => {
  db = await openTestDb();
  const api = createApp(db, {
    googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true, now: () => now,
    stores: {
      apple: async (jws) => ({
        store: 'apple', transactionId: jws, productId: 'item_lighthouse',
        environment: jws.startsWith('sandbox') ? 'Sandbox' : 'Production', purchasedAt: nativeBoughtAt,
      }),
      appleRefund: async (jws) => jws,
      google: async (_package, productId, token) => ({
        store: 'google', transactionId: token, productId, environment: 'Production', purchasedAt: nativeBoughtAt,
      }),
    },
    xsolla: { projectId: '1', apiKey: 'key', webhookSecret: secret, sandbox: false, returnUrl: 'https://play.beech.games/' },
    xsollaToken: async () => ({ token: 'test', orderId: String(nextXsollaOrder++) }),
    steamAuth: { appId: '1', webApiKey: 'key' },
    verifySteam: async (_ticket, _cfg, name = '') => ({ provider: 'steam', sub: '76561198000000001', name }),
    steamStore: { appId: '1', webApiKey: 'key', sandbox: false },
    steamTxn: {
      init: async (_cfg, args) => ({ transId: `steam-${args.orderId}` }),
      finalize: async (_cfg, id) => ({ transId: `steam-${id}` }),
    },
  });
  root = createRootApp(db, api, '/no-static-files-needed');
  admin = createAdminApp(db, { googleClientId: null, adminEmails: [], adminTokenHash: await hashToken(adminToken), codePepper: '', now: () => now });
});
afterAll(() => db?.close());

function bearer(token?: string) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function json(path: string, data: unknown, token?: string) {
  return root.request('/api' + path, {
    method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
}

async function user(name: string, steam = false) {
  const res = await json(steam ? '/auth/steam' : '/auth/dev', { name, ticket: 'test' });
  expect(res.status).toBe(200);
  const data = await res.json() as { token: string; user: { id: string } };
  const connected = await json('/item-submissions/connect', {}, data.token);
  expect(connected.status).toBe(200);
  return { id: data.user.id, token: data.token, scoped: (await connected.json() as { token: string }).token };
}

function form(fields: Record<string, string> = {}) {
  const value = new FormData();
  for (const [k, v] of Object.entries({
    name: 'Tide pool pot', slug: 'tide-pool-pot', description: 'A small pot', behavior: 'fixed', sizeMin: '0.5', sizeMax: '0.5',
    fixedSize: 'true', priceCents: '149', frequency: 'shop', frequencyNote: 'Summer',
    termsVersion: TERMS_VERSION, termsAccepted: 'true', ...fields,
  })) value.set(k, v);
  return value;
}

const uploadForm = (fields: Record<string, string> = {}) => {
  const value = form(fields);
  value.set('asset', new File([JSON.stringify(assetExample)], 'pot.json', { type: 'application/json' }));
  return value;
};

const shoreRequest = (path: string, token?: string, body?: FormData) =>
  root.request(shore + path, { method: body ? 'POST' : 'GET', headers: { Host: 'beechshore.com', ...bearer(token) }, body });

async function submit(token: string, value = uploadForm()) {
  const res = await shoreRequest('/submit/items', token, value);
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json() as { id: string }).id;
}

const adminApi = (path = '', body?: FormData, token = adminToken) =>
  admin.request('/api/item-submissions' + path, { method: body ? 'POST' : 'GET', headers: bearer(token), body });

async function approve(id: string, itemId: string, priceCents: string) {
  const res = await adminApi('/' + id + '/review', form({
    status: 'approved', productId: 'item_' + itemId, itemId, priceCents, name: 'Edited pot', frequency: 'limited',
  }));
  expect(res.status, await res.clone().text()).toBe(200);
}

async function credit(token: string) {
  return (await (await root.request('/api/credit', { headers: bearer(token) })).json() as { creditCents: number }).creditCents;
}

it('serves the form and agent assets on the shore and restricts uploads and history to scoped sessions', async () => {
  const home = await shoreRequest('/submit');
  expect(home.status).toBe(200);
  expect(await home.text()).toContain('I accept the submission terms.');
  const spec = await shoreRequest('/submit/spec');
  expect(await spec.text()).toContain('/submit/schema.json');
  expect(await (await shoreRequest('/submit/example.json')).json()).toEqual(assetExample);
  expect((await root.request('/shore/submit')).status).toBe(200);
  expect((await shoreRequest('/submit/items')).status).toBe(401);

  const creator = await user('Consent');
  const other = await user('Other creator');
  expect((await shoreRequest('/submit/items', creator.token, uploadForm())).status).toBe(401);
  expect((await root.request('/api/credit', { headers: bearer(creator.scoped) })).status).toBe(401);
  expect((await shoreRequest('/submit/items', creator.scoped, uploadForm({ termsAccepted: 'false' }))).status).toBe(400);
  expect((await shoreRequest('/submit/items', creator.scoped, uploadForm({ termsVersion: 'older' }))).status).toBe(400);
  const remoteModel = uploadForm();
  remoteModel.set('asset', new File([JSON.stringify({ asset: { version: '2.0' }, meshes: [{}], buffers: [{ uri: 'https://example.com/b.bin' }] })], 'pot.gltf'));
  expect((await shoreRequest('/submit/items', creator.scoped, remoteModel)).status).toBe(400);
  const bigAsset = uploadForm();
  bigAsset.set('asset', new File([new Uint8Array(ASSET_LIMIT + 1)], 'pot.glb'));
  expect((await shoreRequest('/submit/items', creator.scoped, bigAsset)).status).toBe(413);
  const id = await submit(creator.scoped);
  expect(await (await shoreRequest('/submit/items', creator.scoped)).json()).toMatchObject({ submissions: [{ id, status: 'pending' }] });
  expect(await (await shoreRequest('/submit/items', other.scoped)).json()).toMatchObject({ submissions: [] });
  expect((await json('/auth/logout', {}, creator.token)).status).toBe(204);
  expect((await shoreRequest('/submit/items', creator.scoped)).status).toBe(401);
});

it('protects the queue and preserves the original upload when an admin revises or rejects it', async () => {
  const creator = await user('Reviewed');
  const id = await submit(creator.scoped);
  expect((await adminApi('/' + id, undefined, '')).status).toBe(401);
  expect(await (await adminApi()).json()).toMatchObject({ submissions: expect.arrayContaining([expect.objectContaining({ id })]) });
  const original = await adminApi('/' + id + '/files/original');
  expect(original.headers.get('content-disposition')).toBe('attachment; filename="pot.json"');
  expect(JSON.parse(await original.text())).toEqual(assetExample);
  const value = form({ status: 'approved', priceCents: '279', name: 'New name', frequency: 'rare', adminNote: 'Private note' });
  value.set('replacement', new File([JSON.stringify(assetExample)], 'revision.json'));
  expect((await adminApi('/' + id + '/review', value)).status).toBe(200);
  expect(await (await adminApi('/' + id)).json()).toMatchObject({
    submission: {
      name: 'Tide pool pot', status: 'approved', terms_version: TERMS_VERSION, asset_filename: 'pot.json',
      replacement_filename: 'revision.json', approved_price_cents: 279, approved_frequency: 'rare', approved_item: { name: 'New name' },
    },
  });
  expect(await (await shoreRequest('/submit/items', creator.scoped)).json()).toMatchObject({
    submissions: [expect.not.objectContaining({ admin_note: 'Private note' })],
  });
  expect((await adminApi('/' + id + '/review', form({ status: 'rejected' }))).status).toBe(200);
  expect(await db.query('SELECT action, target_type FROM admin_audit WHERE target_id = $1', [id])).toHaveLength(2);
  expect(await (await shoreRequest('/submit/items', creator.scoped)).json()).toMatchObject({ submissions: [{ id, status: 'rejected' }] });
});

it('credits only completed credit orders, including a discounted order retried concurrently', async () => {
  const creator = await user('Credit creator');
  const buyer = await user('Credit buyer');
  const id = await submit(creator.scoped);
  await approve(id, 'deckchair', '250');
  await db.query('UPDATE users SET credit_cents = 1000 WHERE id = $1', [buyer.id]);
  await db.query("INSERT INTO promo_codes (code, kind, value, max_uses, created_at) VALUES ('HALF', 'percent', 50, 1, $1)", [now]);
  const buy = { productId: 'item_deckchair', promoCode: 'HALF', requestId: crypto.randomUUID() };
  const attempts = await Promise.all([json('/store/credit-purchase', buy, buyer.token), json('/store/credit-purchase', buy, buyer.token)]);
  for (const res of attempts) {
    expect(res.status, await res.clone().text()).toBe(200);
    // sand bucks (docs/SAND_BUCKS.md): 25 bucks, half off rounds the discount down to 12
    expect(await res.json()).toMatchObject({ paidCents: 130, discountCents: 120, creditCents: 870 });
  }
  expect(await credit(creator.token)).toBe(40);
  expect(await db.query('SELECT id FROM inventory WHERE user_id = $1', [buyer.id])).toHaveLength(1);
  expect(await db.query('SELECT kind, amount_cents FROM credit_ledger WHERE user_id = $1', [creator.id]))
    .toEqual([{ kind: 'creator_royalty', amount_cents: 40 }]);
  expect(await (await shoreRequest('/submit/items', creator.scoped)).json()).toMatchObject({
    submissions: [{ id, sales_count: 1, total_credit_earned_cents: 40 }],
  });
  expect((await json('/store/credit-purchase', { ...buy, promoCode: '' }, buyer.token)).status).toBe(409);
  // 0 is free: listed at $0, claimed with no credit spent and no royalty
  await approve(id, 'deckchair', '0');
  const listed = await (await root.request('/api/store/products')).json() as { products: { id: string; usd: number }[] };
  expect(listed.products.find((p) => p.id === 'item_deckchair')?.usd).toBe(0);
  const quote = await json('/store/quote', { productId: 'item_deckchair' }, buyer.token);
  expect(await quote.json()).toMatchObject({ priceCents: 0, finalCents: 0 });
  const claim = { productId: 'item_deckchair', requestId: crypto.randomUUID(), freeOnly: true };
  const free = await json('/store/credit-purchase', claim, buyer.token);
  expect(free.status, await free.clone().text()).toBe(200);
  expect(await free.json()).toMatchObject({ paidCents: 0, creditCents: 870 });
  expect(await db.query('SELECT id FROM inventory WHERE user_id = $1', [buyer.id])).toHaveLength(2);
  expect(await credit(creator.token)).toBe(40);

  await approve(id, 'deckchair', '250');
  const retried = await json('/store/credit-purchase', claim, buyer.token);
  expect(retried.status).toBe(200);
  expect(await retried.json()).toMatchObject({ paidCents: 0, creditCents: 870 });
  const stale = await json('/store/credit-purchase', { ...claim, requestId: crypto.randomUUID() }, buyer.token);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: expect.stringContaining('no longer free') });
  expect(await credit(buyer.token)).toBe(870);
  expect(await credit(creator.token)).toBe(40);
  expect(await db.query('SELECT id FROM inventory WHERE user_id = $1', [buyer.id])).toHaveLength(2);

  // "not for sale" is its own choice, whatever the price
  const off = await adminApi('/' + id + '/review', form({
    status: 'approved', productId: 'item_deckchair', itemId: 'deckchair', priceCents: '250', notForSale: 'true', name: 'Edited pot', frequency: 'limited',
  }));
  expect(off.status, await off.clone().text()).toBe(200);
  expect((await json('/store/quote', buy, buyer.token)).status).toBe(404);
  const shop = await (await root.request('/api/store/products')).json() as { products: { id: string }[] };
  expect(shop.products.some((p) => p.id === 'item_deckchair')).toBe(false);
  expect(await (await shoreRequest('/submit/items', creator.scoped)).json()).toMatchObject({ submissions: [{ id, for_sale: false }] });

  // a linked item for sale needs a price
  const blank = await adminApi('/' + id + '/review', form({
    status: 'approved', productId: 'item_deckchair', itemId: 'deckchair', priceCents: '', name: 'Edited pot', frequency: 'limited',
  }));
  expect(blank.status).toBe(400);
});

it('uses the approved price at native purchase time and reverses a refund once', async () => {
  const creator = await user('Native creator');
  const buyer = await user('Native buyer');
  const id = await submit(creator.scoped);
  await approve(id, 'lighthouse', '500');
  nativeBoughtAt = now;
  now += 1;
  await approve(id, 'lighthouse', '200');
  const payment = { productId: 'item_lighthouse', platform: 'ios', jws: 'live-receipt' };
  expect((await json('/store/purchase', payment, buyer.token)).status).toBe(200);
  expect(await (await json('/store/purchase', payment, buyer.token)).json()).toMatchObject({ already: true });
  expect((await json('/store/purchase', { ...payment, jws: 'sandbox-receipt' }, buyer.token)).status).toBe(200);
  expect(await credit(creator.token)).toBe(150);
  expect((await json('/store/credit-purchase', { productId: 'item_parasol' }, creator.token)).status).toBe(200);
  expect(await credit(creator.token)).toBe(50);
  expect((await json('/store/apple/notifications', { signedPayload: payment.jws })).status).toBe(200);
  expect((await json('/store/apple/notifications', { signedPayload: payment.jws })).status).toBe(200);
  expect(await credit(creator.token)).toBe(0);
  expect(await db.query('SELECT creator_credit_debt_cents FROM users WHERE id = $1', [creator.id])).toEqual([{ creator_credit_debt_cents: 100 }]);
  nativeBoughtAt = now;
  expect((await json('/store/purchase', { productId: payment.productId, platform: 'android', token: 'google-order' }, buyer.token)).status).toBe(200);
  expect(await credit(creator.token)).toBe(0);
  expect(await db.query('SELECT creator_credit_debt_cents FROM users WHERE id = $1', [creator.id])).toEqual([{ creator_credit_debt_cents: 40 }]);
});

it('pays no credit for a purchase verified after the submission was rejected', async () => {
  const creator = await user('Rejected creator');
  const buyer = await user('Rejected buyer');
  const id = await submit(creator.scoped);
  await approve(id, 'parasol', '500');
  // The receipt predates the rejection: bought while the item was approved.
  nativeBoughtAt = now;
  now += 1;
  expect((await adminApi('/' + id + '/review', form({ status: 'rejected' }))).status).toBe(200);
  const payment = { productId: 'item_parasol', platform: 'android', token: 'google-order-rejected' };
  expect((await json('/store/purchase', payment, buyer.token)).status).toBe(200);
  // The item itself is still granted (the store receipt verifies); only the
  // creator credit is withheld.
  expect(await db.query('SELECT item_id FROM inventory WHERE user_id = $1', [buyer.id])).toHaveLength(1);
  expect(await credit(creator.token)).toBe(0);
  expect(await db.query('SELECT id FROM creator_royalties WHERE submission_id = $1', [id])).toHaveLength(0);
  expect(await (await shoreRequest('/submit/items', creator.scoped)).json()).toMatchObject({
    submissions: [{ id, sales_count: 0, total_credit_earned_cents: 0 }],
  });
});

it('pays no credit when a creator buys their own item', async () => {
  const creator = await user('Self creator');
  const id = await submit(creator.scoped);
  await approve(id, 'beachhut', '250');
  await db.query('UPDATE users SET credit_cents = 1000 WHERE id = $1', [creator.id]);
  const res = await json('/store/credit-purchase', { productId: 'item_beachhut', requestId: crypto.randomUUID() }, creator.token);
  expect(res.status, await res.clone().text()).toBe(200);
  expect(await res.json()).toMatchObject({ paidCents: 250, creditCents: 750 });
  expect(await db.query('SELECT id FROM creator_royalties WHERE submission_id = $1', [id])).toHaveLength(0);
  expect(await (await shoreRequest('/submit/items', creator.scoped)).json()).toMatchObject({
    submissions: [{ id, sales_count: 0, total_credit_earned_cents: 0 }],
  });
});

it('sends a free item to the shop claim instead of a card or Steam checkout (the item products kept for apps already out)', async () => {
  const creator = await user('Free creator');
  const buyer = await user('Free Steam buyer', true);
  const id = await submit(creator.scoped);
  await approve(id, 'palmtree', '0');
  for (const path of ['/store/steam/init', '/store/web-checkout']) {
    const res = await json(path, { productId: 'item_palmtree' }, buyer.token);
    expect(res.status, path).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'that one is free: claim it in the shop' });
  }
});

it('a free item is claimed in the shop for nothing', async () => {
  const creator = await user('Free shop creator');
  const buyer = await user('Free shop buyer');
  const id = await submit(creator.scoped);
  await approve(id, 'towel', '0');
  const free = await json('/store/credit-purchase', { productId: 'item_towel', requestId: crypto.randomUUID(), freeOnly: true }, buyer.token);
  expect(free.status, await free.clone().text()).toBe(200);
});

it('keeps a free item out of the shop until it is approved, and again once rejected', async () => {
  const creator = await user('Unreviewed creator');
  const buyer = await user('Unreviewed buyer');
  const price = async () =>
    ((await (await root.request('/api/store/products')).json()) as { products: { id: string; usd: number }[] }).products.find((p) => p.id === 'item_surfboard')?.usd;
  // proposed free, not reviewed: no product link, so the shop's own surfboard is unchanged
  const id = await submit(creator.scoped, uploadForm({ priceCents: '0' }));
  expect(await db.query('SELECT product_id FROM item_submissions WHERE id = $1', [id])).toEqual([{ product_id: null }]);
  expect(await price()).toBe(1.49);
  // only the admin's approval makes it free
  await approve(id, 'surfboard', '0');
  expect(await price()).toBe(0);
  const rejected = await adminApi('/' + id + '/review', form({ status: 'rejected' }));
  expect(rejected.status).toBe(200);
  expect(await price()).toBe(undefined);
  expect((await json('/store/credit-purchase', { productId: 'item_surfboard', requestId: crypto.randomUUID() }, buyer.token)).status).toBe(404);
});

it('honors the amount recorded at Steam and Xsolla checkout after an admin changes the price (apps already out)', async () => {
  const creator = await user('Checkout creator');
  const buyer = await user('Steam buyer', true);
  const id = await submit(creator.scoped);
  await approve(id, 'sandcastle', '180');
  const productId = 'item_sandcastle';
  const openedSteam = await json('/store/steam/init', { productId }, buyer.token);
  expect(openedSteam.status).toBe(200);
  const { orderId } = await openedSteam.json() as { orderId: string };
  const openedWeb = await json('/store/web-checkout', { productId }, buyer.token);
  expect(openedWeb.status).toBe(200);
  const { order } = await openedWeb.json() as { order: string };
  const [row] = await db.query<{ provider_order_id: string }>('SELECT provider_order_id FROM web_orders WHERE id = $1', [order]);
  now += 1;
  await approve(id, 'sandcastle', '330');

  expect((await json('/store/steam/finalize', { orderId }, buyer.token)).status).toBe(200);
  expect(await (await json('/store/steam/finalize', { orderId }, buyer.token)).json()).toMatchObject({ already: true });
  // 30% of $1.80, as whole sand bucks (docs/SAND_BUCKS.md): 5
  expect(await credit(creator.token)).toBe(50);
  const payload = JSON.stringify({
    notification_type: 'order_paid', items: [{ sku: productId, quantity: 1 }],
    order: { id: row.provider_order_id, currency: 'USD', amount: '1.80' },
    user: { external_id: buyer.id },
  });
  for (let i = 0; i < 2; i++) {
    const res = await root.request('/api/store/xsolla/webhook', { method: 'POST', body: payload, headers: { Authorization: signWebhook(payload, secret) } });
    expect(res.status, await res.text()).toBe(204);
  }
  expect(await credit(creator.token)).toBe(100);
});

it('pays a community item\'s creator from sand bucks spent, at the price when it was bought', async () => {
  const creator = await user('Bucks creator');
  const buyer = await user('Bucks buyer');
  const id = await submit(creator.scoped);
  await approve(id, 'lifeguardtower', '180');
  await db.query('UPDATE users SET credit_cents = 1000 WHERE id = $1', [buyer.id]);
  const bought = await json('/store/buy', { productId: 'item_lifeguardtower', requestId: crypto.randomUUID() }, buyer.token);
  expect(bought.status, await bought.clone().text()).toBe(200);
  now += 1;
  await approve(id, 'lifeguardtower', '330');
  // 18 sand bucks paid, 30% is 5.4: rounds to 5
  expect(await credit(creator.token)).toBe(50);
  expect(await credit(buyer.token)).toBe(820);
});

it('a gifted community item carries its royalty: trading the gift in takes it back from the creator', async () => {
  const creator = await user('Gift creator');
  const buyer = await user('Gift buyer');
  const friend = await user('Gift friend');
  const id = await submit(creator.scoped);
  await approve(id, 'hammock', '250');
  await db.query('UPDATE users SET credit_cents = 1000 WHERE id = $1', [buyer.id]);
  // two at once: each unit is its own row with its own royalty (25 bucks, 30% is 7.5: 8 each)
  const bought = await json('/store/buy', { basket: [{ product: 'item_hammock', quantity: 2 }], requestId: crypto.randomUUID() }, buyer.token);
  expect(bought.status, await bought.clone().text()).toBe(200);
  expect(await credit(creator.token)).toBe(160);
  const [{ code }] = await db.query<{ code: string }>('SELECT code FROM beach WHERE id = $1', [friend.id]);
  expect((await json('/gifts', { code, item: 'hammock' }, buyer.token)).status).toBe(200);
  // the friend trades the gift in: its value, and the creator gives back that unit's royalty only
  const traded = await json('/bag/trade-in', { item: 'hammock' }, friend.token);
  expect(traded.status, await traded.clone().text()).toBe(200);
  expect(await traded.json()).toMatchObject({ credited: 25 });
  expect(await credit(creator.token)).toBe(80);
  // the buyer trades theirs in: the other royalty goes back
  expect((await json('/bag/trade-in', { item: 'hammock' }, buyer.token)).status).toBe(200);
  expect(await credit(creator.token)).toBe(0);
  expect(await db.query('SELECT id FROM creator_royalties WHERE submission_id = $1 AND refunded_at IS NULL', [id])).toHaveLength(0);
});
