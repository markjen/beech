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
//   GIFT_CODE_PEPPER     pepper for gift card code hashes (Secret Manager), for
//                        redeeming. Must match the admin service's (adminServer.ts).
//                        Optional in development; set it in production (a
//                        missing pepper logs a warning and still works).
//   XSOLLA_PROJECT_ID, XSOLLA_API_KEY, XSOLLA_WEBHOOK_SECRET   web checkout (docs/WEB_PAYMENTS.md;
//                        the key and webhook secret come from Secret Manager). All three
//                        set: the web shop takes card payments. Any missing: it doesn't.
//   XSOLLA_SANDBOX       "1": test payments only (Xsolla sandbox, test cards)
//   WEB_CHECKOUT_RETURN_URL  where Pay Station returns to (default https://beech.markjen.com/)
//   ALLOWED_ORIGINS      extra CORS origins, default the Capacitor app shells
//   DEV_AUTH             "1" enables /api/auth/dev; refused when NODE_ENV=production
//   ADMIN_DEV_PORT       local development only: also serve the admin console
//                        (adminServer.ts) on this port, sharing this process's
//                        database (PGlite can't be opened by two processes).
//                        Refused when NODE_ENV=production; production runs the
//                        admin console as its own Cloud Run service.
//
// The admin console is not served here: it is a separate app (adminServer.ts,
// docs/GIFT_CARDS_PROMOS.md), deployed as its own service.

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { startAdminServer } from './adminServer.js';
import { openDbFromEnv } from './dbEnv.js';
import { migrate } from './migrations.js';
import { httpLogger, logEvent } from './observability.js';
import { createSharePageHandler } from './shareMeta.js';
import { xsollaFromEnv } from './xsolla.js';

const env = process.env;
const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const here = path.dirname(fileURLToPath(import.meta.url));

const devAuth = env.DEV_AUTH === '1';
if (devAuth && env.NODE_ENV === 'production') throw new Error('DEV_AUTH must never be on in production');

// The gift card pepper (docs/GIFT_CARDS_PROMOS.md): redeeming hashes the
// code with it. Defense-in-depth on top of 80-bit codes, so a missing pepper
// is a warning, not a refusal.
const codePepper = env.GIFT_CODE_PEPPER ?? '';
if (!codePepper && env.NODE_ENV === 'production')
  logEvent('admin_config', { warning: 'GIFT_CODE_PEPPER is not set: gift card codes are hashed without a pepper' }, 'WARNING');

// Web checkout (docs/WEB_PAYMENTS.md): on only when fully configured, so the
// server keeps starting after a merge before the Xsolla secrets exist.
const xsolla = xsollaFromEnv(env);
if (!xsolla.cfg && xsolla.missing.length < 3)
  logEvent('web_checkout_config', { warning: `web checkout is off: ${xsolla.missing.join(', ')} not set` }, 'WARNING');
logEvent('web_checkout_config', { enabled: !!xsolla.cfg, sandbox: !!xsolla.cfg?.sandbox });

const adminDevPort = env.ADMIN_DEV_PORT ? Number(env.ADMIN_DEV_PORT) : null;
if (adminDevPort && env.NODE_ENV === 'production') throw new Error('ADMIN_DEV_PORT is for local development only');

const db = await openDbFromEnv(env, path.join(here, '..', '.data'));
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
  codePepper,
  xsolla: xsolla.cfg ?? undefined,
});

const publicDir = path.resolve(env.PUBLIC_DIR ?? path.join(here, '..', '..', 'dist'));
const root = new Hono();
// One structured log line per request, including static files and /healthz.
root.use('*', httpLogger);
root.get('/healthz', (c) => c.text('ok'));
root.route('/api', api);
// Unknown /api paths are API 404s, not the app shell: the mounted app's
// own notFound doesn't stop the root's SPA fallback below, so without this
// every unknown /api path (e.g. /api/admin/me) served index.html with a 200
// — which is what failed the deploy smoke test.
root.all('/api/*', (c) => c.json({ error: 'not found' }, 404));
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

// local development: the admin console on its own port, same database
const adminDev = adminDevPort ? await startAdminServer(db, { ...env, PORT: String(adminDevPort) }) : null;

// Cloud Run sends SIGTERM before stopping an instance
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close();
    adminDev?.close();
    void db.close().finally(() => process.exit(0));
  });
}
