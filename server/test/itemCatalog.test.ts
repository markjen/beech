// beechshore.com item catalog (/items): every item, one page per item,
// votes and comments on each page, linked from the guide.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { createApp } from '../src/app.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { CATALOG_ITEMS, catalogGroup } from '../src/itemCatalog.js';
import { migrate } from '../src/migrations.js';
import { createRootApp } from '../src/rootApp.js';
import { ITEMS } from '../../src/world/items';

let db: Db;
let root: ReturnType<typeof createRootApp>;
let publicDir: string;

// a 1×1 transparent PNG, standing in for a render in the test public dir
const ONE_PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

const shore = 'https://beechshore.com';
const onShore = (p: string, init: RequestInit = {}) =>
  root.request(shore + p, { ...init, headers: { Host: 'beechshore.com', ...(init.headers ?? {}) } });
const bearer = (token?: string) => (token ? { Authorization: `Bearer ${token}` } : {});

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  const api = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true });
  publicDir = fs.mkdtempSync(path.join(process.cwd(), 'test', '.tmp-items-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><html><head><title>beech</title></head><body>beech-spa-marker</body></html>');
  fs.mkdirSync(path.join(publicDir, 'items'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'items', 'lighthouse.png'), ONE_PX);
  root = createRootApp(db, api, publicDir, {
    shore: { hosts: ['beechshore.com', 'www.beechshore.com'], url: 'https://beechshore.com', gameUrl: 'https://play.example.test' },
  });
});
afterAll(async () => {
  await db.close();
  fs.rmSync(publicDir, { recursive: true, force: true });
});

async function user(name: string) {
  const res = await root.request('/api/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  expect(res.status).toBe(200);
  const data = (await res.json()) as { token: string; user: { id: string } };
  const connected = await root.request('/api/item-submissions/connect', { method: 'POST', headers: bearer(data.token) });
  expect(connected.status).toBe(200);
  return { id: data.user.id, token: data.token, scoped: ((await connected.json()) as { token: string }).token };
}

const json = (p: string, method: string, token?: string, body?: unknown) =>
  onShore(p, {
    method,
    headers: { ...bearer(token), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('the mirror matches the catalog', () => {
  // The server cannot import src/world/items.ts, so itemCatalog.ts mirrors
  // it. These two tests are what keep the mirror honest — they live here,
  // in the server suite, because the root suite has no server dependencies
  // and its typecheck must not follow imports into server/src.
  it('lists every catalog item, field for field', () => {
    expect(CATALOG_ITEMS.map((i) => i.id)).toEqual(ITEMS.map((i) => i.id));
    for (const it of ITEMS) {
      const mirror = CATALOG_ITEMS.find((m) => m.id === it.id)!;
      expect(mirror.name, it.id).toBe(it.name);
      expect(mirror.rarity, it.id).toBe(it.rarity);
      expect(mirror.source, it.id).toBe(it.source);
      expect(mirror.size, it.id).toEqual(it.size);
      expect(mirror.variants, it.id).toBe(it.variants);
      expect(mirror.fixedSize ?? false, it.id).toBe(it.fixedSize ?? false);
      expect(mirror.product, it.id).toBe(it.product);
    }
  });

  it('every pull item is in the claw pool or a vending set, never both', () => {
    for (const it of ITEMS.filter((i) => i.source === 'pull')) {
      const mirror = CATALOG_ITEMS.find((m) => m.id === it.id)!;
      expect(['claw', 'vending']).toContain(catalogGroup(mirror));
    }
  });
});

describe('item catalog pages', () => {
  it('lists every item, grouped by how you get it, with links to each page', async () => {
    const res = await onShore('/items');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Every item in beech');
    for (const name of ['Rock', 'Lighthouse', 'Conch', 'Pink shell', 'Beach ball']) expect(html).toContain(name);
    for (const heading of ['Free — in your bag', 'Claw machine prizes', 'Vending machine', 'Shop']) expect(html).toContain(heading);
    expect(html).toContain('/items/lighthouse');
    expect(html).toContain('/items/nautilus');
  });

  it('shows one item with its price, size and how to get it; unknown ids 404', async () => {
    const res = await onShore('/items/lighthouse');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Lighthouse');
    expect(html).toContain('Legendary');
    expect(html).toContain('$2.99');
    expect(html).toContain('Fixed size');
    expect(html).toContain('Buy in the shop');
    expect(html).toContain('Vote for this item');
    expect(html).toContain('Comments');
    expect(html).toContain('/items/img/lighthouse.png');
    expect((await onShore('/items/nope')).status).toBe(404);
    expect(await (await onShore('/items/nope')).text()).toContain('No such item');
  });

  it('serves an item render, and 404s for unknown items and missing files', async () => {
    const res = await onShore('/items/img/lighthouse.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).equals(ONE_PX)).toBe(true);
    expect((await onShore('/items/img/nope.png')).status).toBe(404);
    expect((await onShore('/items/img/rock.png')).status).toBe(404); // no file in the test public dir
  });

  it('works under /shore on the game host too', async () => {
    const res = await root.request('/shore/items/lighthouse');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Lighthouse');
  });

  it('lists the catalog in the sitemap', async () => {
    const res = await onShore('/sitemap.xml');
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('https://beechshore.com/items');
    expect(xml).toContain('https://beechshore.com/items/lighthouse');
  });
});

describe('item votes', () => {
  it('needs a connected account, toggles one vote per person, and counts', async () => {
    expect((await json('/items/lighthouse/vote', 'POST')).status).toBe(401);
    expect((await json('/items/lighthouse/vote', 'GET')).status).toBe(401);
    const ana = await user('Ana');
    const bob = await user('Bob');
    expect((await json('/items/nope/vote', 'POST', ana.scoped)).status).toBe(404);

    let r = await json('/items/lighthouse/vote', 'POST', ana.scoped);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ voted: true, votes: 1 });
    r = await json('/items/lighthouse/vote', 'GET', ana.scoped);
    expect(await r.json()).toEqual({ voted: true, votes: 1 });
    r = await json('/items/lighthouse/vote', 'POST', bob.scoped);
    expect(await r.json()).toEqual({ voted: true, votes: 2 });
    r = await json('/items/lighthouse/vote', 'POST', ana.scoped);
    expect(await r.json()).toEqual({ voted: false, votes: 1 });
    r = await json('/items/lighthouse/vote', 'GET', bob.scoped);
    expect(await r.json()).toEqual({ voted: true, votes: 1 });

    const index = await (await onShore('/items')).text();
    expect(index).toContain('★ 1');
  });
});

describe('item comments', () => {
  it('needs a connected account, posts and lists, and only the author can delete', async () => {
    expect((await json('/items/lighthouse/comments', 'POST', undefined, { text: 'hi' })).status).toBe(401);
    const ana = await user('Ana');
    const bob = await user('Bob');
    expect((await json('/items/nope/comments', 'POST', ana.scoped, { text: 'hi' })).status).toBe(404);
    expect((await json('/items/lighthouse/comments', 'POST', ana.scoped, { text: '   ' })).status).toBe(400);
    expect((await json('/items/lighthouse/comments', 'POST', ana.scoped, { text: 'x'.repeat(1001) })).status).toBe(400);

    const posted = await json('/items/lighthouse/comments', 'POST', ana.scoped, { text: 'I’d build a harbour around it.' });
    expect(posted.status).toBe(201);
    const { comment } = (await posted.json()) as { comment: { id: string; name: string; body: string } };
    expect(comment.name).toBe('Ana');
    expect(comment.body).toBe('I’d build a harbour around it.');

    const page = await (await onShore('/items/lighthouse')).text();
    expect(page).toContain('I’d build a harbour around it.');
    expect(page).toContain('Ana');

    expect((await json(`/items/lighthouse/comments/${comment.id}`, 'DELETE', bob.scoped)).status).toBe(404);
    const gone = await json(`/items/lighthouse/comments/${comment.id}`, 'DELETE', ana.scoped);
    expect(gone.status).toBe(200);
    expect((await json(`/items/lighthouse/comments/${comment.id}`, 'DELETE', ana.scoped)).status).toBe(404);
    expect(await (await onShore('/items/lighthouse')).text()).not.toContain('I’d build a harbour around it.');
  });
});

describe('guide link', () => {
  it('the guide links out to the item catalog', async () => {
    const res = await root.request('/guide');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Item catalog');
    expect(html).toContain('https://beechshore.com/items');
  });
});
