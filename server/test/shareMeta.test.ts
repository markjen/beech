import { Hono } from 'hono';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { type Db } from '../src/db.js';
import { createSharePageHandler, escapeHtml, injectShareMeta, shareMetaTags } from '../src/shareMeta.js';
import { openTestDb } from './testDb.js';

describe('share meta tags', () => {
  it('escapes a hostile name', () => {
    const tags = shareMetaTags({ name: `Ana"><script>alert(1)</script>`, url: 'https://beech.markjen.com/?visit=K7F2QX' });
    expect(tags).not.toContain('<script>');
    expect(tags).toContain('Ana&quot;&gt;&lt;script&gt;');
    expect(tags).toContain('og:title');
    expect(tags).toContain('https://beech.markjen.com/?visit=K7F2QX');
  });

  it('injects before </head>, and leaves a page without one alone', () => {
    const html = '<!doctype html><html><head><title>beech</title></head><body>x</body></html>';
    const out = injectShareMeta(html, shareMetaTags({ name: 'Ana', url: 'https://example.test/?visit=K7F2QX' }));
    expect(out.indexOf('og:title')).toBeGreaterThan(out.indexOf('<title>'));
    expect(out.indexOf('og:title')).toBeLessThan(out.indexOf('</head>'));
    expect(out).toContain('Visit Ana&#39;s beach');
    expect(injectShareMeta('<html><body>no head</body></html>', 'TAGS')).toBe('<html><body>no head</body></html>');
  });

  it('includes custom beach name, location, and image metadata when provided', () => {
    const tags = shareMetaTags({
      name: 'Ana',
      beachName: 'Castle Cove',
      location: 'waikiki',
      url: 'https://play.beech.games/?visit=K7F2QX',
      image: 'https://beechshore.com/img/K7F2QX.png?v=1',
    });
    expect(tags).toContain('Visit Castle Cove (Ana&#39;s beach) on beech');
    expect(tags).toContain('Waikīkī, Honolulu');
    expect(tags).toContain('og:site_name" content="beech"');
    expect(tags).toContain('og:image:type" content="image/png"');
    expect(tags).toContain('twitter:image:alt" content="Castle Cove, Ana&#39;s beach seen from above"');
  });
});

describe('share page handler', () => {
  let db: Db;
  let app: Hono;
  let indexPath: string;
  let anaCode: string;

  beforeAll(async () => {
    db = await openTestDb();
    const api = createApp(db, { googleClientIds: [], appleClientIds: [], allowedOrigins: [], devAuth: true });
    const dir = await mkdtemp(path.join(tmpdir(), 'beech-share-'));
    indexPath = path.join(dir, 'index.html');
    await writeFile(indexPath, '<!doctype html><html><head><title>beech</title></head><body>app</body></html>');
    app = new Hono();
    app.route('/api', api);
    app.get('/', createSharePageHandler(db, indexPath));
    app.get('*', (c) => c.html('plain page'));
    // Ana, with a saved beach
    const signIn = async (name: string) => {
      const r = await app.request('/api/auth/dev', {
        method: 'POST',
        body: JSON.stringify({ name }),
        headers: { 'Content-Type': 'application/json' },
      });
      return (await r.json()) as { token: string; user: { id: string } };
    };
    const ana = await signIn('ana-share');
    const anaEdit = ((await (await app.request('/api/edit-session', { method: 'POST', headers: { Authorization: `Bearer ${ana.token}` } })).json()) as { token: string }).token;
    const code = (await (await app.request('/api/neighbors', { headers: { Authorization: `Bearer ${ana.token}` } })).json()) as {
      code: string;
    };
    anaCode = code.code;
    await app.request(
      '/api/beach',
      {
        method: 'PUT',
        body: new Uint8Array([1, 2, 3]),
        headers: { Authorization: `Bearer ${ana.token}`, 'X-Beach-Location': 'bondi', 'X-Beach-Nx': '256', 'X-Beach-Ny': '256', 'X-Edit-Token': anaEdit },
      },
    );
  });

  afterAll(() => db.close());

  it('injects preview tags for a real beach code', async () => {
    const res = await app.request(`/?visit=${anaCode}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Visit ana-share&#39;s beach');
    expect(html).toContain(`og:url" content="http://localhost/?visit=${anaCode}"`);
    // on the shore: a picture of it, drawn by the shore site
    expect(html).toContain(`og:image" content="http://localhost/shore/img/${anaCode}.png?v=`);
    expect(html).toContain('summary_large_image');
  });

  it('gives no picture of a beach kept off the shore', async () => {
    await db.query('UPDATE beach SET on_shore = false WHERE code = $1', [anaCode]);
    const html = await (await app.request(`/?visit=${anaCode}`)).text();
    await db.query('UPDATE beach SET on_shore = true WHERE code = $1', [anaCode]);
    expect(html).toContain('og:title');
    expect(html).not.toContain('og:image');
  });

  it('injects invite tags for an invite link', async () => {
    const res = await app.request(`/?invite=${anaCode}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('ana-share invited you to beech');
    expect(html).toContain('welcome gift');
    expect(html).not.toContain('Visit ana-share');
  });

  it('serves the plain page for an unknown code, and with no code at all', async () => {
    for (const q of ['/?visit=ZZZZZZ', '/?invite=ZZZZZZ', '/']) {
      const res = await app.request(q);
      expect(res.status).toBe(200);
      expect(await res.text()).not.toContain('og:title');
    }
  });
});
