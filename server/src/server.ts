// Entry point: one process serves the built web app and /api. Runs on Cloud
// Run (PORT is provided) or locally.
//
// Environment:
//   PORT                 default 8080
//   PUBLIC_DIR           built web app (default ../dist)
//   DATABASE_URL         postgres://... (local Postgres, or Cloud SQL via the Auth Proxy)
//   DB_SOCKET, DB_USER, DB_PASSWORD, DB_NAME   Cloud SQL unix socket (Cloud Run --add-cloudsql-instances)
//   PGLITE_DIR           no Postgres at all: embedded PGlite (dev only; "memory" for in-memory)
//   GOOGLE_CLIENT_IDS    comma-separated OAuth client IDs (web, iOS, Android)
//   APPLE_CLIENT_IDS     comma-separated (bundle id, Services ID)
//   ALLOWED_ORIGINS      extra CORS origins, default the Capacitor app shells
//   DEV_AUTH             "1" enables /api/auth/dev; refused when NODE_ENV=production

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { createPgDb, createPgliteDb, type Db } from './db.js';
import { migrate } from './migrations.js';

const env = process.env;
const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const here = path.dirname(fileURLToPath(import.meta.url));

async function openDb(): Promise<Db> {
  if (env.DATABASE_URL) return createPgDb({ url: env.DATABASE_URL });
  if (env.DB_SOCKET) return createPgDb({ socket: env.DB_SOCKET, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  if (env.NODE_ENV === 'production') throw new Error('no database configured (DATABASE_URL or DB_SOCKET)');
  const dir = env.PGLITE_DIR ?? path.join(here, '..', '.data');
  console.log(`using embedded PGlite (${dir === 'memory' ? 'in memory' : dir})`);
  return createPgliteDb(dir === 'memory' ? undefined : dir);
}

const devAuth = env.DEV_AUTH === '1';
if (devAuth && env.NODE_ENV === 'production') throw new Error('DEV_AUTH must never be on in production');

const db = await openDb();
const applied = await migrate(db);
console.log(`database ready (schema v${applied})`);

const api = createApp(db, {
  googleClientIds: list(env.GOOGLE_CLIENT_IDS),
  appleClientIds: list(env.APPLE_CLIENT_IDS),
  allowedOrigins: list(env.ALLOWED_ORIGINS ?? 'capacitor://localhost,https://localhost'),
  devAuth,
});

const publicDir = path.resolve(env.PUBLIC_DIR ?? path.join(here, '..', '..', 'dist'));
const root = new Hono();
root.get('/healthz', (c) => c.text('ok'));
root.route('/api', api);
root.use(
  '/*',
  serveStatic({
    root: path.relative(process.cwd(), publicDir) || '.',
    onFound: (p, c) => {
      // hashed bundles never change; the page and service worker must revalidate
      c.header('Cache-Control', p.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }),
);
// single-page app: anything else gets the page
const indexHtml = path.join(publicDir, 'index.html');
root.get('*', (c) => {
  if (!fs.existsSync(indexHtml)) return c.text('web app not built (npm run build in the repo root)', 404);
  c.header('Cache-Control', 'no-cache');
  return c.html(fs.readFileSync(indexHtml, 'utf8'));
});

const port = Number(env.PORT ?? 8080);
const server = serve({ fetch: root.fetch, port, hostname: env.HOST ?? '0.0.0.0' }, () =>
  console.log(`beech listening on :${port} (web app from ${publicDir})`),
);

// Cloud Run sends SIGTERM before stopping an instance
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close();
    void db.close().finally(() => process.exit(0));
  });
}
