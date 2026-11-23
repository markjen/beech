import { Hono } from 'hono';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createPgDb, createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';
import { createSharePageHandler, escapeHtml, injectShareMeta, shareMetaTags } from '../src/shareMeta.js';

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
});

describe('share page handler', () => {
  let db: Db;
  let app: Hono;
  let indexPath: string;
  let anaCode: string;

  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL) {
      db = createPgDb({ url: process.env.TEST_DATABASE_URL });
      await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    } else {
      db = await createPgliteDb();
    }
    await migrate(db);
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
    const code = (await (await app.request('/api/neighbors', { headers: { Authorization: `Bearer ${ana.token}` } })).json()) as {
      code: string;
    };
    anaCode = code.code;
    await app.request(
      '/api/beach',
      {
        method: 'PUT',
        body: new Uint8Array([1, 2, 3]),
        headers: { Authorization: `Bearer ${ana.token}`, 'X-Beach-Location': 'bondi', 'X-Beach-Nx': '256', 'X-Beach-Ny': '256' },
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
  });

  it('serves the plain page for an unknown code, and with no code at all', async () => {
    for (const q of ['/?visit=ZZZZZZ', '/']) {
      const res = await app.request(q);
      expect(res.status).toBe(200);
      expect(await res.text()).not.toContain('og:title');
    }
  });
});
