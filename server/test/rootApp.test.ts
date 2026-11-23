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
