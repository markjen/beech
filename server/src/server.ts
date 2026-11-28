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
//   GOOGLE_CLIENT_ID     the web OAuth client ID alone (public) — the beechshore
//                        account page's Google sign-in button (deploy-gcp.yml)
//   APPLE_CLIENT_IDS     comma-separated (bundle id, Services ID)
//   APPLE_CLIENT_ID      the Sign in with Apple Services ID alone (public) — the
//                        beechshore account page's Apple sign-in button (deploy-gcp.yml)
//   APPLE_AUTH_KEY, APPLE_AUTH_KEY_ID, APPLE_AUTH_TEAM_ID  optional Sign in with Apple
//                        .p8 private key (Secret Manager) for exchanging auth codes and
//                        revoking Apple tokens on account delete (App Store 5.1.1(v))
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
//   WEB_CHECKOUT_RETURN_URL  where Pay Station returns to (default https://play.beech.games/)
//   STRIPE_SECRET_KEY, STRIPE_MERCH_WEBHOOK_SECRET, PRINTFUL_TOKEN, PRINTFUL_WEBHOOK_SECRET
//                        the merch store (docs/MERCH_STORE.md; all from Secret Manager).
//                        All four set: store.beech.games takes orders. Any missing:
//                        it shows the catalog and "opening soon". The merch
//                        secret key is the store's own — the game's checkout
//                        has its own key (STRIPE_GAME_SECRET_KEY, below), so
//                        the game stays in test mode while the store is live.
//   STRIPE_GAME_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_SANDBOX
//                        the game's Stripe web checkout (docs/STRIPE_PAYMENTS.md).
//                        STRIPE_GAME_SECRET_KEY is Secret Manager
//                        beech-stripe-game-secret-key (test key for now);
//                        STRIPE_WEBHOOK_SECRET is beech-stripe-webhook-secret,
//                        the game endpoint's signing secret — not the merch
//                        endpoint's (STRIPE_MERCH_WEBHOOK_SECRET).
//                        STRIPE_SANDBOX "1": test payments only (Stripe test
//                        mode and test cards). All three set: the web shop
//                        offers Stripe when Xsolla is off.
//   PRINTFUL_STORE_ID    Printful store id, for an account-level token
//   MERCH_SUNGLASSES_VARIANT  Printful Warehousing variant id of the sunglasses; unset:
//                        the sunglasses stay out of the store (they come back
//                        on their own later; the set does not wait on this)
//   MERCH_STRIPE_TAX     "1": Stripe Tax on the checkout
//   PRINTFUL_DRAFTS_ONLY "1": orders reach Printful as drafts and are never confirmed (testing)
//   STORE_URL            the store's origin (default https://store.beech.games)
//   STORE_HOSTS          hosts served as the store (default store.beech.games);
//                        every other host has it under /merch-store
//   CATCHUP_MAX_GAP_DAYS most of an unvisited gap the sea's catch-up simulates
//                        (docs/LIVE_SIM.md), default 14
//   ALLOWED_ORIGINS      extra CORS origins, default the Capacitor app shells
//   SHORE_URL            the public shore site's origin (default https://beechshore.com)
//   SHORE_HOSTS          hosts served as the shore site (default beechshore.com,www.beechshore.com);
//                        every other host has it under /shore (docs/SHORE_SITE.md)
//   LANDING_URL          the landing page's origin (default https://beech.games)
//   LANDING_HOSTS        hosts served as the landing site (default beech.games,www.beech.games);
//                        every other host has it under /landing (docs/LANDING_PAGE.md)
//   GAME_URL             the game, for the shore's and the landing page's links
//                        (default https://play.beech.games)
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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { startAdminServer } from './adminServer.js';
import { appleAuthKeyFromEnv } from './auth.js';
import { openDbFromEnv } from './dbEnv.js';
import { migrate } from './migrations.js';
import { logEvent } from './observability.js';
import { createRootApp, DEFAULT_SHORE, DEFAULT_LANDING, DEFAULT_STORE } from './rootApp.js';
import { steamStoreFromEnv, syncSteamRefunds } from './steamStore.js';
import { stripeFromEnv } from './stripe.js';
import { devVapidKeys, makeSender, pushFromEnv, pushTick } from './push.js';
import { xsollaFromEnv } from './xsolla.js';
import { createMerch } from './merch.js';
import { merchFromEnv, merchTickFromEnv } from './merchProviders.js';

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

// Stripe web checkout (docs/STRIPE_PAYMENTS.md), the backup: same rule — on
// only when both test-mode secrets are set. Nothing here creates secrets;
// see the doc for the Secret Manager step.
const stripe = stripeFromEnv(env);
if (!stripe.cfg && stripe.missing.length < 2)
  logEvent('stripe_config', { warning: `stripe checkout is off: ${stripe.missing.join(', ')} not set` }, 'WARNING');
logEvent('stripe_config', { enabled: !!stripe.cfg, sandbox: !!stripe.cfg?.sandbox });

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

const steamStore = steamStoreFromEnv(env) ?? undefined;
const steamAuth = steamStore ? { appId: steamStore.appId, webApiKey: steamStore.webApiKey } : undefined;
logEvent('steam_config', { enabled: !!steamStore, sandbox: !!steamStore?.sandbox });

if (steamStore) {
  // The sync looks back 48h by default; if Steam is unreachable for longer
  // than that, refunds in the gap would be missed forever. Remember the last
  // successful sync and look back to it instead (capped at 7 days, so a stale
  // timestamp can't ask GetReport for an unbounded window — refunds older
  // than the cap after a >7 day outage still need a manual GetReport check).
  // A failed run leaves the watermark alone, so the next run retries the gap.
  const MAX_REFUND_LOOKBACK_MS = 7 * 24 * 3600 * 1000;
  let lastSteamRefundSyncOk = 0;
  const refundTimer = setInterval(() => {
    const nowMs = Date.now();
    const sinceMs = lastSteamRefundSyncOk
      ? Math.max(lastSteamRefundSyncOk, nowMs - MAX_REFUND_LOOKBACK_MS)
      : nowMs - 48 * 3600 * 1000;
    const sinceIso = new Date(sinceMs).toISOString().replace(/\.\d+Z$/, 'Z');
    void syncSteamRefunds(db, steamStore, sinceIso)
      .then((revoked) => {
        lastSteamRefundSyncOk = nowMs;
        if (revoked > 0) logEvent('steam_refund_sync', { revoked });
        if (nowMs - sinceMs > 48 * 3600 * 1000) {
          logEvent('steam_refund_sync_caught_up', { windowHours: Math.round((nowMs - sinceMs) / 3600000) }, 'WARNING');
        }
      })
      .catch((e) => logEvent('steam_refund_sync_error', { message: (e as Error).message }, 'WARNING'));
  }, 60 * 60 * 1000);
  refundTimer.unref();
}

// Push notifications (docs/INBOX_NOTIFICATIONS.md): each platform is on
// once its settings are there. The send queue is ticked once a minute by
// Cloud Scheduler (POST /api/push/tick) — the in-process timer below only
// runs when Scheduler isn't configured (local dev), because on Cloud Run an
// instance's CPU is throttled between requests and the timer's query looked
// slow (~1 s wall-clock on an idle instance). Two ticks at once are safe:
// each player's push runs under their push lock (specs/tla/Push.tla).
const pushConfig = pushFromEnv(env);
// The Scheduler tick, when its variables are set (see deploy-gcp.yml);
// without them the endpoint 404s and the in-process timer below takes over.
const schedulerTick =
  env.PUSH_TICK_AUDIENCE && env.PUSH_TICK_SERVICE_ACCOUNT
    ? { audience: env.PUSH_TICK_AUDIENCE, email: env.PUSH_TICK_SERVICE_ACCOUNT }
    : undefined;
// local development: throwaway VAPID keys, so web push can be tried (and
// npm run e2e:push runs) without setting anything up
if (devAuth && !pushConfig.web) pushConfig.web = { ...devVapidKeys(), subject: 'mailto:dev@localhost' };
const pushSend = makeSender(pushConfig);
logEvent('push_config', { web: !!pushConfig.web, ios: !!pushConfig.apns, android: !!pushConfig.fcm });
if ((pushConfig.web || pushConfig.apns || pushConfig.fcm) && !schedulerTick) {
  let ticking = false;
  const pushTimer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    void pushTick(db, pushSend)
      .then((r) => r.pushes && logEvent('push_tick', { ...r }))
      .catch((e) => logEvent('push_tick_error', { message: (e as Error).message }, 'WARNING'))
      .finally(() => (ticking = false));
  }, 60_000);
  pushTimer.unref();
}

// The merch store (docs/MERCH_STORE.md): orders on only when Stripe and
// Printful are both set up. The sweep sends paid orders on and recovers
// stale claims once a minute (specs/tla/MerchOrders.tla, Recover) — ticked
// by Cloud Scheduler (POST /api/merch/tick) once configured, the
// in-process timer below only runs when Scheduler isn't (local dev),
// because on Cloud Run an instance's CPU is throttled between requests
// and the timer's query looked slow (~1 s wall-clock on an idle instance).
// Same reason as the push tick (docs/INBOX_NOTIFICATIONS.md).
const merchEnv = merchFromEnv(env);
if (!merchEnv.cfg && merchEnv.missing.length < 4)
  logEvent('merch_config', { warning: `the merch store is off: ${merchEnv.missing.join(', ')} not set` }, 'WARNING');
logEvent('merch_config', { enabled: !!merchEnv.cfg, sunglasses: !!merchEnv.cfg?.sunglassesVariant, drafts_only: !!merchEnv.cfg?.printfulDraftsOnly });
// The Scheduler tick, when its variables are set (see deploy-gcp.yml);
// without them the endpoint 404s and the in-process timer below takes over.
const merchSchedulerTick = merchTickFromEnv(env);
const merch = createMerch(db, { cfg: merchEnv.cfg ?? undefined, now: Date.now, tick: merchSchedulerTick });
if (merchEnv.cfg && !merchSchedulerTick) {
  let sweeping = false;
  const merchTimer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void merch
      .tick()
      .then((r) => (r.recovered || r.confirmed || r.sent) && logEvent('merch_tick', { ...r }))
      .catch((e) => logEvent('merch_tick_error', { message: (e as Error).message }, 'WARNING'))
      .finally(() => (sweeping = false));
  }, 60_000);
  merchTimer.unref();
}

const api = createApp(db, {
  merch,
  push: {
    config: pushConfig,
    send: pushSend,
    tick: schedulerTick,
  },
  googleClientIds: list(env.GOOGLE_CLIENT_IDS),
  appleClientIds: list(env.APPLE_CLIENT_IDS),
  appleAuthKey: appleAuthKeyFromEnv(env),
  steamAuth,
  steamStore,
  allowedOrigins: list(env.ALLOWED_ORIGINS ?? 'capacitor://localhost,https://localhost,app://beech'),
  devAuth,
  appleBundleId: env.APPLE_BUNDLE_ID || undefined,
  androidPackage: env.ANDROID_PACKAGE || undefined,
  googleRtdn: env.GOOGLE_RTDN_AUDIENCE && env.GOOGLE_RTDN_SERVICE_ACCOUNT ? { audience: env.GOOGLE_RTDN_AUDIENCE, email: env.GOOGLE_RTDN_SERVICE_ACCOUNT } : undefined,
  codePepper,
  weatherApiKey: env.OPEN_METEO_API_KEY || undefined,
  xsolla: xsolla.cfg ?? undefined,
  stripe: stripe.cfg ?? undefined,
  shoreUrl: env.SHORE_URL || undefined,
});

const publicDir = path.resolve(env.PUBLIC_DIR ?? path.join(here, '..', '..', 'dist'));
const root = createRootApp(db, api, publicDir, {
  shore: {
    hosts: env.SHORE_HOSTS !== undefined ? list(env.SHORE_HOSTS) : DEFAULT_SHORE.hosts,
    url: env.SHORE_URL || DEFAULT_SHORE.url,
    gameUrl: env.GAME_URL || DEFAULT_SHORE.gameUrl,
    googleClientId: env.GOOGLE_CLIENT_ID || undefined,
    appleClientId: env.APPLE_CLIENT_ID || undefined,
  },
  store: {
    hosts: env.STORE_HOSTS !== undefined ? list(env.STORE_HOSTS) : DEFAULT_STORE.hosts,
    url: env.STORE_URL || DEFAULT_STORE.url,
    gameUrl: env.GAME_URL || DEFAULT_STORE.gameUrl,
    googleClientId: env.GOOGLE_CLIENT_ID || undefined,
    appleClientId: env.APPLE_CLIENT_ID || undefined,
  },
  landing: {
    hosts: env.LANDING_HOSTS !== undefined ? list(env.LANDING_HOSTS) : DEFAULT_LANDING.hosts,
    url: env.LANDING_URL || DEFAULT_LANDING.url,
    gameUrl: env.GAME_URL || DEFAULT_LANDING.gameUrl,
  },
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
