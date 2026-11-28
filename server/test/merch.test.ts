// The merch store's pure parts and its site (docs/MERCH_STORE.md). The
// order state machine is tested in test/stateMachines/merch.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { MERCH, PRODUCTS, atCost, costCents, positionFor, priceCart, printItems, productById, setCents, unitCents } from '../src/merchCatalog.js';
import { PRINTFUL_DATA } from '../src/generated/merchCatalogData.js';
import { createMerch, recipientOf as recipientOfForTest } from '../src/merch.js';
import { merchFromEnv, merchTickFromEnv, signStripe, stripeForm, verifyStripeSignature } from '../src/merchProviders.js';
import { createRootApp } from '../src/rootApp.js';
import { openTestDb } from './testDb.js';

const ON = { sunglassesVariant: null };

describe('merch catalog', () => {
  it('every colour and size has a Printful variant and a cost, every print a placement Printful prints, and every brand file exists', () => {
    for (const p of PRODUCTS) {
      if (p.parts) continue;
      const d = PRINTFUL_DATA[p.data];
      for (const c of p.colors) for (const s of p.sizes) expect(d.variants[`${c.id}/${s}`], `${p.id} ${c.id}/${s}`).toBeTruthy();
      for (const pr of [...p.prints, ...(p.own?.prints ?? [])]) {
        expect(d.printfiles[pr.placement] ?? (pr.placement === 'embroidery_front' ? [1, 1] : undefined), `${p.id} ${pr.placement}`).toBeTruthy();
        if ('file' in pr.art) for (const f of [pr.art.file, pr.art.light].filter(Boolean) as string[]) expect(fs.existsSync(path.join('..', 'public', 'merch', f)), f).toBe(true);
      }
    }
  });

  it('sells anything that shows off beech at cost: Printful’s price, extra placements, Stripe’s fee and about $1, per size', () => {
    const tee = productById('tee')!;
    const cost = PRINTFUL_DATA.tee.variants['white/M'][1];
    expect(unitCents(tee, 'white', 'M')).toBe(atCost(cost));
    expect(atCost(cost) - cost - Math.round(atCost(cost) * 0.029 + 30)).toBeGreaterThanOrEqual(100); // we keep about $1
    expect(atCost(cost) - cost - Math.round(atCost(cost) * 0.029 + 30)).toBeLessThan(200);
    // a bigger size costs Printful more, so it costs more
    expect(unitCents(tee, 'white', '3XL')!).toBeGreaterThan(unitCents(tee, 'white', 'M')!);
    // front and back: the back placement is added
    const top = productById('top-tee')!;
    expect(costCents(top, 'white', 'M')).toBe(cost + PRINTFUL_DATA.tee.placementCents.back);
    // with their own beach: its own price at the cheapest size, plus what a bigger size costs more
    expect(unitCents(top, 'white', 'S', true)).toBe(3800);
    expect(unitCents(top, 'white', '3XL', true)!).toBeGreaterThan(3800);
    expect(unitCents(productById('side-tee')!, 'white', 'M', true)).toBeNull(); // no side view of their beach yet
  });

  it('prices a cart on the server, and refuses what it can’t make', () => {
    const tee = { product: 'tee', quantity: 2, color: 'white', size: 'M' };
    const one = unitCents(productById('tee')!, 'white', 'M')!;
    expect(priceCart([tee], ON)).toMatchObject({ ok: true, subtotalCents: 2 * one, shippingCents: MERCH.shippingCents });
    expect(priceCart([{ ...tee, quantity: 10 }], ON)).toMatchObject({ ok: true, subtotalCents: 10 * one, shippingCents: 0 });
    expect(priceCart([{ product: 'sunglasses', quantity: 1 }], ON)).toEqual({ ok: false, error: 'something in your bag isn’t sold any more' });
    expect(priceCart([{ product: 'set', quantity: 1, parts: { tee: { color: 'white', size: 'M' } } }], ON)).toEqual({ ok: false, error: 'pick a color for the beech hoodie' });
    expect(priceCart([{ ...tee, beachId: 'nope' }], ON)).toEqual({ ok: false, error: 'the beech tee can’t print your beach' });
    expect(priceCart([{ product: 'top-tee', quantity: 1, color: 'white', size: 'M', beachId: 'nope' }], ON)).toEqual({ ok: false, error: 'pick a beach for your top view tee' });
    expect(priceCart([{ ...tee, color: 'aqua' }], ON)).toEqual({ ok: false, error: 'pick a color for the beech tee' });
    expect(priceCart('nope', ON)).toEqual({ ok: false, error: 'your bag is empty' });
  });

  it('prices the set at cost as one, and splits it over its parts so the slip adds up', () => {
    const set = productById('set')!;
    const parts = { tee: { color: 'white', size: 'M' }, hoodie: { color: 'sand', size: 'L' }, hat: { color: 'khaki', size: 'One size' }, flipflops: { color: 'white', size: 'S' }, towel: { color: 'white', size: '30″×60″' } };
    const price = setCents(set, parts)!;
    const each = Object.entries(parts).map(([id, c]) => unitCents(productById(id)!, c.color, c.size)!);
    expect(price).toBeLessThan(each.reduce((s, x) => s + x, 0)); // one Stripe fee and one $1, not five
    const items = printItems({ product: 'set', quantity: 2, unitCents: price, choice: {}, parts }, ON, (f) => `https://x/${f}`);
    expect(items).toHaveLength(5);
    expect(items.reduce((s, i) => s + i.retailCents, 0)).toBe(price);
    expect(items.every((i) => i.quantity === 2)).toBe(true);
  });

  it('places each print in its area: a small word on the chest, a 10″ square high on the back', () => {
    const [item] = printItems({ product: 'top-tee', quantity: 1, unitCents: 2100, choice: { color: 'heather', size: 'M' } }, ON, (f) => `https://x/${f}`);
    expect(item.variantId).toBe(PRINTFUL_DATA.tee.variants['heather/M'][0]);
    const [front, back] = item.files!;
    expect(front).toMatchObject({ type: 'front', url: 'https://x/word.png' });
    expect(front.position!.width).toBeLessThan(front.position!.area_width / 3);
    expect(front.position!.left).toBeGreaterThan(front.position!.area_width / 2); // the wearer’s left
    expect(back).toMatchObject({ type: 'back', url: 'https://x/sample-square.png', position: { area_width: 1800, area_height: 2400, width: 1500, height: 1500, left: 150 } });
    // with their own beach, the back is their beach
    const [own] = printItems({ product: 'top-tee', quantity: 1, unitCents: 3800, choice: { color: 'heather', size: 'M' } }, ON, (f) => `https://x/${f}`, 'https://x/print/abc.png');
    expect(own.files![1].url).toBe('https://x/print/abc.png');
    expect(() => printItems({ product: 'side-tee', quantity: 1, unitCents: 2100, choice: { color: 'white', size: 'M' } }, ON, (f) => f, 'https://x/p.png')).toThrow();
  });

  it('gives embroidery one thread: black on light hats, white on dark; nothing else gets options', () => {
    const hat = (color: string) => printItems({ product: 'hat', quantity: 1, unitCents: 2000, choice: { color, size: 'One size' } }, ON, (f) => `https://x/${f}`)[0];
    expect(hat('khaki').files![0]).toMatchObject({ type: 'embroidery_front', url: 'https://x/mark-wide.png' });
    expect(hat('khaki').options).toEqual([{ id: 'thread_colors', value: ['#000000'] }]);
    expect(hat('navy').files![0].url).toBe('https://x/mark-wide-light.png');
    expect(hat('navy').options).toEqual([{ id: 'thread_colors', value: ['#FFFFFF'] }]);
    expect(printItems({ product: 'tee', quantity: 1, unitCents: 1400, choice: { color: 'white', size: 'M' } }, ON, (f) => f)[0].options).toBeUndefined();
  });

  it('positions keep the art’s shape inside the area', () => {
    const p = positionFor('contain', 2700, 1140, [3000, 760]);
    expect(p.width / p.height).toBeCloseTo(3000 / 760, 1);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.top + p.height).toBeLessThanOrEqual(1140);
    expect(positionFor('fill', 100, 50, [1, 1])).toMatchObject({ width: 100, height: 50, top: 0, left: 0 });
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

describe('merch tick (Cloud Scheduler)', () => {
  it('reads the Scheduler tick from the environment: both variables, or neither counts', () => {
    expect(merchTickFromEnv({})).toBeUndefined();
    expect(merchTickFromEnv({ MERCH_TICK_AUDIENCE: 'https://beech.test/api/merch/tick' })).toBeUndefined();
    expect(merchTickFromEnv({ MERCH_TICK_SERVICE_ACCOUNT: 'scheduler@beech.test' })).toBeUndefined();
    expect(
      merchTickFromEnv({ MERCH_TICK_AUDIENCE: 'https://beech.test/api/merch/tick', MERCH_TICK_SERVICE_ACCOUNT: 'scheduler@beech.test' }),
    ).toEqual({ audience: 'https://beech.test/api/merch/tick', email: 'scheduler@beech.test' });
  });

  it('the tick endpoint 404s without the Scheduler variables, and rejects a call with no token', async () => {
    const db = await openTestDb();
    try {
      const noTick = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true });
      expect((await noTick.request('/merch/tick', { method: 'POST' })).status).toBe(404);
      const withTick = createApp(db, {
        googleClientIds: [],
        appleClientIds: [],
        allowedOrigins: [],
        devAuth: true,
        merch: createMerch(db, { now: () => Date.now(), tick: { audience: 'https://beech.test/api/merch/tick', email: 'scheduler@beech.test' } }),
      });
      expect((await withTick.request('/merch/tick', { method: 'POST' })).status).toBe(401);
    } finally {
      await db.close();
    }
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
