// beechshore.com (src/shoreSite.ts): public pages for every beach on the
// shore, nothing about beaches kept off it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { createRootApp } from '../src/rootApp.js';
import { ago, beachTitle, shareText } from '../src/shoreSite.js';
import { openTestDb } from './testDb.js';

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
  db = await openTestDb();
  const api = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true });
  publicDir = fs.mkdtempSync(path.join(process.cwd(), 'test', '.tmp-shore-'));
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><html><head><title>beech</title></head><body>beech-spa-marker</body></html>');
  root = createRootApp(db, api, publicDir, {
    shore: {
      hosts: ['beechshore.com', 'www.beechshore.com'],
      url: 'https://beechshore.com',
      gameUrl: 'https://play.example.test',
    },
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
    const edit = ((await (await call('/edit-session', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).json()) as { token: string }).token;
    const { beaches } = (await (await call('/beaches/mine', {}, token)).json()) as { beaches: { id: string; code: string }[] };
    const b = beaches[0];
    if (save)
      expect(
        (await call('/beach', { method: 'PUT', body: savedBeach() as BodyInit, headers: { 'Content-Type': 'application/octet-stream', 'X-Beach-Location': 'waikiki', 'X-Beach-Nx': '64', 'X-Beach-Ny': '64', 'X-Edit-Token': edit } }, token)).status,
      ).toBe(200);
    if (!onShore) await db.query('UPDATE beach SET on_shore = false WHERE id = $1', [b.id]);
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
      // the footer links the Discord invite (server/src/community.ts —
      // the server's permanent invite)
      expect(html).toContain('href="https://discord.gg/y7EGw2yg2d"');
      expect(html).toContain('>Discord</a>');
    }
    const own = await (await root.request('/', shoreHost)).text();
    expect(own).toContain('<link rel="canonical" href="https://beechshore.com/">');
    expect(own).toContain(`href="/${people.Ana.code}"`);
    const under = await (await root.request('/shore')).text();
    expect(under).toContain('<link rel="canonical" href="https://beechshore.com/">');
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

  it('a beach page offers a copy, and shows how often it was copied and where a copy came from', async () => {
    const page = async (code: string) => (await root.request(`/${code}`, shoreHost)).text();
    expect(await page(people.Ana.code)).toContain(`https://play.example.test/?visit=${people.Ana.code}&amp;copy=1`);
    // Dee and Eve copied Ana's beach (Eve twice: counted once); Dee's is the copy
    await db.query('INSERT INTO beach_copies (source_beach, copier, first_at) VALUES ($1, $2, 1), ($1, $3, 2)', [
      people.Ana.beachId,
      people.Dee.beachId,
      people['<b>Eve</b>'].beachId,
    ]);
    await db.query('UPDATE beach SET copied_from = $1 WHERE id = $2', [people.Ana.beachId, people.Dee.beachId]);
    expect(await page(people.Ana.code)).toContain('copied 2 times');
    const dee = await page(people.Dee.code);
    expect(dee).toContain(`Copied from <a href="/${people.Ana.code}">`);
    // a copy of a beach that has left the shore doesn't link to it
    await db.query('UPDATE beach SET copied_from = $1 WHERE id = $2', [people.Bob.beachId, people.Dee.beachId]);
    expect(await page(people.Dee.code)).not.toContain('Copied from');
    await db.query('UPDATE beach SET copied_from = NULL WHERE id = $1', [people.Dee.beachId]);
    await db.query('DELETE FROM beach_copies WHERE source_beach = $1', [people.Ana.beachId]);
  });

  it('tiles touch edge to edge: no gap between beach cards', async () => {
    // the grid (home, lists, by place) and the "Along the shore" strip on a
    // beach page both render contiguously; the stylesheet is shared, so one
    // page's <style> covers both, but check both pages serve it.
    const rule = (css: string, sel: string) => {
      const m = css.match(new RegExp(`\\${sel}\\{[^}]*\\}`));
      expect(m, `${sel} rule present`).not.toBeNull();
      return m![0];
    };
    for (const r of [await root.request('/', shoreHost), await root.request(`/shore/${people.Ana.code}`)]) {
      expect(r.status).toBe(200);
      const style = (await r.text()).match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
      expect(style).not.toBe('');
      expect(rule(style, '.grid')).toContain('gap:0');
      expect(rule(style, '.strip')).toContain('gap:0');
      expect(rule(style, '.grid')).not.toMatch(/gap:(12|16)px/);
      expect(rule(style, '.strip')).not.toMatch(/gap:(12|16)px/);
      // gaps that are not between beach tiles stay as they were
      expect(rule(style, '.top')).toContain('gap:16px');
      expect(rule(style, '.chips')).toContain('gap:8px');
    }
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

  it('draws the 3D views: land and ocean iso images, cached with the neighbour save times', async () => {
    const page = await (await root.request(`/shore/${people.Ana.code}`)).text();
    // the page offers a three-way Flat / 3D / From the sea switch on the hero picture…
    expect(page).toContain('data-view-toggle');
    expect(page).toContain('>Flat<');
    expect(page).toContain('>3D<');
    expect(page).toContain('>From the sea<');
    // …while the share image stays the top-down card
    expect(page).toContain(`<meta property="og:image" content="http://localhost/shore/img/${people.Ana.code}.png?v=`);
    for (const kind of ['iso', 'iso-ocean'] as const) {
      const src = page.match(new RegExp(`data-${kind === 'iso' ? 'iso' : 'ocean'}="([^"]*?\\/img\\/[A-Z0-9]{6}\\/${kind}\\.png\\?v=[^"]+)"`))![1];
      const res = await root.request(src);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('Cache-Control')).toContain('immutable');
      const png = new Uint8Array(await res.arrayBuffer());
      expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
      const dv = new DataView(png.buffer);
      expect(dv.getUint32(16)).toBe(1200);
      expect(dv.getUint32(20)).toBe(630);
      const again = await root.request(src, { headers: { 'If-None-Match': res.headers.get('ETag')! } });
      expect(again.status).toBe(304);
      // hidden and unsaved beaches have no 3D view either
      expect((await root.request(`/shore/img/${people.Bob.code}/${kind}.png`)).status).toBe(404);
      expect((await root.request(`/shore/img/${people.Cy.code}/${kind}.png`)).status).toBe(404);
    }
  });

  it('only ever shows a public neighbour in the 3D views', async () => {
    const eve = people['<b>Eve</b>'];
    try {
      // Link Ana's left side to Dee, a public beach with a mound.
      await db.query('INSERT INTO neighbors (beach_id, side, neighbor_beach_id, created_at) VALUES ($1, $2, $3, $4)', [
        people.Ana.beachId,
        'left',
        people.Dee.beachId,
        Date.now(),
      ]);
      for (const kind of ['iso', 'iso-ocean'] as const) {
        const url = `/shore/img/${people.Ana.code}/${kind}.png`;
        const withDee = new Uint8Array(await (await root.request(url)).arrayBuffer());
        // Take Dee — and Eve, the next public beach past her — off the shore:
        // the walk past Dee must find no public beach, so Ana's 3D view goes
        // back to untouched shore on that side. Dee's sand never appears.
        await db.query('UPDATE beach SET on_shore = false WHERE id IN ($1, $2)', [people.Dee.beachId, eve.beachId]);
        const withoutDee = new Uint8Array(await (await root.request(url)).arrayBuffer());
        expect(Buffer.from(withDee).equals(Buffer.from(withoutDee))).toBe(false);
        // And it is the same picture as if Dee had never been linked at all.
        await db.query('DELETE FROM neighbors WHERE beach_id = $1', [people.Ana.beachId]);
        const neverLinked = new Uint8Array(await (await root.request(url)).arrayBuffer());
        expect(Buffer.from(withoutDee).equals(Buffer.from(neverLinked))).toBe(true);
        // Put Dee back for the next view.
        await db.query('UPDATE beach SET on_shore = true WHERE id IN ($1, $2)', [people.Dee.beachId, eve.beachId]);
        await db.query('INSERT INTO neighbors (beach_id, side, neighbor_beach_id, created_at) VALUES ($1, $2, $3, $4)', [
          people.Ana.beachId,
          'left',
          people.Dee.beachId,
          Date.now(),
        ]);
      }
    } finally {
      await db.query('UPDATE beach SET on_shore = true WHERE id IN ($1, $2)', [people.Dee.beachId, eve.beachId]);
      await db.query('DELETE FROM neighbors WHERE beach_id = $1', [people.Ana.beachId]);
    }
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
    const robots = await (await root.request('/robots.txt', shoreHost)).text();
    expect(robots).toContain('Sitemap: https://beechshore.com/sitemap.xml');
    expect(robots).not.toContain('Disallow: /find');
    const response = await root.request('/sitemap.xml', shoreHost);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/xml');
    const map = await response.text();
    expect(await (await root.request('/shore/sitemap.xml')).text()).toBe(map);
    expect(map).toContain(`<loc>https://beechshore.com/${people.Ana.code}</loc>`);
    expect(map).toContain('<loc>https://beechshore.com/submit/spec</loc>');
    expect(map).not.toContain('/submit/connect');
    expect(map).not.toContain(people.Bob.code);
    expect(map).not.toContain(people.Cy.code);
    expect((await root.request('/shore/submit/connect')).headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it('gives populated listing pages their own canonical URL and returns 404 past the end', async () => {
    await db.query(`
      INSERT INTO beach (id, owner_id, code, location, sand, created_at)
      SELECT gen_random_uuid(), owner_id, 'TST' || LPAD(n::text, 3, '0'), location, sand, created_at
      FROM beach CROSS JOIN generate_series(1, 24) AS n
      WHERE id = $1
    `, [people.Ana.beachId]);
    try {
      for (const path of ['/top', '/at/waikiki']) {
        for (const [prefix, init] of [['', shoreHost], ['/shore', {}]] as const) {
          const r = await root.request(`${prefix}${path}?page=2&utm_source=test`, init);
          expect(r.status).toBe(200);
          expect(await r.text()).toContain(`<link rel="canonical" href="https://beechshore.com${path}?page=2">`);
          expect((await root.request(`${prefix}${path}?page=3`, init)).status).toBe(404);
        }
      }
    } finally {
      await db.query("DELETE FROM beach WHERE code ~ '^TST0(0[1-9]|1[0-9]|2[0-4])$'");
    }
  });

  it('rate-limits uncached image draws per IP while keeping cache hits free', async () => {
    const app = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true });
    const limited = createRootApp(db, app, '/no-public-dir', {
      shore: { hosts: ['beechshore.com', 'www.beechshore.com'], url: 'https://beechshore.com', gameUrl: 'https://play.example.test', imageDrawsPerMinute: 2 },
    });
    const ip1 = { headers: { 'X-Forwarded-For': '203.0.113.10' } };
    const ip2 = { headers: { 'X-Forwarded-For': '203.0.113.11' } };
    // two uncached draws succeed
    expect((await limited.request(`/shore/img/${people.Ana.code}/thumb.png`, ip1)).status).toBe(200);
    expect((await limited.request(`/shore/img/${people.Dee.code}/thumb.png`, ip1)).status).toBe(200);
    // cache hit is not rate-limited
    expect((await limited.request(`/shore/img/${people.Ana.code}/thumb.png`, ip1)).status).toBe(200);
    // third uncached draw from the same IP is 429 with Retry-After
    const blocked = await limited.request(`/shore/img/${people['<b>Eve</b>'].code}/thumb.png`, ip1);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('60');
    // another IP still draws fine
    expect((await limited.request(`/shore/img/${people['<b>Eve</b>'].code}/thumb.png`, ip2)).status).toBe(200);
  });

  it('serves public beaches read-only without sign-in, and hides off-shore and unsaved ones', async () => {
    const r = await root.request(`/api/public/shore?code=${people.Ana.code}&depth=6`);
    expect(r.status).toBe(200);
    const shore = (await r.json()) as { center: { code: string; you: boolean }; left: { code: string }[]; right: { code: string }[] };
    expect(shore.center).toMatchObject({ code: people.Ana.code, you: false });
    const seen = [shore.center.code, ...shore.left.map((b) => b.code), ...shore.right.map((b) => b.code)];
    expect(seen).toContain(people.Dee.code);
    expect(seen).not.toContain(people.Bob.code); // off-shore
    expect(seen).not.toContain(people.Cy.code); // unsaved

    const more = await root.request(`/api/public/shore/more?from=${people.Ana.code}&dir=left&count=6`);
    expect(more.status).toBe(200);
    const moreCodes = ((await more.json()) as { beaches: { code: string }[] }).beaches.map((b) => b.code);
    expect(moreCodes).not.toContain(people.Bob.code);
    expect(moreCodes).not.toContain(people.Cy.code);
    expect((await root.request(`/api/public/shore/more?from=${people.Ana.code}&dir=up`)).status).toBe(400);

    const sand = await root.request(`/api/public/beaches/${people.Ana.code}`);
    expect(sand.status).toBe(200);
    expect(sand.headers.get('X-Beach-Location')).toBe('waikiki');
    expect((await sand.arrayBuffer()).byteLength).toBeGreaterThan(8);

    // off-shore, unsaved and missing codes are all 404 (no existence leak)
    for (const code of [people.Bob.code, people.Cy.code, 'ZZZZZZ', '']) {
      expect((await root.request(`/api/public/shore?code=${code}`)).status).toBe(404);
      if (code) {
        expect((await root.request(`/api/public/shore/more?from=${code}&dir=left`)).status).toBe(404);
        expect((await root.request(`/api/public/beaches/${code}`)).status).toBe(404);
      }
    }
  });

  it('serves public shore sections around an empty beach when no code is given', async () => {
    const r = await root.request('/api/public/shore?depth=6');
    expect(r.status).toBe(200);
    const shore = (await r.json()) as {
      center: null;
      left: { code: string; linked: boolean }[];
      right: { code: string; linked: boolean }[];
    };
    expect(shore.center).toBeNull();
    expect(shore.left.length).toBeGreaterThan(0);
    expect(shore.right.length).toBeGreaterThan(0);
    // inner edges sit across the diorama gap from the signed-out player's empty beach
    expect(shore.left[0].linked).toBe(false);
    expect(shore.right[0].linked).toBe(false);
    const codes = [...shore.left.map((b) => b.code), ...shore.right.map((b) => b.code)];
    expect(new Set(codes).size).toBe(codes.length); // no duplicates
    expect(codes).toContain(people.Ana.code);
    expect(codes).toContain(people.Dee.code);
    expect(codes).not.toContain(people.Bob.code); // off-shore
    expect(codes).not.toContain(people.Cy.code); // unsaved

    const zero = await root.request('/api/public/shore?depth=0');
    expect(zero.status).toBe(200);
    expect(await zero.json()).toEqual({ center: null, left: [], right: [] });
  });

  it('creates partial indexes for public shore lists', async () => {
    const idx = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'beach' AND indexname IN ('beach_public_updated', 'beach_public_location') ORDER BY indexname`,
    );
    expect(idx.map((r) => r.indexname)).toEqual(['beach_public_location', 'beach_public_updated']);
  });

  it('beach page includes the social share & snapshot postcard studio and full OG/Twitter image tags', async () => {
    const r = await root.request(`/${people.Ana.code}`, shoreHost);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('id="share"');
    expect(html).toContain('data-fmt="postcard"');
    expect(html).toContain('data-fmt="square"');
    expect(html).toContain('data-fmt="story"');
    expect(html).toContain('data-fmt="clean"');
    expect(html).toContain('data-share-snap');
    expect(html).toContain('data-copy-img');
    expect(html).toContain('data-download-snap');
    expect(html).toContain('bsky.app/intent/compose');
    expect(html).toContain('threads.net/intent/post');
    expect(html).toContain('reddit.com/submit');
    expect(html).toContain('<meta property="og:image:type" content="image/png">');
    expect(html).toContain('<meta name="twitter:image:alt" content="Ana’s beach, seen from above">');
  });

  it('finds beaches by 6-letter code (redirect) or public name, never leaking hidden or unsaved ones', async () => {
    // 6-letter code jumps straight to the canonical beach page (forgiving case and dashes)
    const lower = people.Ana.code.toLowerCase();
    const byCode = await root.request(`/find?q=${lower.slice(0, 3)}-${lower.slice(3)}`, shoreHost);
    expect(byCode.status).toBe(302);
    expect(byCode.headers.get('Location')).toBe(`/${people.Ana.code}`);

    // name search finds public beaches only
    const byName = await root.request('/find?q=ana', shoreHost);
    expect(byName.headers.get('X-Robots-Tag')).toBe('noindex');
    expect(byName.status).toBe(200);
    const anaHtml = await byName.text();
    expect(anaHtml).toContain(people.Ana.code);
    expect(anaHtml).not.toContain(people.Bob.code);

    // off-shore (Bob) and unsaved (Cy) never appear in name search
    for (const hidden of ['Bob', 'Cy']) {
      const r = await root.request(`/find?q=${hidden}`, shoreHost);
      expect(r.status).toBe(200);
      const html = await r.text();
      expect(html).not.toContain(people[hidden].code);
      expect(html).toContain('No beaches on the shore match');
    }

    // hostile query is escaped
    const xss = await root.request(`/find?q=${encodeURIComponent('<script>alert(1)</script>')}`, shoreHost);
    expect(xss.status).toBe(200);
    const xssHtml = await xss.text();
    expect(xssHtml).not.toContain('<script>alert(1)</script>');
    expect(xssHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
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

describe('piers on the shore site (docs/PIERS.md)', () => {
  it('draws a showing pier, and its picture URLs change when it comes and goes', async () => {
    const ana = people.Ana;
    // two more of Ana's beaches either side of hers (kept off the shore, so
    // the pages around them don't change), and a pier on hers
    const sides: string[] = [];
    for (const [i, side] of (['left', 'right'] as const).entries()) {
      const id = crypto.randomUUID();
      await db.query(`INSERT INTO beach (id, owner_id, code, name, home, on_shore, created_at) VALUES ($1, $2, $3, '', false, false, $4)`, [
        id, ana.beachId, `PIER${i}${i}`, Date.now(),
      ]);
      const other = side === 'left' ? 'right' : 'left';
      await db.query('INSERT INTO neighbors (beach_id, side, neighbor_beach_id, created_at) VALUES ($1, $2, $3, 0), ($3, $4, $1, 0)', [ana.beachId, side, id, other]);
      sides.push(id);
    }
    const page = async () => (await root.request(`/${ana.code}`, shoreHost)).text();
    const thumbUrl = (html: string) => html.match(new RegExp(`/img/${ana.code}/thumb\\.png\\?v=([0-9a-z]+)`))![1];
    const isoUrl = (html: string) => html.match(new RegExp(`/img/${ana.code}/iso\\.png\\?v=([0-9a-z.]+)`))![1];
    const before = await page();
    expect(thumbUrl(before)).not.toMatch(/p$/);
    const plainThumb = Buffer.from(await (await root.request(`/img/${ana.code}/thumb.png?v=${thumbUrl(before)}`, shoreHost)).arrayBuffer());
    const plainIso = Buffer.from(await (await root.request(`/img/${ana.code}/iso.png?v=${isoUrl(before)}`, shoreHost)).arrayBuffer());

    await db.query('INSERT INTO beach_piers (beach_id, owner_id, placed_at) VALUES ($1, $1, 0)', [ana.beachId]);
    const after = await page();
    expect(thumbUrl(after)).toBe(`${thumbUrl(before)}p`);
    expect(isoUrl(after)).not.toBe(isoUrl(before));
    for (const [kind, plain, v] of [['thumb', plainThumb, thumbUrl(after)], ['iso', plainIso, isoUrl(after)]] as const) {
      const r = await root.request(`/img/${ana.code}/${kind}.png?v=${v}`, shoreHost);
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toContain('immutable');
      expect(Buffer.from(await r.arrayBuffer()).equals(plain), `${kind} draws the pier`).toBe(false);
    }
    // the link preview's image moves on too
    expect(await (await root.request(`/${ana.code}`, shoreHost)).text()).toContain(`/img/${ana.code}.png?v=${thumbUrl(after)}`);

    // a broken link pauses it: the pictures go back to the plain ones
    await db.query("DELETE FROM neighbors WHERE beach_id = $1 AND side = 'right' OR neighbor_beach_id = $1 AND side = 'left'", [ana.beachId]);
    expect(thumbUrl(await page())).toBe(thumbUrl(before));

    await db.query('DELETE FROM beach WHERE id = ANY($1::uuid[])', [sides]);
    expect(await db.query('SELECT 1 FROM beach_piers WHERE beach_id = $1', [ana.beachId])).toHaveLength(1);
    await db.query('DELETE FROM beach_piers WHERE beach_id = $1', [ana.beachId]);
  });

  it('navigation groups beaches, items and account cleanly with active states and section tabs', async () => {
    const headerNav = (html: string) => html.match(/<header class="top">([\s\S]*?)<\/header>/)?.[1] ?? '';
    const mobNav = (html: string) => html.match(/<nav class="mob-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';

    const home = await (await root.request('/', shoreHost)).text();
    const h = headerNav(home);
    expect(h).toContain('href="/top">Beaches</a>');
    expect(h).toContain('href="/items">Items</a>');
    expect(h).not.toContain('Surprise me');
    expect(h).toContain('class="acct-link" href="/account"');
    expect(h.indexOf('Beaches')).toBeLessThan(h.indexOf('Items'));
    expect(h.indexOf('Items')).toBeLessThan(h.indexOf('Account'));
    expect(mobNav(home)).toContain('href="/account"');

    for (const p of ['/top', '/rising', '/new', '/at/waikiki', '/find', `/${people.Ana.code}`]) {
      const page = await (await root.request(p, shoreHost)).text();
      expect(headerNav(page), p).toContain('href="/top" aria-current="page">Beaches</a>');
    }

    const top = await (await root.request('/top', shoreHost)).text();
    expect(top).toContain('<a href="/random" rel="nofollow">Surprise me</a>');

    const items = await (await root.request('/items', shoreHost)).text();
    expect(headerNav(items)).toContain('href="/items" aria-current="page">Items</a>');
    expect(items).toContain('<div class="tabs"><a href="/items" aria-current="page">All items</a><a href="/submit">Submit an item</a><a href="/submit/spec">Asset spec</a></div>');

    const submit = await (await root.request('/submit', shoreHost)).text();
    expect(headerNav(submit)).toContain('href="/items" aria-current="page">Items</a>');
    expect(submit).toContain('<a href="/submit" aria-current="page">Submit an item</a><a href="/submit/spec">Asset spec</a>');

    const spec = await (await root.request('/submit/spec', shoreHost)).text();
    expect(headerNav(spec)).toContain('href="/items" aria-current="page">Items</a>');
    expect(spec).toContain('<a href="/submit/spec" aria-current="page">Asset spec</a>');

    const account = await (await root.request('/account', shoreHost)).text();
    expect(headerNav(account)).toContain('class="acct-link" href="/account" aria-current="page"');
    expect(mobNav(account)).toContain('href="/account" aria-current="page"');
  });
});
