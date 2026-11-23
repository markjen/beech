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
//   APPLE_BUNDLE_ID      iOS bundle id store purchases are for (default app.beech.beach)
//   ANDROID_PACKAGE      Android package store purchases are for (default app.beech.beach)
//   GOOGLE_PLAY_SERVICE_ACCOUNT  optional service-account JSON for the Play Developer API
//                        (on Cloud Run the runtime service account is used instead)
//   GOOGLE_RTDN_AUDIENCE, GOOGLE_RTDN_SERVICE_ACCOUNT  the Pub/Sub push subscription's
//                        OIDC audience and service account, for Play refund notifications
//   ADMIN_EMAILS         comma-separated verified Google emails allowed into the
//                        admin console /admin (production: markjen@gmail.com). Empty: no admin.
//   ADMIN_API_TOKEN      the CLI's credential (set from Secret Manager; never in
//                        the repo). Hashed at startup; the raw value is never kept.
//   GIFT_CODE_PEPPER     pepper for gift card code hashes (Secret Manager).
//                        Optional in development; set it in production (a
//                        missing pepper logs a warning and still works).
//   XSOLLA_PROJECT_ID, XSOLLA_API_KEY, XSOLLA_WEBHOOK_SECRET   web checkout (docs/WEB_PAYMENTS.md;
//                        the key and webhook secret come from Secret Manager). All three
//                        set: the web shop takes card payments. Any missing: it doesn't.
//   XSOLLA_SANDBOX       "1": test payments only (Xsolla sandbox, test cards)
//   WEB_CHECKOUT_RETURN_URL  where Pay Station returns to (default https://beech.markjen.com/)
//   ALLOWED_ORIGINS      extra CORS origins, default the Capacitor app shells
//   DEV_AUTH             "1" enables /api/auth/dev; refused when NODE_ENV=production

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { adminPageHtml } from './adminPage.js';
import { hashToken } from './auth.js';
import { createPgDb, createPgliteDb, type Db } from './db.js';
import { migrate } from './migrations.js';
import { httpLogger, logEvent } from './observability.js';
import { createSharePageHandler } from './shareMeta.js';
import { xsollaFromEnv } from './xsolla.js';

const env = process.env;
const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const here = path.dirname(fileURLToPath(import.meta.url));

async function openDb(): Promise<Db> {
  if (env.DATABASE_URL) return createPgDb({ url: env.DATABASE_URL });
  if (env.DB_SOCKET) return createPgDb({ socket: env.DB_SOCKET, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  if (env.NODE_ENV === 'production') throw new Error('no database configured (DATABASE_URL or DB_SOCKET)');
  const dir = env.PGLITE_DIR ?? path.join(here, '..', '.data');
  logEvent('database', { mode: 'pglite', dir: dir === 'memory' ? 'memory' : dir });
  return createPgliteDb(dir === 'memory' ? undefined : dir);
}

const devAuth = env.DEV_AUTH === '1';
if (devAuth && env.NODE_ENV === 'production') throw new Error('DEV_AUTH must never be on in production');

// Gift cards / admin (docs/GIFT_CARDS_PROMOS.md). The pepper is
// defense-in-depth on top of 80-bit codes, so a missing pepper is a
// warning, not a refusal: the server must keep starting after a merge
// even before the secrets are set. The CLI token is hashed once here; the
// raw value is dropped.
const codePepper = env.GIFT_CODE_PEPPER ?? '';
if (!codePepper && env.NODE_ENV === 'production')
  logEvent('admin_config', { warning: 'GIFT_CODE_PEPPER is not set: gift card codes are hashed without a pepper' }, 'WARNING');
const adminTokenHash = env.ADMIN_API_TOKEN ? await hashToken(env.ADMIN_API_TOKEN) : undefined;
const adminEmails = list(env.ADMIN_EMAILS);
logEvent('admin_config', { admin_token: !!adminTokenHash, admin_emails: adminEmails.length, code_pepper: !!codePepper });

// Web checkout (docs/WEB_PAYMENTS.md): on only when fully configured, so the
// server keeps starting after a merge before the Xsolla secrets exist.
const xsolla = xsollaFromEnv(env);
if (!xsolla.cfg && xsolla.missing.length < 3)
  logEvent('web_checkout_config', { warning: `web checkout is off: ${xsolla.missing.join(', ')} not set` }, 'WARNING');
logEvent('web_checkout_config', { enabled: !!xsolla.cfg, sandbox: !!xsolla.cfg?.sandbox });

const db = await openDb();
const applied = await migrate(db);
logEvent('database_ready', { schema: applied });

// Query counters + latency percentiles, once a minute (see observability.ts).
// The db_error / db_slow_query lines fire as they happen; this is the trend.
const dbSummary = setInterval(() => {
  const s = db.stats?.();
  if (s) logEvent('db_summary', { ...s });
}, 60000);
dbSummary.unref();

const api = createApp(db, {
  googleClientIds: list(env.GOOGLE_CLIENT_IDS),
  appleClientIds: list(env.APPLE_CLIENT_IDS),
  allowedOrigins: list(env.ALLOWED_ORIGINS ?? 'capacitor://localhost,https://localhost'),
  devAuth,
  appleBundleId: env.APPLE_BUNDLE_ID || undefined,
  androidPackage: env.ANDROID_PACKAGE || undefined,
  googleRtdn: env.GOOGLE_RTDN_AUDIENCE && env.GOOGLE_RTDN_SERVICE_ACCOUNT ? { audience: env.GOOGLE_RTDN_AUDIENCE, email: env.GOOGLE_RTDN_SERVICE_ACCOUNT } : undefined,
  adminEmails,
  adminTokenHash,
  codePepper,
  xsolla: xsolla.cfg ?? undefined,
});

const publicDir = path.resolve(env.PUBLIC_DIR ?? path.join(here, '..', '..', 'dist'));
const root = new Hono();
// One structured log line per request, including static files and /healthz.
root.use('*', httpLogger);
root.get('/healthz', (c) => c.text('ok'));
// The admin console (docs/GIFT_CARDS_PROMOS.md): a small page of its own,
// not part of the beach app. It signs in with Google and talks to /api/admin;
// the API, not this page, decides who is an admin.
root.get('/admin', (c) => {
  c.header('Cache-Control', 'no-cache');
  return c.html(adminPageHtml(list(env.GOOGLE_CLIENT_IDS)[0] ?? null));
});
root.route('/api', api);
// a shared beach link (?visit=CODE) gets Open Graph tags for that beach, so
// the link shows a preview where it's pasted; everything else passes through
const indexHtml = path.join(publicDir, 'index.html');
root.get('/', createSharePageHandler(db, indexHtml));
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
root.get('*', (c) => {
  if (!fs.existsSync(indexHtml)) return c.text('web app not built (npm run build in the repo root)', 404);
  c.header('Cache-Control', 'no-cache');
  return c.html(fs.readFileSync(indexHtml, 'utf8'));
});

const port = Number(env.PORT ?? 8080);
const server = serve({ fetch: root.fetch, port, hostname: env.HOST ?? '0.0.0.0' }, () =>
  // The revision is the deploy marker: find a deploy in Logs Explorer by
  // jsonPayload.revision, or by this line's time.
  logEvent('server_start', { port, public_dir: publicDir }),
);

// Cloud Run sends SIGTERM before stopping an instance
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close();
    void db.close().finally(() => process.exit(0));
  });
}
