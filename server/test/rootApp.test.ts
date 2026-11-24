import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createRootApp } from '../src/rootApp.js';
import { createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';

// The root app (game API under /api + the web app) used to serve the SPA's
// index.html for ANY unmatched GET, including unknown /api paths — so the
// deploy smoke test's `GET /api/admin/me` got 200 instead of 404.

let db: Db;
let root: ReturnType<typeof createRootApp>;
let publicDir: string;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db);
  const api = createApp(db, {
    googleClientIds: ['web'],
    appleClientIds: [],
    allowedOrigins: ['capacitor://localhost'],
    devAuth: true,
  });
  publicDir = fs.mkdtempSync(path.join(process.cwd(), 'test', '.tmp-root-'));
  fs.writeFileSync(
    path.join(publicDir, 'index.html'),
    '<!doctype html><html><head><title>beech</title></head><body>beech-spa-marker</body></html>',
  );
  fs.writeFileSync(
    path.join(publicDir, 'privacy.html'),
    '<!doctype html><html><head><title>Privacy Policy — beech</title></head><body>privacy-policy-marker</body></html>',
  );
  fs.writeFileSync(path.join(publicDir, 'hero-beach.jpg'), 'hero-beach-marker');
  fs.mkdirSync(path.join(publicDir, 'landing-assets'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'landing-assets', 'hero-day.webp'), 'landing-asset-marker');
  root = createRootApp(db, api, publicDir);
});

afterAll(async () => {
  await db.close();
  fs.rmSync(publicDir, { recursive: true, force: true });
});

describe('root app: unknown /api paths are JSON 404s, the SPA still serves', () => {
  it('the smoke-test case: GET /api/admin/me is a JSON 404, not the SPA', async () => {
    const r = await root.request('/api/admin/me');
    expect(r.status).toBe(404);
    expect(r.headers.get('Content-Type')).toContain('application/json');
    expect(await r.json()).toEqual({ error: 'not found' });
  });

  it('other unknown /api paths are JSON 404s too (any method)', async () => {
    for (const [path, init] of [
      ['/api/nope', {}],
      ['/api', {}],
      ['/api/nope', { method: 'POST' }],
    ] as const) {
      const r = await root.request(path, init);
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: 'not found' });
    }
  });

  it('real /api routes still work', async () => {
    expect((await root.request('/api/health')).status).toBe(200);
    expect((await (await root.request('/api/health')).json()) as unknown).toEqual({ ok: true });
    // a real route behind auth still enforces auth, not the 404 guard
    expect((await root.request('/api/me')).status).toBe(401);
  });

  it('the SPA still serves for / and for non-/api paths', async () => {
    for (const path of ['/', '/some/deep/route']) {
      const r = await root.request(path);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('beech-spa-marker');
    }
    expect((await root.request('/healthz')).status).toBe(200);
  });
});

describe('the guide and release notes', () => {
  it('serves the guide with the live odds, the claw rest and this week’s set', async () => {
    const r = await root.request('/guide');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-cache');
    const html = await r.text();
    expect(html).not.toContain('beech-spa-marker');
    for (const id of ['controls', 'claw', 'vending', 'checkpoints', 'shop', 'settings']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('between 5 minutes and 3 hours');
    expect(html).toMatch(/Common<\/td><td>70%<\/td><td>80%/);
    expect(html).toContain('Message in a bottle');
    expect(html).toContain('/guide/releases');
  });

  it('never gives away the starter gifts', async () => {
    const html = (await (await root.request('/guide')).text()).toLowerCase();
    expect(html).not.toMatch(/starter|first go|first goes/);
  });

  it('serves the release notes, newest first', async () => {
    const r = await root.request('/guide/releases');
    expect(r.status).toBe(200);
    const html = await r.text();
    const dates = [...html.matchAll(/<time datetime="([\d-]+)"/g)].map((m) => m[1]);
    expect(dates.length).toBeGreaterThan(0);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('/help and /releases point at the guide', async () => {
    expect((await root.request('/help')).headers.get('location')).toBe('/guide');
    expect((await root.request('/releases')).headers.get('location')).toBe('/guide/releases');
  });
});

describe('the landing page and host routing', () => {
  // Hono's test client sends no Host by default; pass one per request.
  const on = (path: string, host: string) => root.request(path, { headers: { host } });
  const hero = 'a quiet place by the sea';

  it('the landing host serves the landing page at / (and any path), not the game', async () => {
    for (const path of ['/', '/anything', '/guide/releases']) {
      const r = await on(path, 'beech.games');
      expect(r.status).toBe(200);
      const html = await r.text();
      if (path === '/guide/releases') {
        expect(html).toContain('release notes');
      } else {
        expect(html).toContain(hero);
        expect(html).toContain('Play now on web');
        expect(html).toContain('https://play.beech.games');
        expect(html).toContain('/guide');
      }
      expect(html).not.toContain('beech-spa-marker');
    }
  });

  it('www.beech.games 301s to the apex, keeping the path', async () => {
    const r = await on('/guide', 'www.beech.games');
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('https://beech.games/guide');
    expect((await on('/', 'www.beech.games')).headers.get('location')).toBe('https://beech.games/');
  });

  it('the game API is not served on a landing host', async () => {
    const r = await on('/api/health', 'beech.games');
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain(hero);
    expect(text).not.toContain('"ok":true');
  });

  it('/healthz still works on a landing host', async () => {
    expect((await on('/healthz', 'beech.games')).status).toBe(200);
  });

  it('/guide still works on a landing host', async () => {
    const r = await on('/guide', 'beech.games');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('id="claw"');
  });

  it('landing artwork under /landing-assets/ answers on a landing host', async () => {
    const r = await on('/landing-assets/hero-day.webp', 'beech.games');
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('landing-asset-marker');
  });

  it('the hero splash answers on a landing host, and the landing page shows it', async () => {
    const r = await on('/hero-beach.jpg', 'beech.games');
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toContain('image/jpeg');
    expect(await r.text()).toBe('hero-beach-marker');
    // and on the game host too — it is a static file, not a landing-only route
    expect((await root.request('/hero-beach.jpg')).status).toBe(200);
    const html = await (await on('/', 'beech.games')).text();
    expect(html).toContain('<img src="/hero-beach.jpg"');
    expect(html).toContain('https://beech.games/hero-beach.jpg');
    // the hero splash is full-bleed, not boxed in the centred column:
    // the img comes before the centred hero-inner, the hero has no side
    // padding, and the splash scales with the viewport via cover over a
    // viewport-relative height (zooming in/out with screen size)
    expect(html.indexOf('<img src="/hero-beach.jpg"')).toBeLessThan(html.indexOf('<div class="hero-inner">'));
    expect(html).toContain('padding: 0 0 104px;');
    expect(html).toContain('height: clamp(240px, 42vw, 640px);');
    expect(html).toContain('object-fit: cover;');
    expect(html).not.toContain('max-width: 1180px;\n  margin: 0 auto 40px;');
    // the time-of-day diorama is still there, lower on the page: after
    // What's new, before Where to play
    expect(html).toContain('id="diorama"');
    expect(html).toContain('data-set-mood');
    expect(html).toContain('hero-day.webp');
    expect(html).toContain('A beach that follows the day.');
    const updatesAt = html.indexOf('id="updates-heading"');
    const dioramaAt = html.indexOf('id="diorama"');
    const playAt = html.indexOf('id="play-heading"');
    expect(updatesAt).toBeGreaterThan(-1);
    expect(dioramaAt).toBeGreaterThan(updatesAt);
    expect(playAt).toBeGreaterThan(dioramaAt);
  });

  it('the privacy policy answers on a landing host, and /privacy redirects to it', async () => {
    const r = await on('/privacy.html', 'beech.games');
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('privacy-policy-marker');
    expect(html).not.toContain(hero);
    expect((await on('/privacy', 'beech.games')).headers.get('location')).toBe('/privacy.html');
    // and on the game host too — it is a static file, not a landing-only route
    expect(await (await root.request('/privacy.html')).text()).toContain('privacy-policy-marker');
    // the landing page links it in the footer
    expect(await (await root.request('/landing')).text()).toContain('href="/privacy.html"');
  });

  it('the landing page is previewable under /landing on the game host', async () => {
    const r = await root.request('/landing');
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain(hero);
    expect(html).toContain('What’s new');
    expect(html).toContain('/guide/releases');
    // the community section and the footer both link the Discord invite
    // (server/src/community.ts — the server's permanent invite)
    expect(html).toContain('Join our Discord');
    expect(html).toContain('href="https://discord.gg/y7EGw2yg2d"');
    expect(html).not.toContain('beech-spa-marker');
    expect((await root.request('/landing/')).headers.get('location')).toBe('/landing');
  });

  it('the game host still serves the game at /', async () => {
    const r = await on('/', 'play.beech.games');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('beech-spa-marker');
  });

  it('links Play now on web and Google Play, marks iOS coming soon, and never gives away starter gifts', async () => {
    const html = await (await root.request('/landing')).text();
    const lower = html.toLowerCase();
    expect(lower).not.toMatch(/starter|first go|first goes/);
    expect(html).toContain('Play now on web');
    expect(html).toContain('href="https://play.google.com/store/apps/details?id=app.beech.beach"');
    expect(html).toContain('Google Play');
    expect(lower).toContain('ios coming soon');
    expect(lower).not.toContain('apps.apple.com');
  });
});
