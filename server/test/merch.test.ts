// The merch store's pure parts and its site (docs/MERCH_STORE.md). The
// order state machine is tested in test/stateMachines/merch.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { MERCH, PRODUCTS, priceCart, printItems, productById } from '../src/merchCatalog.js';
import { recipientOf as recipientOfForTest } from '../src/merch.js';
import { merchFromEnv, signStripe, stripeForm, verifyStripeSignature } from '../src/merchProviders.js';
import { createRootApp } from '../src/rootApp.js';
import { openTestDb } from './testDb.js';

const ON = { sunglassesVariant: 5 };
const OFF = { sunglassesVariant: null };

describe('merch catalog', () => {
  it('every colour and size of every printed product has a Printful variant, and its art exists in both inks', () => {
    for (const p of PRODUCTS) {
      if (p.parts || p.warehouse) continue;
      for (const c of p.colors) for (const s of p.sizes) expect(p.variants[`${c.id}/${s}`], `${p.id} ${c.id}/${s}`).toBeGreaterThan(0);
      if (p.art) {
        expect(fs.existsSync(path.join('..', 'public', 'merch', p.art)), p.art).toBe(true);
        if (p.colors.some((c) => c.dark)) expect(fs.existsSync(path.join('..', 'public', 'merch', p.art.replace('.png', '-light.png')))).toBe(true);
      }
    }
  });

  it('prices a cart on the server: quantities, free shipping, sold out', () => {
    const tee = { product: 'tee', quantity: 2, color: 'white', size: 'M' };
    const a = priceCart([tee], ON);
    expect(a).toMatchObject({ ok: true, subtotalCents: 6000, shippingCents: MERCH.shippingCents });
    const b = priceCart([{ ...tee, quantity: 4 }], ON);
    expect(b).toMatchObject({ ok: true, subtotalCents: 12000, shippingCents: 0 });
    expect(priceCart([{ product: 'sunglasses', quantity: 1 }], OFF)).toEqual({ ok: false, error: 'something in your bag isn’t sold any more' }); // out of the store for now
    expect(priceCart([{ product: 'set', quantity: 1, parts: {} }], OFF)).toMatchObject({ ok: false });
    expect(priceCart([{ product: 'set', quantity: 1, parts: { tee: { color: 'white', size: 'M' } } }], ON)).toEqual({ ok: false, error: 'pick a color for the beech hoodie' });
    expect(priceCart([{ product: 'beach-tee', quantity: 1, color: 'white', size: 'M' }], ON)).toEqual({ ok: false, error: 'pick a beach for your tee' });
    expect(priceCart('nope', ON)).toEqual({ ok: false, error: 'your bag is empty' });
  });

  it('splits the set’s price over its parts so they add up to what was paid', () => {
    const set = productById('set')!;
    const parts = { tee: { color: 'white', size: 'M' }, hoodie: { color: 'sand', size: 'L' }, hat: { color: 'khaki', size: 'One size' }, flipflops: { color: 'white', size: 'S' }, towel: { color: 'white', size: '30″ × 60″' } };
    const items = printItems({ product: 'set', quantity: 2, unitCents: set.cents, choice: {}, parts }, ON, (f) => `https://x/${f}`);
    expect(items).toHaveLength(5);
    expect(items.reduce((s, i) => s + i.retailCents, 0)).toBe(set.cents);
    expect(items.every((i) => i.quantity === 2)).toBe(true);
    expect(() => printItems({ product: 'beach-tee', quantity: 1, unitCents: 3600, choice: { color: 'white', size: 'M' } }, ON, (f) => f)).toThrow(/no print file/);
  });

  it('gives the embroidered hat Printful’s thread colours, and nothing else any options', () => {
    const hat = printItems({ product: 'hat', quantity: 1, unitCents: 2800, choice: { color: 'khaki', size: 'One size' } }, ON, (f) => `https://x/${f}`);
    expect(hat).toHaveLength(1);
    expect(hat[0].files).toEqual([{ type: 'embroidery_front', url: 'https://x/logo-hat.png' }]);
    expect(hat[0].options).toEqual([{ id: 'thread_colors', value: ['#FFFFFF', '#3399FF', '#000000', '#A67843'] }]);
    const tee = printItems({ product: 'tee', quantity: 1, unitCents: 3000, choice: { color: 'white', size: 'M' } }, ON, (f) => `https://x/${f}`);
    expect(tee[0].options).toBeUndefined();
  });
});

describe('merch providers', () => {
  it('Stripe signatures: right secret and fresh only', () => {
    const now = Date.UTC(2026, 10, 27);
    const sig = signStripe('{"a":1}', 'whsec', now);
    expect(verifyStripeSignature('{"a":1}', sig, 'whsec', now)).toBe(true);
    expect(verifyStripeSignature('{"a":2}', sig, 'whsec', now)).toBe(false);
    expect(verifyStripeSignature('{"a":1}', sig, 'other', now)).toBe(false);
    expect(verifyStripeSignature('{"a":1}', sig, 'whsec', now + 10 * 60 * 1000)).toBe(false);
    expect(verifyStripeSignature('{"a":1}', undefined, 'whsec', now)).toBe(false);
  });

  it('encodes nested forms the way Stripe reads them', () => {
    expect(stripeForm({ a: 1, b: { c: 'x' }, d: [{ e: 2 }], f: ['US', 'CA'], g: undefined }).toString()).toBe(
      'a=1&b%5Bc%5D=x&d%5B0%5D%5Be%5D=2&f%5B0%5D=US&f%5B1%5D=CA',
    );
  });

  it('is off until all four secrets are set; reads the sunglasses variant', () => {
    expect(merchFromEnv({}).cfg).toBeNull();
    expect(merchFromEnv({ STRIPE_SECRET_KEY: 'k' }).missing).toEqual(['STRIPE_MERCH_WEBHOOK_SECRET', 'PRINTFUL_TOKEN', 'PRINTFUL_WEBHOOK_SECRET']);
    const env = { STRIPE_SECRET_KEY: 'k', STRIPE_MERCH_WEBHOOK_SECRET: 'w', PRINTFUL_TOKEN: 'p', PRINTFUL_WEBHOOK_SECRET: 's' };
    expect(merchFromEnv(env).cfg).toMatchObject({ storeUrl: 'https://store.beech.games', sunglassesVariant: null });
    expect(merchFromEnv({ ...env, MERCH_SUNGLASSES_VARIANT: '123' }).cfg?.sunglassesVariant).toBe(123);
  });

  it('turns Stripe’s shipping details (old and new places) into a Printful recipient', () => {
    const address = { line1: '1 Sea St', line2: null, city: 'Brighton', state: null, postal_code: 'BN1', country: 'GB' };
    expect(recipientOfForTest({ id: 'cs', shipping_details: { name: 'A', address }, customer_details: { email: 'a@b.c' } })).toEqual({ name: 'A', address1: '1 Sea St', city: 'Brighton', country_code: 'GB', zip: 'BN1', email: 'a@b.c' });
    expect(recipientOfForTest({ id: 'cs', collected_information: { shipping_details: { name: 'B', address } } })?.name).toBe('B');
    expect(recipientOfForTest({ id: 'cs' })).toBeNull();
  });
});

describe('store.beech.games', () => {
  let db: Db;
  let root: ReturnType<typeof createRootApp>;
  let publicDir: string;
  beforeAll(async () => {
    db = await openTestDb();
    const api = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true });
    publicDir = fs.mkdtempSync(path.join(process.cwd(), 'test', '.tmp-store-'));
    fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><body>spa</body>');
    fs.mkdirSync(path.join(publicDir, 'merch'));
    fs.writeFileSync(path.join(publicDir, 'merch', 'logo-front.png'), 'png');
    root = createRootApp(db, api, publicDir);
  });
  afterAll(async () => {
    fs.rmSync(publicDir, { recursive: true, force: true });
    await db.close();
  });
  const get = (p: string, host: string) => root.request(`http://${host}${p}`, { headers: { host } });

  it('serves the store on its host, and under /merch-store elsewhere', async () => {
    const page = await get('/', 'store.beech.games');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>beech store</title>');
    expect(await (await get('/order/00000000-0000-4000-8000-000000000000', 'store.beech.games')).text()).toContain('Your order');
    expect(await (await get('/merch-store/', 'play.beech.games')).text()).toContain('"base":"/merch-store"');
    // the game isn't served on the store host
    expect((await get('/guide', 'store.beech.games')).status).toBe(302);
  });

  it('forwards its /api to the game’s /merch, and only the store’s routes', async () => {
    const cat = await get('/api/catalog', 'store.beech.games');
    expect(cat.status).toBe(200);
    const body = (await cat.json()) as { open: boolean; products: { id: string; available: boolean }[] };
    expect(body.open).toBe(false);
    expect(body.products.some((p) => p.id === 'sunglasses')).toBe(false); // out of the store for now
    expect(body.products.find((p) => p.id === 'set')?.available).toBe(true); // the five, no sunglasses to wait on
    expect((await get('/api/me', 'store.beech.games')).status).toBe(404);
    expect((await get('/api/../me', 'store.beech.games')).status).not.toBe(200);
    const checkout = await root.request('http://store.beech.games/api/checkout', { method: 'POST', headers: { host: 'store.beech.games', 'Content-Type': 'application/json' }, body: '{"lines":[]}' });
    expect(checkout.status).toBe(503);
  });

  it('serves the brand art Printful fetches, and nothing else from disk', async () => {
    expect((await get('/merch-art/logo-front.png', 'store.beech.games')).status).toBe(200);
    expect((await get('/merch-art/..%2Findex.html', 'store.beech.games')).status).toBe(404);
  });
});
