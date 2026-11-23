// beechshore.com (src/shoreSite.ts): public pages for every beach on the
// shore, nothing about beaches kept off it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { createApp } from '../src/app.js';
import { createPgDb, createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { createRootApp } from '../src/rootApp.js';
import { ago, beachTitle, shareText } from '../src/shoreSite.js';

let db: Db;
let root: ReturnType<typeof createRootApp>;
let publicDir: string;
const people: Record<string, { token: string; code: string; beachId: string }> = {};

/** an untouched 64×64 beach with a 30 cm mound, as the app saves it (BCH1) */
function savedBeach(): Uint8Array {
  const nx = 64;
  const q = new Int16Array(nx * nx);
  for (let j = 40; j < 48; j++) for (let i = 28; i < 36; i++) q[j * nx + i] = 300;
  const z = deflateSync(Buffer.from(q.buffer));
  const out = new Uint8Array(8 + z.length);
  out.set([0x42, 0x43, 0x48, 0x31], 0);
  new DataView(out.buffer).setUint16(4, nx, true);
  new DataView(out.buffer).setUint16(6, nx, true);
  out.set(z, 8);
  return out;
}

const shoreHost = { headers: { Host: 'beechshore.com' } };

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL) {
    db = createPgDb({ url: process.env.TEST_DATABASE_URL });
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } else {
    db = await createPgliteDb();
  }
  await migrate(db);
  const api = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true });
  publicDir = fs.mkdtempSync(path.join(process.cwd(), 'test', '.tmp-shore-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><html><head><title>beech</title></head><body>beech-spa-marker</body></html>');
  root = createRootApp(db, api, publicDir, {
    hosts: ['beechshore.com', 'www.beechshore.com'],
    url: 'https://beechshore.com',
    gameUrl: 'https://play.example.test',
  });
  const call = (p: string, init: RequestInit = {}, token?: string) =>
    root.request(`/api${p}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  for (const [name, save, onShore] of [
    ['Ana', true, true],
    ['Bob', true, false],
    ['Cy', false, true],
    ['Dee', true, true],
    ['<b>Eve</b>', true, true],
  ] as const) {
    const { token } = (await (await call('/auth/dev', { method: 'POST', body: JSON.stringify({ name }) })).json()) as { token: string };
    const { beaches } = (await (await call('/beaches/mine', {}, token)).json()) as { beaches: { id: string; code: string }[] };
    const b = beaches[0];
    if (save)
      expect(
        (await call('/beach', { method: 'PUT', body: savedBeach() as BodyInit, headers: { 'Content-Type': 'application/octet-stream', 'X-Beach-Location': 'waikiki', 'X-Beach-Nx': '64', 'X-Beach-Ny': '64' } }, token)).status,
      ).toBe(200);
    if (!onShore) expect((await call(`/beaches/mine/${b.id}`, { method: 'PATCH', body: JSON.stringify({ onShore: false }) }, token)).status).toBe(200);
    people[name] = { token, code: b.code, beachId: b.id };
  }
  // Dee stars Ana
  expect((await call(`/favorites/${people.Ana.code}`, { method: 'PUT' }, people.Dee.token)).status).toBeLessThan(300);
});

afterAll(async () => {
  await db.close();
  fs.rmSync(publicDir, { recursive: true, force: true });
});

describe('the shore site', () => {
  it('home lists public beaches only, on its own host and under /shore', async () => {
    for (const r of [await root.request('/', shoreHost), await root.request('/shore')]) {
      expect(r.status).toBe(200);
      const html = await r.text();
      expect(html).toContain('Every beach on the shore');
      expect(html).toContain(people.Ana.code);
      expect(html).toContain(people.Dee.code);
      expect(html).not.toContain(people.Bob.code); // off the shore
      expect(html).not.toContain(people.Cy.code); // never saved
      expect(html).toContain('Most loved');
      expect(html).toContain('https://play.example.test/');
    }
    const own = await (await root.request('/', shoreHost)).text();
    expect(own).toContain('<link rel="canonical" href="https://beechshore.com/">');
    expect(own).toContain(`href="/${people.Ana.code}"`);
    const under = await (await root.request('/shore')).text();
    expect(under).toContain(`href="/shore/${people.Ana.code}"`);
  });

  it('www goes to the one canonical host', async () => {
    const r = await root.request('/top?page=2', { headers: { Host: 'www.beechshore.com' } });
    expect(r.status).toBe(301);
    expect(r.headers.get('Location')).toBe('https://beechshore.com/top?page=2');
  });

  it('the game host still serves the game and its API', async () => {
    expect(await (await root.request('/')).text()).toContain('beech-spa-marker');
    expect((await root.request('/api/health')).status).toBe(200);
    // the shore's own host never serves the game API
    expect((await root.request('/api/health', shoreHost)).status).toBe(404);
  });

  it('a beach page: picture, preview tags, visit link, share links, the shore around it', async () => {
    const r = await root.request(`/${people.Ana.code}`, shoreHost);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('Ana’s beach');
    expect(html).toContain(`<meta property="og:image" content="https://beechshore.com/img/${people.Ana.code}.png?v=`);
    expect(html).toContain('summary_large_image');
    expect(html).toContain(`href="https://play.example.test/?visit=${people.Ana.code}"`);
    expect(html).toContain('sms:?&amp;body=');
    expect(html).toContain('wa.me');
    expect(html).toContain(encodeURIComponent(`https://beechshore.com/${people.Ana.code}`));
    expect(html).toContain('★ 1 star');
    expect(html).toContain('Waikīkī, Honolulu');
    expect(html).toContain('Along the shore');
    expect(html).toContain(`/${people.Dee.code}`);
    expect(html).not.toContain(people.Bob.code);
  });

  it('codes are forgiving, and the short link is canonical', async () => {
    const r = await root.request(`/${people.Ana.code.toLowerCase()}`, shoreHost);
    expect(r.status).toBe(301);
    expect(r.headers.get('Location')).toBe(`/${people.Ana.code}`);
  });

  it('shows nothing of hidden or unsaved beaches; their links go on to the game', async () => {
    for (const code of [people.Bob.code, people.Cy.code, 'ZZZZZZ']) {
      const r = await root.request(`/shore/${code}`);
      if (code === 'ZZZZZZ') {
        expect(r.status).toBe(404);
        expect(await r.text()).toContain('Washed away');
      } else {
        // its owner may have shared it: the game shows it to signed-in people
        expect(r.status).toBe(302);
        expect(r.headers.get('Location')).toBe(`https://play.example.test/?visit=${code}`);
      }
      expect((await root.request(`/shore/img/${code}.png`)).status).toBe(404);
      expect((await root.request(`/shore/img/${code}/thumb.png`)).status).toBe(404);
    }
    expect((await root.request('/shore/no/such/page')).status).toBe(404);
  });

  it('names are escaped everywhere', async () => {
    const html = await (await root.request(`/shore/${people['<b>Eve</b>'].code}`)).text();
    expect(html).not.toContain('<b>Eve</b>');
    expect(html).toContain('&lt;b&gt;Eve&lt;/b&gt;');
    expect(await (await root.request('/shore/new')).text()).not.toContain('<b>Eve</b>');
  });

  it('draws pictures: the card, the thumbnail, the site card; cached for good with the save time', async () => {
    const page = await (await root.request(`/shore/${people.Ana.code}`)).text();
    const src = page.match(/og:image" content="[^"]*?(\/shore\/img\/[A-Z0-9]{6}\.png\?v=\d+)"/)![1];
    const card = await root.request(src);
    expect(card.status).toBe(200);
    expect(card.headers.get('Content-Type')).toBe('image/png');
    expect(card.headers.get('Cache-Control')).toContain('immutable');
    const png = new Uint8Array(await card.arrayBuffer());
    expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect(new DataView(png.buffer).getUint32(16)).toBe(1200);
    const again = await root.request(src, { headers: { 'If-None-Match': card.headers.get('ETag')! } });
    expect(again.status).toBe(304);
    const thumb = await root.request(`/shore/img/${people.Ana.code}/thumb.png`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('Cache-Control')).not.toContain('immutable');
    expect((await root.request('/img/shore.png', shoreHost)).status).toBe(200);
  });

  it('lists, places, random, robots and the sitemap', async () => {
    const top = await (await root.request('/shore/top')).text();
    expect(top.indexOf(people.Ana.code)).toBeLessThan(top.indexOf(people.Dee.code)); // a star beats none
    expect(await (await root.request('/shore/rising')).text()).toContain(people.Ana.code);
    expect(await (await root.request('/shore/at/waikiki')).text()).toContain(people.Dee.code);
    expect((await root.request('/shore/at/atlantis')).status).toBe(404);
    const rnd = await root.request('/random', shoreHost);
    expect(rnd.status).toBe(302);
    expect(rnd.headers.get('Location')).toMatch(/^\/[A-Z0-9]{6}$/);
    expect([people.Ana.code, people.Dee.code, people['<b>Eve</b>'].code]).toContain(rnd.headers.get('Location')!.slice(1));
    expect(await (await root.request('/robots.txt', shoreHost)).text()).toContain('Sitemap: https://beechshore.com/sitemap.xml');
    const map = await (await root.request('/sitemap.xml', shoreHost)).text();
    expect(map).toContain(`<loc>https://beechshore.com/${people.Ana.code}</loc>`);
    expect(map).not.toContain(people.Bob.code);
  });
});

describe('shore site helpers', () => {
  it('names a beach', () => {
    expect(beachTitle({ name: 'Ana' })).toBe('Ana’s beach');
    expect(beachTitle({ name: 'Ana', beachName: 'Moat Town' })).toBe('Moat Town');
    expect(beachTitle({ name: '' })).toBe('Someone’s beach');
    expect(shareText({ name: 'Ana' })).toContain('Ana’s beach');
    expect(shareText(null).length).toBeLessThan(120);
  });
  it('says how long ago', () => {
    const now = Date.UTC(2026, 10, 23, 12);
    expect(ago(now - 30e3, now)).toBe('just now');
    expect(ago(now - 5 * 60e3, now)).toBe('5 min ago');
    expect(ago(now - 3 * 3600e3, now)).toBe('3 h ago');
    expect(ago(now - 2 * 86400e3, now)).toBe('2 days ago');
    expect(ago(Date.UTC(2026, 2, 4), now)).toBe('on 4 Mar 2026');
    expect(ago(null, now)).toBe('');
  });
});
