// beech API. Mounted under /api by src/server.ts, which also serves the web app.
//
//   POST   /api/auth/google      { credential }            -> { token, user }
//   POST   /api/auth/apple       { identityToken, name? }  -> { token, user }
//   POST   /api/auth/dev         { name }                  -> { token, user }   (DEV_AUTH only)
//   POST   /api/auth/logout                                -> 204
//   GET    /api/weather                                    -> { at, places: { [placeId]: weather } }  (public, cached)
//   GET    /api/me                                         -> { user }
//   GET    /api/beach                                      -> sand bytes + X-Beach-* headers | 404
//   PUT    /api/beach            sand bytes, X-Beach-Location/Nx/Ny -> { version, updatedAt } (+ largeEdit / largeEditCheckpoint when the save reshaped the beach)
//   DELETE /api/account                                    -> 204 (user, sessions, beach, neighbor links)
//   POST   /api/account/link-code                          -> { code, expiresAt } (10-min one-time code)
//   POST   /api/account/link/preview   { code }            -> { preview } (what merging this account would do)
//   POST   /api/account/link           { code, confirmed? } -> { token, user, merged } (409 + preview until confirmed)
//
//   GET    /api/neighbors                                  -> { code, left, right, asked, requests }
//   PUT    /api/neighbors/:side  { code }                  -> { status: asked | linked, neighbor }
//   POST   /api/neighbors/requests/:code/accept            -> { side, neighbor }
//   DELETE /api/neighbors/requests/:code                   -> 204 (decline)
//   DELETE /api/neighbors/:side                            -> 204 (move away / take back the request)
//   GET    /api/shore?code=&depth=, /api/shore/more?from=&dir=&count=   the global beachfront
//   GET    /api/neighbors/:side/beach                      -> that neighbor's sand bytes | 404
//   POST   /api/neighbors/code                             -> { code } (new code; old one stops working)
//   POST   /api/gifts            { code, item }            -> { item, to: { name, code } }
//   GET    /api/inventory                                  -> { items: [{ item, quantity, source, ... }] }
//   POST   /api/dig-finds        { pathM, durationMs }     -> { found, item?, rarity?, findsToday, findsLeft, nextFindsAt }
//   POST   /api/store/web-checkout { productId }           -> { order, url }  (web only; Xsolla Pay Station)
//   GET    /api/store/web-orders/:id                       -> { order }
//   POST   /api/store/xsolla/webhook                       Xsolla's signed webhooks (no session)
//   GET    /api/guide                                      -> { done: [{ step, at }] }
//   POST   /api/guide/:step                                -> { step, new, gift, bonus }
//   GET    /api/invites/:code    (no session)              -> { name, welcomeGift }
//   POST   /api/referrals/claim  { code }                  -> { inviter: { name, code }, gift }
//   GET    /api/referrals                                  -> { code, joined, settled, friends, ladder, ... }
//   GET    /api/beaches/:code/rating                       -> { count, average, mine, yours, quickNotes, freeText }
//   POST   /api/beaches/:code/visit { shells?, note?, quick?, item? } -> { rated, noted, gifted, rating }
//   GET    /api/inbox?before=                              -> { unread, latest, entries }
//   POST   /api/inbox/read       { upTo }                  -> { unread, latest }
//   POST   /api/notes/:id/report { reason }                -> 204
//   GET    /api/blocks, PUT/DELETE /api/blocks/:code       block someone (by any beach code of theirs)
//
// Auth: `Authorization: Bearer <token>`; only the token's SHA-256 is stored.

import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { PACKS, PRODUCTS, copyBasket, packById, productById, realMoneyProductById, storeProductById, type Product } from './products.js';
import { ledgerOf } from './ledger.js';
import { displayName } from './prizeNames.js';
import { createWeather } from './weather.js';
import { creditBalance, grantPurchase } from './bucksDb.js';
import { SECTION_IDS, SECTION_ROWS, isSection } from './sections.js';
import { BUCK, bucksToCents, centsToBucks, listBucks, roundToBuck, shareOut, tradeable, unitsOf } from './bucks.js';
import { issueSubmissionSession, UUID_PATTERN } from './itemSubmissions.js';
import { awardCheckoutCreatorCredit, awardCreatorCredit, creatorOffer, creatorOffers, lockCreditUsers, nativeSalePrice, reverseCreatorCreditByRef, salePriceCents } from './creatorCredit.js';
import {
  claimCreditPurchase,
  hashGiftCode,
  isGiftCodeShape,
} from './giftCards.js';
import { appleRefund, googleVoided, revokeStorePurchase, verifyAppleTransaction, verifyGoogleOidc, verifyGooglePurchase, type VerifiedPurchase } from './store.js';
import { accountPromos, bestPromoForPack, loadAccountPromo } from './promos.js';
import { NOTIFY_PREFS, PUSH_DEVICES, lockPush, makeSender, pushTick, validEndpoint, validTz, type NotifyPref, type PushConfig, type PushSender } from './push.js';
import { POOLS, GRAB_CHANCE, COOLDOWN_MAX_MS, COOLDOWN_MIN_MS, cooldownAfter, cryptoRandom, draw, grab, pullDay, starterPrize, STARTER, type Rarity } from './pulls.js';
import { currentSet, drawVending, nextUtcMidnight } from './vending.js';
import { CLAW_EXTRA_GO_BUCKS, VENDING_EXTRA_BALL_BUCKS, claimPaidPull, paidTryPrice } from './paidPulls.js';
import { DIG_FIND_DAILY_CAP, DIG_FIND_ROLL_COOLDOWN_MS, digDraw, qualifiesForFind } from './digFinds.js';
import {
  adoptPet,
  cleanPetName,
  consumeTreat,
  feedBeachPet,
  getBeachPet,
  getBondProgress,
  hasVisitorFedToday,
  maybeGrantBonusTreat,
  recentPetFeeders,
  recordSnackOut,
  recordWildFeed,
  returnSnack,
  renameBeachPet,
  visitorFeedPet,
  speciesOf,
  listBagPets,
  stowPet,
  stowLocked,
  placePet,
  cleanHome,
  setPetHome,
} from './animals.js';
import { PETS } from './petCatalog.js';
import {
  exchangeAppleAuthorizationCode,
  hashToken,
  newSessionToken,
  revokeAppleToken,
  SESSION_DAYS,
  verifyAppleIdToken,
  verifyGoogleIdToken,
  verifySteamTicket,
  type AppleAuthKeyConfig,
  type SteamAuthConfig,
  type VerifiedIdentity,
} from './auth.js';
import { toBytes, type Db } from './db.js';
import { executeAccountMerge, planAccountMerge } from './accountMerge.js';
import { BEACH, NODE, PIER_SITE, SIDES, beachJson, isPublic, normalizeCode, shoreGraph, type NodeRow, type Side } from './shore.js';
import {
  BadBlob,
  CHECKPOINT_BYTES_PER_USER,
  CHECKPOINT_NAME_MAX,
  CHECKPOINTS_PER_BEACH,
  MAX_BEACH_BYTES,
  MAX_CELLS,
  OLD_MAX_OBJECTS,
  countObjects,
  dropMissing,
  inspectBlob,
  nothingGrew,
  sandDiff,
  saveShort,
  shortfall,
  type Short,
} from './checkpoints.js';
import {
  FREE_TEXT_AFTER_MS,
  INBOX_KEEP,
  INBOX_READ_TTL_MS,
  NOTES_PER_BEACH_DAY,
  NOTES_PER_HOUR,
  QUICK_NOTES,
  RATING_EVERY_MS,
  RATING_SHOWN_AT,
  checkNote,
  utcDay,
} from './inbox.js';
import {
  BONUS_STEPS,
  CLAIM_WINDOW_MS,
  GUIDE_BONUS,
  GUIDE_STEPS,
  INVITE_BONUS,
  REWARD_CAP,
  SETTLE_STEPS,
  WELCOME_GIFT,
  guideStep,
  ladder,
  ladderReward,
} from './referrals.js';
import { createRateLimiter, logEvent, parseClientEvent, routeLabel } from './observability.js';
import { createLiveBeaches, liveConfig, type LiveConfig } from './liveBeach.js';
import { createPaymentToken, payStationUrl, verifyWebhookSignature, xsollaError, type CreateToken, type XsollaConfig, type XsollaWebhook } from './xsolla.js';
import { finalizeSteamTxn, initSteamTxn, type SteamStoreConfig } from './steamStore.js';

export interface AppConfig {
  googleClientIds: string[];
  appleClientIds: string[];
  /** extra origins allowed cross-origin (the native app shells) */
  allowedOrigins: string[];
  devAuth: boolean;
  /** injectable for tests */
  verifyGoogle?: typeof verifyGoogleIdToken;
  verifyApple?: typeof verifyAppleIdToken;
  verifySteam?: typeof verifySteamTicket;
  /** Sign in with Apple private key (APPLE_AUTH_KEY / KEY_ID / TEAM_ID); enables token exchange and revocation on account delete */
  appleAuthKey?: AppleAuthKeyConfig;
  /** injectable for tests */
  appleTokenExchange?: (code: string, clientId: string, redirectUri?: string) => Promise<string>;
  appleTokenRevoke?: (refreshToken: string, clientId: string) => Promise<void>;
  /** Steam Web API auth config (STEAM_APP_ID + STEAM_WEB_API_KEY); unset disables /auth/steam */
  steamAuth?: SteamAuthConfig;
  /** Steam Wallet microtransactions (ISteamMicroTxn); unset disables /store/steam/* */
  steamStore?: SteamStoreConfig;
  /** injectable for tests: Steam InitTxn/FinalizeTxn overrides */
  steamTxn?: {
    init?: typeof initSteamTxn;
    finalize?: typeof finalizeSteamTxn;
  };
  /** requests a minute per client IP (default 300), and sign-ins (default 20) */
  rateLimit?: { perMinute?: number; signInsPerMinute?: number };
  /** the clock (tests move it forward) */
  now?: () => number;
  /** real weather at every place (GET /weather); tests pass one with a fake fetch */
  weather?: ReturnType<typeof createWeather>;
  /** Open-Meteo API key (OPEN_METEO_API_KEY, a paid plan: its free API is non-commercial only) */
  weatherApiKey?: string;
  /** live beaches (docs/LIVE_SIM.md); default from the environment (CATCHUP_MAX_GAP_DAYS) */
  live?: LiveConfig;
  /** the dice (tests force a miss) */
  rand?: () => number;
  /** the iOS bundle id and Android package the store purchases are for */
  appleBundleId?: string;
  androidPackage?: string;
  /** Google Play notifications (Pub/Sub push): the push's OIDC audience and service account */
  googleRtdn?: { audience: string; email: string };
  /** pepper for gift card code hashes (GIFT_CODE_PEPPER, required in production) */
  codePepper?: string;
  /** injectable for tests: how purchases and refunds are checked */
  stores?: {
    apple?: (jws: string, bundleId: string) => Promise<VerifiedPurchase>;
    google?: (pkg: string, productId: string, token: string) => Promise<VerifiedPurchase>;
    appleRefund?: (signedPayload: string, bundleId: string) => Promise<string | null>;
    googleVoided?: typeof googleVoided;
  };
  /**
   * Web checkout through Xsolla (docs/WEB_PAYMENTS.md). Unset: the web shop
   * keeps sending people to the apps.
   */
  xsolla?: XsollaConfig;
  /** injectable for tests: how a Pay Station payment token is made */
  xsollaToken?: CreateToken;
  /**
   * Push notifications (docs/INBOX_NOTIFICATIONS.md, server/src/push.ts):
   * which platforms are set up, how a push is sent (tests pass their own),
   * and who may call POST /push/tick (Cloud Scheduler's OIDC token).
   */
  push?: { config: PushConfig; send?: PushSender; tick?: { audience: string; email: string } };
  /** the shore site's public origin (SHORE_URL): where a top-up from your account page comes back to */
  shoreUrl?: string;
}

export interface User {
  id: string;
  name: string;
}

type Env = { Variables: { user: User; tokenHash: string; shore: boolean } };

/** most beaches one person can have */
export const BEACH_CAP = 8;

/** A strict copy that's short: thrown inside the transaction so a new beach made for it rolls back too. */
class CopyShort extends Error {
  constructor(readonly short: unknown[]) {
    super('short');
  }
}
const BEACH_HEADERS = ['X-Beach-Location', 'X-Beach-Nx', 'X-Beach-Ny', 'X-Beach-Version', 'X-Beach-Updated', 'X-Beach-Epoch', 'X-Beach-Simulated-Until'];
/** request-only headers the app sends cross-origin (the phone apps) */
const REQUEST_HEADERS = ['X-Beach-Items', 'X-Beach-Max', 'X-Checkpoint-Name', 'X-App-Build', 'X-Edit-Token'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I

const fail = (status: 400 | 401 | 403 | 404 | 409 | 413 | 426 | 429 | 500, message: string): never => {
  throw new HTTPException(status, { message });
};

export function newNeighborCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function newLinkCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const raw = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

const normalizeLinkCode = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

export { normalizeCode };

export function createApp(db: Db, cfg: AppConfig): Hono<Env> {
  const verifyGoogle = cfg.verifyGoogle ?? verifyGoogleIdToken;
  const verifyApple = cfg.verifyApple ?? verifyAppleIdToken;
  const verifySteam = cfg.verifySteam ?? verifySteamTicket;
  const exchangeAppleCode =
    cfg.appleTokenExchange ??
    (cfg.appleAuthKey
      ? (code: string, clientId: string, redirectUri?: string) =>
          exchangeAppleAuthorizationCode(code, clientId, cfg.appleAuthKey!, redirectUri, fetch, (cfg.now ?? Date.now)())
      : undefined);
  const revokeApple =
    cfg.appleTokenRevoke ??
    (cfg.appleAuthKey
      ? (refreshToken: string, clientId: string) =>
          revokeAppleToken(refreshToken, clientId, cfg.appleAuthKey!, fetch, (cfg.now ?? Date.now)())
      : undefined);
  const saveAppleRefreshToken = async (
    sub: string,
    clientId: string | undefined,
    authorizationCode: string | undefined,
    redirectUri: string | undefined,
  ): Promise<void> => {
    if (!exchangeAppleCode || !authorizationCode || !clientId) return;
    try {
      const refreshToken = await exchangeAppleCode(authorizationCode, clientId, redirectUri);
      await db.query(
        "UPDATE user_identities SET apple_refresh_token = $1, apple_client_id = $2 WHERE provider = 'apple' AND provider_sub = $3",
        [refreshToken, clientId, sub],
      );
    } catch (e) {
      logEvent('apple_token_exchange_failed', { message: (e as Error).message }, 'WARNING');
    }
  };
  const app = new Hono<Env>();
  // the sea keeps working while nobody has a beach open (docs/LIVE_SIM.md)
  const liveClock = () => cfg.now?.() ?? Date.now();
  const live = createLiveBeaches(db, liveClock, cfg.live ?? liveConfig(), (e) => logEvent(String(e.event), e));

  // Request logging (httpLogger) is mounted once, on the root app in
  // server.ts, so it covers /api/* and the CORS preflight. Mounting it here
  // too would log every API request twice and double the metrics.

  // ---------------------------------------------------------------- CORS
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    const self = new URL(c.req.url).origin;
    const ok = !!origin && (origin === self || cfg.allowedOrigins.includes(origin));
    if (c.req.method === 'OPTIONS') {
      const res = new Response(null, { status: 204 });
      if (ok) setCors(res.headers, origin!);
      return res;
    }
    await next();
    if (ok) setCors(c.res.headers, origin!);
    // per-user answers: never let a browser or proxy reuse one for someone else
    c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.append('Vary', 'Authorization');
  });

  // ---------------------------------------------------------------- rate limits
  // Per client IP (Cloud Run's x-forwarded-for): a generous limit on the whole
  // API, a tight one on signing in. The stores' webhooks are exempt (they come
  // in bursts from a few IPs, and are signature-checked). Requests with no
  // forwarded IP (tests, local development) aren't limited.
  const perIp = createRateLimiter(cfg.rateLimit?.perMinute ?? 300);
  const signIns = createRateLimiter(cfg.rateLimit?.signInsPerMinute ?? 20);
  const WEBHOOKS = ['/store/apple/notifications', '/store/google/rtdn', '/store/xsolla/webhook'];
  app.use('*', async (c, next) => {
    const ip = (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim();
    if (ip && c.req.method !== 'OPTIONS' && !WEBHOOKS.some((w) => c.req.path.endsWith(w))) {
      const signIn = c.req.method === 'POST' && c.req.path.includes('/auth/');
      if (!perIp(ip) || (signIn && !signIns(ip))) {
        logEvent('rate_limited', { route: routeLabel(c), sign_in: signIn }, 'WARNING');
        return c.json({ error: 'too many requests: slow down a little' }, 429, { 'Retry-After': '60' });
      }
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    // A real 500: log it structured (the request line already has the status).
    // The stack stays in Cloud Logging; the client only ever sees the generic text.
    logEvent(
      'api_error',
      { route: routeLabel(c), message: err.message, stack: String(err.stack ?? '').slice(0, 1000) },
      'ERROR',
    );
    return c.json({ error: 'something went wrong' }, 500);
  });
  app.notFound((c) => c.json({ error: 'not found' }, 404));

  // ---------------------------------------------------------------- sessions
  async function startSession(c: Context<Env>, who: VerifiedIdentity | { provider: 'dev'; sub: string; name: string }) {
    const now = (cfg.now ?? Date.now)();
    const email = 'email' in who ? who.email ?? null : null;
    let rows = await db.query<User>(
      'SELECT u.id, u.name FROM user_identities ui JOIN users u ON u.id = ui.user_id WHERE ui.provider = $1 AND ui.provider_sub = $2',
      [who.provider, who.sub],
    );
    let user = rows[0];
    if (!user) {
      // a fresh neighbor code; retry on the (very unlikely) collision
      for (let attempt = 0; attempt < 5 && !user; attempt++) {
        try {
          rows = await db.query<User>(
            'INSERT INTO users (id, provider, provider_sub, name, neighbor_code, email, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name',
            [crypto.randomUUID(), who.provider, who.sub, who.name, newNeighborCode(), email, now],
          );
          user = rows[0];
          await db.query(
            'INSERT INTO user_identities (provider, provider_sub, user_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [who.provider, who.sub, user!.id, now],
          );
        } catch (e) {
          if (attempt === 4) throw e;
        }
      }
    } else if (who.name && who.name !== user.name) {
      await db.query('UPDATE users SET name = $1 WHERE id = $2', [who.name, user.id]);
      user.name = who.name;
    }
    // a Google sign-in refreshes the verified email (the admin console
    // searches by it); an unverified or absent address never overwrites a stored one
    if (email) await db.query('UPDATE users SET email = $1 WHERE id = $2 AND (email IS NULL OR email <> $1)', [email, user!.id]);
    // everyone has a home beach: its id is theirs, its code their neighbor code
    await db.query(
      `INSERT INTO beach (id, owner_id, code, home, created_at)
       SELECT id, id, neighbor_code, true, created_at FROM users WHERE id = $1
       ON CONFLICT DO NOTHING`,
      [user!.id],
    );
    const token = newSessionToken();
    await db.query('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
      await hashToken(token),
      user!.id,
      now,
      now + SESSION_DAYS * 86400000,
    ]);
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND expires_at < $2', [user!.id, now]);
    return c.json({ token, user });
  }

  const requireUser = async (c: Context<Env>, next: () => Promise<void>) => {
    const m = /^Bearer\s+(\S+)$/.exec(c.req.header('Authorization') ?? '');
    if (!m) fail(401, 'sign in first');
    const tokenHash = await hashToken(m![1]);
    const rows = await db.query<User & { expires_at: string }>(
      'SELECT u.id, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1',
      [tokenHash],
    );
    const row = rows[0];
    if (!row || Number(row.expires_at) < Date.now()) fail(401, 'session expired, sign in again');
    c.set('user', { id: row!.id, name: row!.name });
    c.set('tokenHash', tokenHash);
    await next();
  };

  const pepper = cfg.codePepper ?? '';
  const body = async <T>(c: Context<Env>): Promise<T> => {
    try {
      return (await c.req.json()) as T;
    } catch {
      return fail(400, 'expected a JSON body');
    }
  };

  // ---------------------------------------------------------------- auth
  app.get('/health', (c) => c.json({ ok: true }));

  // ---------------------------------------------------------------- weather
  // The same for everyone and public: the weather at every place, cached on
  // the server for 15 minutes (server/src/weather.ts).
  const weather =
    cfg.weather ?? createWeather({ apiKey: cfg.weatherApiKey, log: (e) => logEvent(e.event, e, 'WARNING') });
  app.get('/weather', async (c) => {
    const r = await weather.get();
    if (!r) return c.json({ error: 'weather unavailable' }, 503);
    return c.json(r);
  });

  // ---------------------------------------------------------------- client events
  // Web and native apps report unhandled + caught errors, load timing, and
  // lightweight diagnostic telemetry, so phones (where nobody watches the
  // console) are visible in Cloud Logging too. Unauthenticated by design: it
  // only writes a structured log line, never the database. Validated,
  // size-capped (4 KB) and rate-limited per IP (60/min); anything else is
  // dropped with a 4xx and never reaches the logs.
  const clientEvents = createRateLimiter(60);
  app.post('/client-events', async (c) => {
    const ip = (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown';
    if (!clientEvents(ip)) return c.json({ error: 'slow down' }, 429);
    const text = await c.req.text();
    if (text.length > 4096) return c.json({ error: 'event too large' }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return c.json({ error: 'expected a JSON body' }, 400);
    }
    const parsed = parseClientEvent(body);
    if (!parsed.ok) return c.json({ error: parsed.reason }, 400);
    const e = parsed.event;
    const ctx = {
      ...(e.platform ? { platform: e.platform } : {}),
      ...(e.version ? { version: e.version } : {}),
      ...(e.build ? { build: e.build } : {}),
    };
    if (e.kind === 'error') {
      logEvent(
        'client_error',
        {
          message: e.message,
          category: e.category ?? 'unhandled',
          source: e.source ?? null,
          path: e.path ?? null,
          ...(e.stack ? { stack: e.stack } : {}),
          ...ctx,
          ...(e.meta ? { meta: e.meta } : {}),
        },
        'WARNING',
      );
    } else if (e.kind === 'perf') {
      logEvent('client_perf', {
        load_ms: e.load_ms,
        dcl_ms: e.dcl_ms,
        ...(e.tier ? { tier: e.tier } : {}),
        ...(e.bench_ms !== undefined ? { bench_ms: e.bench_ms } : {}),
        ...ctx,
      });
    } else {
      logEvent('client_event', {
        name: e.name,
        ...ctx,
        ...(e.meta ? { meta: e.meta } : {}),
      });
    }
    return c.body(null, 204);
  });

  app.post('/auth/google', async (c) => {
    const { credential } = await body<{ credential?: string }>(c);
    if (!credential) fail(400, 'missing credential');
    let who: VerifiedIdentity;
    try {
      who = await verifyGoogle(credential!, cfg.googleClientIds);
    } catch (e) {
      return fail(401, `google sign-in failed: ${(e as Error).message}`);
    }
    return startSession(c, who);
  });

  app.post('/auth/apple', async (c) => {
    const { identityToken, name, authorizationCode, redirectUri } = await body<{
      identityToken?: string;
      name?: string;
      authorizationCode?: string;
      redirectUri?: string;
    }>(c);
    if (!identityToken) fail(400, 'missing identityToken');
    let who: VerifiedIdentity;
    try {
      who = await verifyApple(identityToken!, cfg.appleClientIds, name ?? '');
    } catch (e) {
      return fail(401, `apple sign-in failed: ${(e as Error).message}`);
    }
    const res = await startSession(c, who);
    await saveAppleRefreshToken(who.sub, who.clientId, authorizationCode, redirectUri);
    return res;
  });

  const submissionConnections = createRateLimiter(10);
  app.post('/item-submissions/connect', requireUser, async (c) => {
    if (!submissionConnections(c.get('user').id)) return c.json({ error: 'slow down' }, 429);
    return c.json({ token: await issueSubmissionSession(db, c.get('tokenHash')) });
  });

  app.post('/auth/steam', async (c) => {
    if (!cfg.steamAuth) fail(404, 'steam sign-in is not enabled');
    const { ticket, name } = await body<{ ticket?: string; name?: string }>(c);
    if (!ticket) fail(400, 'missing ticket');
    let who: VerifiedIdentity;
    try {
      who = await verifySteam(ticket!, cfg.steamAuth!, name ?? '');
    } catch (e) {
      return fail(401, `steam sign-in failed: ${(e as Error).message}`);
    }
    return startSession(c, who);
  });

  app.post('/auth/dev', async (c) => {
    if (!cfg.devAuth) fail(404, 'not found');
    const { name } = await body<{ name?: string }>(c);
    const n = (name ?? 'dev').slice(0, 60);
    return startSession(c, { provider: 'dev', sub: n, name: n });
  });

  // local development and e2e tests only (DEV_AUTH): let time pass on one of
  // your beaches (docs/LIVE_SIM.md), as if nobody had opened it for `hours`
  app.post('/dev/age-beach', requireUser, async (c) => {
    if (!cfg.devAuth) fail(404, 'not found');
    const { hours, beach } = await body<{ hours?: number; beach?: string }>(c);
    const h = Math.max(0, Math.min(24 * 60, Number(hours) || 0));
    const id = await mine(c, beach);
    await db.query('UPDATE beach SET simulated_until = $2, here_until = NULL WHERE id = $1', [id, liveClock() - h * 3600000]);
    return c.body(null, 204);
  });

  // local development and e2e tests only (DEV_AUTH): give yourself an item
  app.post('/dev/grant', requireUser, async (c) => {
    if (!cfg.devAuth) fail(404, 'not found');
    const { item, quantity } = await body<{ item?: string; quantity?: number }>(c);
    if (!item || !/^[a-z0-9-]{1,32}$/.test(item)) fail(400, 'bad item');
    await db.query("INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at) VALUES ($1, $2, $3, 'gift', $4)", [
      c.get('user').id,
      item,
      Math.max(1, Math.min(10, Number(quantity) || 1)),
      cfg.now?.() ?? Date.now(),
    ]);
    return c.body(null, 204);
  });

  app.post('/auth/logout', requireUser, async (c) => {
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [c.get('tokenHash')]);
    return c.body(null, 204);
  });

  app.get('/me', requireUser, (c) => c.json({ user: c.get('user') }));

  // ---------------------------------------------------------------- edit sessions
  // One active editor per person (docs/EDIT_SESSIONS.md). An instance
  // claims a token when it opens your beach for editing; claiming replaces
  // the stored token, so every older instance is fenced at once. The token
  // lives only in that instance's memory (never localStorage, which two
  // tabs share), and a new tab, device or app sign-in claims its own.
  // GET is the heartbeat: the holder asks every 30 s whether it still is
  // the editor, and learns promptly when another instance took over.
  const withPlayerWriteLock = <T>(userId: string, fn: (tx: Db) => Promise<T>): Promise<T> =>
    db.withTransaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [userId]);
      return fn(tx);
    });

  app.post('/edit-session', requireUser, async (c) => {
    const me = c.get('user').id;
    const token = crypto.randomUUID();
    const wasEditing = await withPlayerWriteLock(me, async (tx) => {
      const prev = await tx.query('SELECT 1 FROM edit_sessions WHERE user_id = $1', [me]);
      await tx.query(
        `INSERT INTO edit_sessions (user_id, token, created_at, last_seen_at) VALUES ($1, $2, $3, $3)
         ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, created_at = EXCLUDED.created_at, last_seen_at = EXCLUDED.last_seen_at`,
        [me, token, Date.now()],
      );
      return prev.length > 0;
    });
    if (wasEditing) logEvent('edit_takeover', {}, 'INFO');
    return c.json({ token });
  });

  app.get('/edit-session', requireUser, async (c) => {
    const sent = c.req.header('X-Edit-Token');
    if (!sent) return c.json({ active: false });
    const rows = await db.query<{ token: string }>('SELECT token FROM edit_sessions WHERE user_id = $1', [c.get('user').id]);
    const active = !!rows[0] && rows[0].token === sent;
    if (active) await db.query('UPDATE edit_sessions SET last_seen_at = $2 WHERE user_id = $1', [c.get('user').id, Date.now()]);
    return c.json({ active });
  });

  /** Refuse a beach edit from an instance that isn't the current editor. */
  const requireEditToken = async (c: Context<Env>, q: Db = db): Promise<void> => {
    const sent = c.req.header('X-Edit-Token');
    // no token at all: an app from before edit sessions — it can't prove it
    // is the editor, so it reloads to save (the same 426 as other old apps)
    if (!sent) outdated(c, 'no X-Edit-Token');
    const rows = await q.query<{ token: string }>('SELECT token FROM edit_sessions WHERE user_id = $1', [c.get('user').id]);
    if (!rows[0] || rows[0].token !== sent) fail(409, 'fenced');
  };
  /**
   * Run a beach write as one transaction holding the player's row lock, so
   * saves and restores of one player's beaches go one at a time, and a
   * takeover (POST /edit-session) can't land between the token check and
   * the write (specs/tla/BeachEditing.tla: OnlyEditorWrites, WithinBag).
   */
  const asEditor = <T>(c: Context<Env>, fn: (tx: Db) => Promise<T>): Promise<T> =>
    withPlayerWriteLock(c.get('user').id, async (tx) => {
      await requireEditToken(c, tx);
      return fn(tx);
    });

  // Cross-platform account linking (docs/STEAM.md): generate a 10-minute code on
  // your existing device (web/iOS/Android), then enter it on a fresh Steam
  // account so both share the same user_id, beaches, inventory, and purchases.
  // Since account merging, the redeeming account need not be empty: its
  // beaches, items, credit, and purchases fold into the code owner's account
  // (server/src/accountMerge.ts), after a preview the user confirms.
  const LINK_CODE_TTL_MS = 10 * 60 * 1000;
  app.post('/account/link-code', requireUser, async (c) => {
    const now = (cfg.now ?? Date.now)();
    const userId = c.get('user').id;
    const code = newLinkCode();
    const codeHash = await hashToken(normalizeLinkCode(code));
    const expiresAt = now + LINK_CODE_TTL_MS;
    await db.query('DELETE FROM account_link_codes WHERE user_id = $1 OR expires_at <= $2', [userId, now]);
    await db.query('INSERT INTO account_link_codes (code_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
      codeHash,
      userId,
      now,
      expiresAt,
    ]);
    return c.json({ code, expiresAt });
  });

  /** The account a link code belongs to (the merge survivor). */
  const lookupLinkCode = async (code: string, now: number): Promise<{ targetId: string; codeHash: string }> => {
    const normalized = normalizeLinkCode(code ?? '');
    if (normalized.length !== 8) fail(400, 'enter the 8-character link code');
    const codeHash = await hashToken(normalized);
    const rows = await db.query<{ user_id: string; expires_at: string }>(
      'SELECT user_id, expires_at FROM account_link_codes WHERE code_hash = $1',
      [codeHash],
    );
    const row = rows[0];
    if (!row || Number(row.expires_at) <= now) fail(404, 'that link code is invalid or has expired');
    return { targetId: row.user_id, codeHash };
  };

  /** What redeeming this code would do — shown before the user confirms. */
  app.post('/account/link/preview', requireUser, async (c) => {
    const now = (cfg.now ?? Date.now)();
    const { code } = await body<{ code?: string }>(c);
    const { targetId } = await lookupLinkCode(code ?? '', now);
    const currentId = c.get('user').id;
    if (targetId === currentId) fail(400, 'this device is already signed into that account');
    const plan = await db.withTransaction((tx) => planAccountMerge(tx, targetId, currentId, now, BEACH_CAP));
    return c.json({ preview: plan.preview });
  });

  app.post('/account/link', requireUser, async (c) => {
    const now = (cfg.now ?? Date.now)();
    const { code, confirmed } = await body<{ code?: string; confirmed?: boolean }>(c);
    const { targetId, codeHash } = await lookupLinkCode(code ?? '', now);
    const currentId = c.get('user').id;
    if (targetId === currentId) fail(400, 'this device is already signed into that account');

    // Plan inside the transaction, holding both user rows, so nothing can
    // change under the merge; the code is consumed in the same transaction.
    // A non-empty merge needs confirmed: true — the client shows the
    // preview first. The code is only spent once the merge is going ahead.
    const outcome = await db.withTransaction(async (tx) => {
      for (const id of [targetId, currentId].sort()) {
        await tx.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [id]);
      }
      const plan = await planAccountMerge(tx, targetId, currentId, now, BEACH_CAP);
      if (plan.preview.blocks.length) return { blocked: plan.preview };
      if (!plan.preview.empty && confirmed !== true) return { needsConfirm: plan.preview };
      const claimed = await tx.query<{ user_id: string }>(
        'DELETE FROM account_link_codes WHERE code_hash = $1 AND expires_at > $2 RETURNING user_id',
        [codeHash, now],
      );
      if (!claimed.length || claimed[0].user_id !== targetId) return { gone: true };
      await executeAccountMerge(tx, plan, now);
      return { merged: plan.preview };
    });
    if (outcome.blocked) return c.json({ error: outcome.blocked.blocks.join('; '), preview: outcome.blocked }, 409);
    if (outcome.needsConfirm) {
      return c.json({ error: 'this account has saved data: confirm the merge first', preview: outcome.needsConfirm }, 409);
    }
    if (outcome.gone) fail(404, 'that link code is invalid or has expired');

    const targetRows = await db.query<User>('SELECT id, name FROM users WHERE id = $1', [targetId]);
    const targetUser = targetRows[0];
    if (!targetUser) fail(404, 'target account no longer exists');

    const token = newSessionToken();
    await db.query('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
      await hashToken(token),
      targetUser.id,
      now,
      now + SESSION_DAYS * 86400000,
    ]);
    return c.json({ token, user: targetUser, merged: outcome.merged });
  });

  app.delete('/account', requireUser, async (c) => {
    const userId = c.get('user').id;
    if (revokeApple) {
      const tokens = await db.query<{ apple_refresh_token: string; apple_client_id: string }>(
        "SELECT apple_refresh_token, apple_client_id FROM user_identities WHERE user_id = $1 AND provider = 'apple' AND apple_refresh_token IS NOT NULL AND apple_client_id IS NOT NULL",
        [userId],
      );
      for (const row of tokens) {
        try {
          await revokeApple(row.apple_refresh_token, row.apple_client_id);
          logEvent('apple_token_revoked', { clientId: row.apple_client_id });
        } catch (e) {
          logEvent('apple_token_revoke_failed', { message: (e as Error).message }, 'WARNING');
        }
      }
    }
    // sessions, beach and neighbor links go with it (ON DELETE CASCADE)
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    return c.body(null, 204);
  });

  // Attach another sign-in to the account you're already signed into, so
  // the same beaches, inventory and purchases follow you across Google,
  // Apple and Steam. Unlike POST /account/link (which folds a whole fresh
  // account in), this never moves data: the second identity is attached
  // before it ever creates its own account, so there is nothing to merge.
  // The providers are the same ones /auth/* takes, verified the same way.
  const ATTACHABLE = ['google', 'apple', 'steam'] as const;
  type AttachableProvider = (typeof ATTACHABLE)[number];
  const identitiesOf = async (userId: string): Promise<AttachableProvider[]> => {
    const rows = await db.query<{ provider: string }>(
      'SELECT provider FROM user_identities WHERE user_id = $1 ORDER BY provider',
      [userId],
    );
    return rows.map((r) => r.provider).filter((p): p is AttachableProvider => (ATTACHABLE as readonly string[]).includes(p));
  };
  app.get('/api/account/identities', requireUser, async (c) => {
    return c.json({ identities: await identitiesOf(c.get('user').id) });
  });
  app.post('/api/account/identities', requireUser, async (c) => {
    const { provider, credential, name, authorizationCode, redirectUri } = await body<{
      provider?: string;
      credential?: string;
      name?: string;
      authorizationCode?: string;
      redirectUri?: string;
    }>(c);
    if (!provider || !(ATTACHABLE as readonly string[]).includes(provider)) fail(400, 'unknown provider: use google, apple, or steam');
    if (!credential) fail(400, 'missing credential');
    let who: VerifiedIdentity;
    try {
      if (provider === 'google') who = await verifyGoogle(credential!, cfg.googleClientIds);
      else if (provider === 'apple') who = await verifyApple(credential!, cfg.appleClientIds, name ?? '');
      else {
        if (!cfg.steamAuth) fail(404, 'steam sign-in is not enabled');
        who = await verifySteam(credential!, cfg.steamAuth!, name ?? '');
      }
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return fail(401, `${provider} sign-in failed: ${(e as Error).message}`);
    }
    const me = c.get('user').id;
    const attached = await db.withTransaction(async (tx) => {
      const rows = await tx.query<{ user_id: string }>(
        'SELECT user_id FROM user_identities WHERE provider = $1 AND provider_sub = $2',
        [who.provider, who.sub],
      );
      const owner = rows[0]?.user_id;
      if (owner && owner !== me) {
        fail(
          409,
          `that ${provider} sign-in is already linked to another Beech account. To use it here, sign in with that account and delete this one first, or link this account to it with a link code from the other device.`,
        );
      }
      if (owner === me) return false;
      await tx.query(
        'INSERT INTO user_identities (provider, provider_sub, user_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [who.provider, who.sub, me, (cfg.now ?? Date.now)()],
      );
      return true;
    });
    // a Google attach refreshes the verified email, as a Google sign-in does
    if (attached && 'email' in who && who.email) {
      await db.query('UPDATE users SET email = $1 WHERE id = $2 AND (email IS NULL OR email <> $1)', [who.email, me]);
    }
    if (who.provider === 'apple') {
      await saveAppleRefreshToken(who.sub, who.clientId, authorizationCode, redirectUri);
    }
    return c.json({ identities: await identitiesOf(me) });
  });

  // ---------------------------------------------------------------- beaches
  // A person owns one or more beaches (docs/MULTI_BEACH.md). Their home beach
  // has their user id as its id. /api/beach is the home beach, for older apps.
  const sendBeach = async (c: Context<Env>, beachId: string) => {
    // the sea kept working while nobody had it open (docs/LIVE_SIM.md)
    try {
      await live.ensure(beachId);
    } catch (e) {
      logEvent('catchup_failed', { beach: beachId, error: String(e) }, 'ERROR');
    }
    const loadStart = performance.now();
    const rows = await db.query<{
      location: string;
      nx: number;
      ny: number;
      version: number;
      updated_at: string;
      epoch: number;
      simulated_until: string | null;
      sand: unknown;
    }>('SELECT location, nx, ny, version, updated_at, epoch, simulated_until, sand FROM beach WHERE id = $1 AND sand IS NOT NULL', [beachId], 'beach.load');
    const row = rows[0];
    if (!row) return c.json({ error: 'no saved beach yet' }, 404);
    const bytes = toBytes(row.sand);
    // Payload size + DB time, so a slow load can be correlated with the
    // beach's bytes (no ids — the load path is per-beach by construction).
    logEvent('beach_load', { bytes: bytes.byteLength, duration_ms: Math.round((performance.now() - loadStart) * 10) / 10 });
    return new Response(bytes as BodyInit, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Beach-Location': row.location,
        'X-Beach-Nx': String(row.nx),
        'X-Beach-Ny': String(row.ny),
        'X-Beach-Version': String(row.version),
        'X-Beach-Updated': String(row.updated_at),
        'X-Beach-Epoch': String(row.epoch),
        'X-Beach-Simulated-Until': String(row.simulated_until ?? row.updated_at),
      },
    });
  };

  /** An out-of-date app tried to save: refuse (426, the app offers a reload), and log which build it was. */
  const outdated = (c: Context<Env>, why: string): never => {
    logEvent('stale_app_save', { why, build: (c.req.header('X-App-Build') ?? 'unknown').slice(0, 40) }, 'WARNING');
    return fail(426, 'this app is out of date: reload to save');
  };

  /**
   * Write the beach as it is now into its one auto checkpoint slot
   * (migration 13): the new snapshot replaces the previous auto checkpoint
   * rather than accumulating, it never takes a named slot, and its bytes
   * are the same one slot already counted toward the 16 MB total. Returns
   * false when nothing was written (no saved beach yet, the store full, an
   * unreadable old save) — the caller decides whether that matters.
   */
  const writeAutoCheckpoint = async (beachId: string, userId: string, now: number, name: string): Promise<boolean> => {
    const cur = (
      await db.query<{ sand: unknown }>('SELECT sand FROM beach WHERE id = $1 AND sand IS NOT NULL', [beachId])
    )[0];
    if (!cur) return false; // first save: nothing to keep
    const bytes = toBytes(cur.sand);
    // the one auto slot's bytes already count toward the total; only
    // snapshot if the replacement still fits
    const use = (
      await db.query<{ total: string; auto_bytes: string }>(
        `SELECT COALESCE(SUM(bytes), 0) AS total,
                COALESCE(SUM(bytes) FILTER (WHERE kind = 'auto' AND from_beach = $2), 0) AS auto_bytes
           FROM checkpoints WHERE owner_id = $1`,
        [userId, beachId],
      )
    )[0];
    if (Number(use.total) - Number(use.auto_bytes) + bytes.byteLength > CHECKPOINT_BYTES_PER_USER) return false;
    let items: Record<string, number> = {};
    let objects = 0;
    try {
      ({ items, objects } = inspectBlob(bytes));
    } catch {
      /* an unreadable old save: keep the bytes, uncounted */
    }
    await db.query(
      `INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, from_name, location, nx, ny, sand, bytes, items, objects, created_at, origin_beach_id)
       SELECT $1, owner_id, $2, 'auto', 'beach', id, name, location, nx, ny, sand, octet_length(sand), $3, $4, $5, id
         FROM beach WHERE id = $6 AND sand IS NOT NULL
       ON CONFLICT (from_beach) WHERE kind = 'auto' DO UPDATE SET
         name = EXCLUDED.name, from_name = EXCLUDED.from_name, location = EXCLUDED.location, nx = EXCLUDED.nx, ny = EXCLUDED.ny,
         sand = EXCLUDED.sand, bytes = EXCLUDED.bytes, items = EXCLUDED.items, objects = EXCLUDED.objects, created_at = EXCLUDED.created_at,
         origin_beach_id = EXCLUDED.origin_beach_id`,
      [crypto.randomUUID(), name, JSON.stringify(items), objects, now, beachId],
    );
    return true;
  };

  /**
   * The daily auto-save (docs/CHECKPOINTS.md): before a save overwrites a
   * beach, keep the beach as it is now — but at most once per beach per day.
   * "Last one" is the beach's most recent `auto` checkpoint, whatever made
   * it: a daily auto-save, a "before restoring" copy, a "before import"
   * copy, or a "before big edit" copy all reset the clock, so a restore's
   * undo copy — and a big edit's pre-edit copy — is safe for a day after
   * it was made. It reuses the beach's one auto slot (migration 13).
   *
   * Fail-safe the other way: anything wrong here — no saved beach yet (a
   * first save), an unreadable old save, the 16 MB total full — skips the
   * snapshot and the beach update goes ahead. A snapshot must never lose a
   * save, and a failed snapshot is logged, not surfaced: the player did
   * nothing wrong, and the next save retries it.
   */
  const AUTO_SAVE_MS = 24 * 3600 * 1000;
  const maybeAutoSave = async (beachId: string, userId: string, now: number): Promise<void> => {
    try {
      const last = (
        await db.query<{ created_at: string }>(
          "SELECT created_at FROM checkpoints WHERE from_beach = $1 AND kind = 'auto' ORDER BY created_at DESC LIMIT 1",
          [beachId],
        )
      )[0];
      if (last && now - Number(last.created_at) < AUTO_SAVE_MS) return;
      if (!(await writeAutoCheckpoint(beachId, userId, now, `Auto-save ${new Date(now).toISOString().slice(0, 10)}`))) return;
    } catch {
      logEvent('auto_checkpoint_failed', { reason: 'daily' }, 'WARNING');
    }
  };

  /**
   * The large-edit checkpoint (docs/CHECKPOINTS.md): before a save that
   * reshapes a tenth of the beach, moves fifty things, or changes the grid
   * lands, keep the beach as it is now in the same one auto slot — even if
   * a daily auto-save fired an hour ago. The 24 h rule does not apply here:
   * a big edit is exactly when the old beach is most at risk, and the
   * snapshot counts as the day's auto checkpoint (see maybeAutoSave), so
   * the pre-edit copy is not overwritten again for a day.
   *
   * Failure, like the daily save, never blocks the edit: the save goes
   * ahead, the failure is logged with its reason, and the save's response
   * says the safety copy was not kept (`largeEditCheckpoint: false`), so
   * the app can tell the player. Blocking would strand the edit in the app
   * for a storage limit the player did nothing to cause, and a failed
   * snapshot here usually means the store is full or the old save is
   * unreadable — neither is fixed by refusing the new beach.
   */
  const maybeLargeEditSave = async (
    beachId: string,
    userId: string,
    now: number,
    newBytes: Uint8Array,
  ): Promise<{ large: boolean; snapshotted: boolean }> => {
    try {
      const cur = (
        await db.query<{ sand: unknown }>('SELECT sand FROM beach WHERE id = $1 AND sand IS NOT NULL', [beachId])
      )[0];
      if (!cur) return { large: false, snapshotted: false }; // first save: nothing to keep
      const diff = sandDiff(toBytes(cur.sand), newBytes);
      if (!diff.large) return { large: false, snapshotted: false };
      const snapshotted = await writeAutoCheckpoint(beachId, userId, now, `Before big edit ${new Date(now).toISOString().slice(0, 10)}`);
      if (!snapshotted) logEvent('auto_checkpoint_failed', { reason: 'large-edit' }, 'WARNING');
      return { large: true, snapshotted };
    } catch {
      logEvent('auto_checkpoint_failed', { reason: 'large-edit' }, 'WARNING');
      return { large: true, snapshotted: false };
    }
  };

  /**
   * What a save holds beyond the bag. Only counts that go up are checked,
   * so most saves cost no query. Whatever this beach already holds stays
   * allowed (things since gifted away, refunded or expired keep their
   * place), and the app saves its other beaches and retries once on a
   * refusal, which settles a move across a seam whose two saves arrived in
   * the wrong order (docs/MULTI_BEACH.md).
   */
  const overBag = async (user: string, beachId: string, placed: Record<string, number>, q: Db = db): Promise<Short[]> => {
    const row = (await q.query<{ items: Record<string, number> | string | null }>('SELECT items FROM beach WHERE id = $1', [beachId]))[0];
    const stored = jsonMap(row?.items);
    if (nothingGrew(placed, stored)) return [];
    const owned = await ownedItems(user, q);
    const elsewhere = await itemsElsewhere(user, beachId, q);
    return saveShort(placed, stored, owned, elsewhere);
  };

  const saveBeach = async (c: Context<Env>, beachId: string) => {
    const location = (c.req.header('X-Beach-Location') ?? '').slice(0, 40);
    const nx = Number(c.req.header('X-Beach-Nx'));
    const ny = Number(c.req.header('X-Beach-Ny'));
    if (!/^[a-z0-9-]+$/.test(location)) fail(400, 'bad X-Beach-Location');
    if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 8 || ny < 8 || nx * ny > MAX_CELLS) fail(400, 'bad grid size');
    // the world is square (32 m x 32 m). A non-square grid is an out-of-date app
    // (the old 32 x 24 world): its save would squeeze the sand and shift the
    // things on it, so refuse it until the app reloads.
    if (nx !== ny) outdated(c, 'non-square grid');
    if (Number(c.req.header('Content-Length') ?? 0) > MAX_BEACH_BYTES) fail(413, 'beach too large');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BEACH_BYTES) fail(413, 'beach too large');
    // what's on it is counted here, never taken from the app (X-Beach-Items is
    // ignored): the bag is "owned minus placed across your beaches", so an
    // under-count would free things to place twice. Garbage, or a blob whose
    // grid isn't the one in its headers, would break every viewer and the
    // server's catch-up, so it's refused.
    let placed: Record<string, number>;
    try {
      const info = inspectBlob(bytes, { strictObjects: true });
      if (info.nx !== nx || info.ny !== ny) fail(400, 'grid size does not match the saved beach');
      placed = info.items;
    } catch (e) {
      if (e instanceof BadBlob) return fail(400, `not a saved beach (${e.message})`);
      throw e;
    }
    const now = Date.now();
    // only the current editor may save: an older tab or device, or an app too
    // old to send the token, must not overwrite what the editor has since done
    await requireEditToken(c);
    // a save made before a restore (another device still showing the old
    // sand) mustn't overwrite it. The epoch header is still checked when
    // sent (every current app sends it); the edit token above is what closes
    // the old hole — a save with neither token nor epoch is refused outright.
    // Apps from before the object limit went up (OLD_MAX_OBJECTS) send no
    // X-Beach-Max. Loading a beach that holds more, they kept only the first
    // 400, so their save would drop the rest for good: refuse it ("reload").
    if (!c.req.header('X-Beach-Max')) {
      const cur = (await db.query<{ sand: unknown }>('SELECT sand FROM beach WHERE id = $1 AND sand IS NOT NULL', [beachId]))[0];
      if (cur && countObjects(toBytes(cur.sand)) > OLD_MAX_OBJECTS) outdated(c, 'no X-Beach-Max');
    }
    const epochHeader = c.req.header('X-Beach-Epoch');
    const epoch = epochHeader === undefined || epochHeader === '' ? null : Number(epochHeader);
    if (epoch !== null && !Number.isInteger(epoch)) fail(400, 'bad X-Beach-Epoch');
    // a save from before a restore must be refused before anything is
    // snapshotted: the pre-edit copy would overwrite the restore's undo
    // copy in the one auto slot, and then the save itself is refused — the
    // beach the player could have gone back to is gone. The UPDATE's WHERE
    // below stays as the race backstop (a restore landing between this
    // check and the UPDATE).
    if (epoch !== null) {
      const cur = (await db.query<{ epoch: number }>('SELECT epoch FROM beach WHERE id = $1', [beachId]))[0];
      if (cur && Number(cur.epoch) > epoch) fail(409, 'restored');
    }
    // within the bag: a save can't put more of a thing on this beach than
    // you own, less what's on your other beaches (as a restore checks)
    const short = await overBag(c.get('user').id, beachId, placed);
    if (short.length) {
      logEvent('save_over_bag', { items: short.length }, 'WARNING');
      return c.json({ error: 'short', short }, 409);
    }
    // a big edit (a tenth of the sand reshaped, fifty things moved, a new
    // grid) keeps the beach as it is now first, whatever the daily clock
    // says; anything smaller gets the daily auto-save instead. Neither ever
    // blocks the save (see maybeLargeEditSave / maybeAutoSave).
    const big = await maybeLargeEditSave(beachId, c.get('user').id, now, bytes);
    if (!big.large) await maybeAutoSave(beachId, c.get('user').id, now);
    const saveStart = performance.now();
    // the checks above answer most refusals before any snapshot is taken;
    // the token and the bag are checked again here, with the write
    const written = await asEditor(c, async (tx) => {
      const shortNow = await overBag(c.get('user').id, beachId, placed, tx);
      if (shortNow.length) return { short: shortNow, rows: [] };
      const rows = await tx.query<{ version: number; epoch: number }>(
        `UPDATE beach SET location = $2, nx = $3, ny = $4, version = version + 1, updated_at = $5, sand = $6, items = $7, simulated_until = $9
          WHERE id = $1 AND ($8::int IS NULL OR epoch <= $8::int) RETURNING version, epoch`,
        [beachId, location, nx, ny, now, bytes, JSON.stringify(placed), epoch, liveClock()],
        'beach.save',
      );
      return { short: [] as Short[], rows };
    });
    if (written.short.length) {
      logEvent('save_over_bag', { items: written.short.length }, 'WARNING');
      return c.json({ error: 'short', short: written.short }, 409);
    }
    const rows = written.rows;
    // Payload size + DB time, so a slow PUT /sand can be correlated with
    // the beach's bytes (no ids — the save path is per-beach by construction).
    logEvent('beach_save', { bytes: bytes.byteLength, duration_ms: Math.round((performance.now() - saveStart) * 10) / 10 });
    if (!rows[0]) {
      if ((await db.query('SELECT 1 FROM beach WHERE id = $1', [beachId])).length) fail(409, 'restored');
      fail(404, 'no such beach');
    }
    return c.json({
      version: rows[0].version,
      updatedAt: now,
      epoch: Number(rows[0].epoch),
      ...(big.large ? { largeEdit: true, largeEditCheckpoint: big.snapshotted } : {}),
    });
  };

  app.get('/beach', requireUser, async (c) => sendBeach(c, await homeOf(c.get('user').id)));
  app.put('/beach', requireUser, async (c) => saveBeach(c, await homeOf(c.get('user').id)));

  // The owner's app has this beach open and is simulating it (docs/LIVE_SIM.md):
  // a heartbeat every 20 s keeps the server's catch-up off it. The reply's
  // epoch tells the app if the beach changed under it (a catch-up or restore
  // that ran while it was in the background): it reloads.
  const here = async (c: Context<Env>, beachId: string) => {
    const r = await live.here(beachId);
    if (!r) fail(404, 'no such beach');
    return c.json(r);
  };
  app.post('/beach/here', requireUser, async (c) => here(c, await homeOf(c.get('user').id)));

  // "While you were away" (docs/LIVE_SIM.md): what the sea did to one of your
  // beaches since you last opened it, as one summary. `seen` marks it read.
  const away = async (c: Context<Env>, beachId: string) => {
    const rows = await db.query<{
      from_at: string | null;
      to_at: string | null;
      tides: string | null;
      lost: string | null;
      brought: string | null;
      n: string;
      checkpoint: string | null;
    }>(
      `SELECT MIN(e.from_at) AS from_at, MAX(e.to_at) AS to_at, SUM(e.tides) AS tides, SUM(e.lost) AS lost, SUM(e.brought) AS brought,
              COUNT(*) AS n,
              (SELECT e2.checkpoint FROM beach_events e2 JOIN checkpoints k ON k.id = e2.checkpoint
                WHERE e2.beach_id = $1 AND e2.created_at > COALESCE(b.owner_seen_at, 0) ORDER BY e2.id DESC LIMIT 1) AS checkpoint
         FROM beach b JOIN beach_events e ON e.beach_id = b.id
        WHERE b.id = $1 AND e.created_at > COALESCE(b.owner_seen_at, 0)
        GROUP BY b.id, b.owner_seen_at`,
      [beachId],
    );
    const r = rows[0];
    if (!r || Number(r.n) === 0) return c.json({ away: null });
    return c.json({
      away: {
        from: Number(r.from_at),
        to: Number(r.to_at),
        highTides: Number(r.tides),
        lost: Number(r.lost),
        broughtIn: Number(r.brought),
        // "Before the tide": put it back as it was
        checkpoint: r.checkpoint,
      },
    });
  };
  const seen = async (c: Context<Env>, beachId: string) => {
    await db.query('UPDATE beach SET owner_seen_at = $2 WHERE id = $1', [beachId, liveClock()]);
    return c.body(null, 204);
  };
  app.get('/beach/away', requireUser, async (c) => away(c, await homeOf(c.get('user').id)));
  app.post('/beach/away/seen', requireUser, async (c) => seen(c, await homeOf(c.get('user').id)));

  /** how many beaches you may have: one, plus each extra beach you own */
  const allowance = async (user: string, q: Db = db): Promise<number> => {
    const rows = await q.query<{ n: string | null }>(
      `SELECT SUM(quantity) AS n FROM inventory WHERE user_id = $1 AND item_id = 'beach' AND (expires_at IS NULL OR expires_at > $2)`,
      [user, Date.now()],
    );
    return Math.min(BEACH_CAP, 1 + Number(rows[0]?.n ?? 0));
  };
  /** my home beach (its id is mine unless I've made another beach home) */
  const homeOf = async (user: string): Promise<string> =>
    (await db.query<{ id: string }>('SELECT id FROM beach WHERE owner_id = $1 ORDER BY home DESC, created_at LIMIT 1', [user]))[0]?.id ?? user;
  /** one of my beaches (404 if it isn't mine); none named: my home beach */
  const mine = async (c: Context<Env>, id: string | undefined): Promise<string> => {
    const me = c.get('user').id;
    if (!id) return homeOf(me);
    if (id === me) return me;
    if (!/^[0-9a-f-]{36}$/.test(id)) fail(404, 'no such beach');
    const rows = await db.query('SELECT 1 FROM beach WHERE id = $1 AND owner_id = $2', [id, me]);
    if (!rows.length) fail(404, 'no such beach');
    return id;
  };

  // ---------------------------------------------------------------- neighbors
  // Mutual: you ask someone to be on your left (or right); when they accept,
  // you're on their right (or left). One person per side, both ways.
  const parseSide = (c: Context<Env>): Side => {
    const s = c.req.param('side') as Side;
    if (!SIDES.includes(s)) fail(400, 'side must be left or right');
    return s;
  };
  const opposite = (s: Side): Side => (s === 'left' ? 'right' : 'left');

  const { nodeById, nodeByCode, linked, walk } = shoreGraph(db);

  /**
   * Link `b` onto `a`'s `side` (and `a` onto `b`'s other side). One
   * transaction holding both beaches' locks: the callers' checks run before
   * it, so two beaches already linked (an accept and an ask crossing) would
   * otherwise end up neighbors on both sides (specs/tla/Neighbors.tla,
   * LinkedOnce). The table's keys catch a side taken in the meantime.
   */
  const link = async (a: string, side: Side, b: string) => {
    const now = Date.now();
    await db.withTransaction(async (tx) => {
      // in id order, so two links between the same beaches can't deadlock
      for (const id of [a, b].sort()) await tx.query('SELECT id FROM beach WHERE id = $1 FOR NO KEY UPDATE', [id]);
      const paired = await tx.query('SELECT 1 FROM neighbors WHERE beach_id = $1 AND neighbor_beach_id = $2', [a, b]);
      if (paired.length) fail(409, 'you’re already neighbors');
      try {
        await tx.query(
          `WITH l1 AS (INSERT INTO neighbors (beach_id, side, neighbor_beach_id, created_at) VALUES ($1, $2, $3, $5) RETURNING 1),
                l2 AS (INSERT INTO neighbors (beach_id, side, neighbor_beach_id, created_at) VALUES ($3, $4, $1, $5) RETURNING 1)
           SELECT (SELECT COUNT(*) FROM l1) + (SELECT COUNT(*) FROM l2) AS n`,
          [a, side, b, opposite(side), now],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505') fail(409, 'that side was just taken');
        throw e;
      }
      // requests that can't happen any more: these two, and anyone else asking for the sides now taken
      await tx.query(
        `DELETE FROM neighbor_requests
          WHERE (from_beach = $1 AND (side = $2 OR to_beach = $3)) OR (from_beach = $3 AND (side = $4 OR to_beach = $1))
             OR (to_beach = $1 AND side = $4) OR (to_beach = $3 AND side = $2)`,
        [a, side, b, opposite(side)],
      );
    });
  };

  app.get('/neighbors', requireUser, async (c) => {
    const me = await mine(c, c.req.query('beach'));
    const [self, left, right, outgoing, incoming] = await Promise.all([
      nodeById(me),
      linked(me, 'left'),
      linked(me, 'right'),
      db.query<NodeRow & { side: Side }>(
        `SELECT r.side, ${NODE} FROM neighbor_requests r JOIN ${BEACH} ON b.id = r.to_beach WHERE r.from_beach = $1`,
        [me],
      ),
      db.query<NodeRow & { side: Side }>(
        `SELECT r.side, ${NODE} FROM neighbor_requests r JOIN ${BEACH} ON b.id = r.from_beach
          WHERE r.to_beach = $1 ORDER BY r.created_at DESC LIMIT 50`,
        [me],
      ),
    ]);
    const out = (s: Side) => {
      const r = outgoing.find((x) => x.side === s);
      return r ? beachJson(r) : null;
    };
    return c.json({
      beach: me,
      code: self?.code,
      left: left ? beachJson(left) : null,
      right: right ? beachJson(right) : null,
      // who you've asked, per side of your beach
      asked: { left: out('left'), right: out('right') },
      // who's asking you; `side` is where they'd be on YOUR beach
      requests: incoming.map((r) => ({ ...beachJson(r), side: opposite(r.side) })),
      // the inbox, for the app's poll (docs/INBOX_NOTIFICATIONS.md)
      inbox: await inboxSummary(c.get('user').id),
    });
  });

  // ask someone to be on your `side` (if they already asked for the same, or
  // it's another of your own beaches, you're linked now)
  app.put('/neighbors/:side', requireUser, async (c) => {
    const side = parseSide(c);
    const me = await mine(c, c.req.query('beach'));
    const { code } = await body<{ code?: string }>(c);
    if (normalizeCode(code ?? '').length !== 6) fail(400, 'neighbor codes are 6 letters and numbers');
    const them = await nodeByCode(code!);
    if (!them) fail(404, 'no beach has that code');
    if (them!.id === me) fail(400, "that's this beach's own code");
    if (await linked(me, side)) fail(409, `you already have a ${side} neighbor: move them away first`);
    if ((await linked(me, opposite(side)))?.id === them!.id) fail(409, `they're already your ${opposite(side)} neighbor`);
    if (await linked(them!.id, opposite(side))) fail(409, `their ${opposite(side)} side is taken`);
    if (await blocked(them!.owner_id, c.get('user').id)) fail(403, 'that didn’t go through');
    const theirs = await db.query('SELECT 1 FROM neighbor_requests WHERE from_beach = $1 AND to_beach = $2 AND side = $3', [
      them!.id,
      me,
      opposite(side),
    ]);
    if (theirs.length || them!.owner_id === c.get('user').id) {
      await link(me, side, them!.id);
      // they asked first: tell them it happened (not for your own beaches)
      if (them!.owner_id !== c.get('user').id) await inboxRow(them!.owner_id, 'neighbor_linked', c.get('user').id, them!.id, { code: (await nodeById(me))?.code });
      return c.json({ status: 'linked', neighbor: beachJson(them!) });
    }
    // the request and its inbox row in one statement
    const mineNode = await nodeById(me);
    await db.query(
      `WITH r AS (
         INSERT INTO neighbor_requests (from_beach, to_beach, side, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (from_beach, side) DO UPDATE SET to_beach = EXCLUDED.to_beach, created_at = EXCLUDED.created_at
         RETURNING 1
       )
       INSERT INTO inbox (user_id, kind, actor_id, beach_id, payload, created_at)
       SELECT $5, 'neighbor_request', $6, $2, $7::jsonb, $4 FROM r`,
      [me, them!.id, side, Date.now(), them!.owner_id, c.get('user').id, JSON.stringify({ code: mineNode?.code, side: opposite(side), beach: them!.id })],
    );
    return c.json({ status: 'asked', neighbor: beachJson(them!) });
  });

  // accept someone's request: they go on the side they asked for
  app.post('/neighbors/requests/:code/accept', requireUser, async (c) => {
    const me = await mine(c, c.req.query('beach'));
    const them = await nodeByCode(c.req.param('code') ?? '');
    if (!them) fail(404, 'no beach has that code');
    const req = (
      await db.query<{ side: Side }>('SELECT side FROM neighbor_requests WHERE from_beach = $1 AND to_beach = $2', [them!.id, me])
    )[0];
    if (!req) fail(404, 'that request is gone');
    // they asked for me on their req.side, so they go on my other side
    if (await linked(me, opposite(req!.side))) fail(409, `your ${opposite(req!.side)} side is taken: move them away first`);
    await link(them!.id, req!.side, me);
    if (them!.owner_id !== c.get('user').id) await inboxRow(them!.owner_id, 'neighbor_linked', c.get('user').id, them!.id, { code: (await nodeById(me))?.code });
    return c.json({ side: opposite(req!.side), neighbor: beachJson(them!) });
  });

  app.delete('/neighbors/requests/:code', requireUser, async (c) => {
    const me = await mine(c, c.req.query('beach'));
    const them = await nodeByCode(c.req.param('code') ?? '');
    if (them) await db.query('DELETE FROM neighbor_requests WHERE from_beach = $1 AND to_beach = $2', [them.id, me]);
    return c.body(null, 204);
  });

  // move away from your `side` neighbor (both ends of the link go), or take back your request
  app.delete('/neighbors/:side', requireUser, async (c) => {
    const side = parseSide(c);
    const me = await mine(c, c.req.query('beach'));
    await db.query('DELETE FROM neighbors WHERE (beach_id = $1 AND side = $2) OR (neighbor_beach_id = $1 AND side = $3)', [
      me,
      side,
      opposite(side),
    ]);
    await db.query('DELETE FROM neighbor_requests WHERE from_beach = $1 AND side = $2', [me, side]);
    return c.body(null, 204);
  });

  app.get('/neighbors/:side/beach', requireUser, async (c) => {
    const side = parseSide(c);
    const n = await linked(await mine(c, c.req.query('beach')), side);
    if (!n) return c.json({ error: 'no neighbor on that side' }, 404);
    // (another of your own beaches isn't being watched by someone else)
    if (n.owner_id !== c.get('user').id) await live.viewed(n.id);
    return sendBeach(c, n.id);
  });

  // what you own beyond the free items (empty until the shop and pulls exist)
  app.get('/inventory', requireUser, async (c) => {
    const rows = await db.query<{
      item_id: string;
      quantity: number;
      source: string;
      acquired_at: string;
      expires_at: string | null;
      found_by: string | null;
      found_at: string | null;
    }>(
      `SELECT i.item_id, i.quantity, i.source, i.acquired_at, i.expires_at, u.found_by, u.found_at
         FROM inventory i LEFT JOIN unique_items u ON u.item_id = i.item_id
        WHERE i.user_id = $1 AND i.quantity > 0 AND (i.expires_at IS NULL OR i.expires_at > $2)
        ORDER BY i.acquired_at`,
      [c.get('user').id, Date.now()],
    );
    return c.json({
      items: rows.map((r) => ({
        item: r.item_id,
        quantity: Number(r.quantity),
        source: r.source,
        acquiredAt: Number(r.acquired_at),
        expiresAt: r.expires_at === null ? null : Number(r.expires_at),
        // one of a kind: who found it first
        ...(r.found_by !== null ? { foundBy: r.found_by, foundAt: Number(r.found_at) } : {}),
      })),
    });
  });

  // ---------------------------------------------------------------- the shore
  // One global beachfront. Linked neighbors make stretches of shore; past the
  // end of a stretch the shore carries on into the next stretch, in a fixed
  // order (by when each stretch's right-hand end joined), round and round. So
  // you can keep walking either way and meet everyone.
  // GET /shore?code=K7F2QX&depth=6: a beach (default: yours) and the shore each way, nearest first
  app.get('/shore', requireUser, async (c) => {
    const depth = Math.min(12, Math.max(0, Number(c.req.query('depth') ?? 6) | 0));
    const code = c.req.query('code');
    const center = code ? await nodeByCode(code) : await nodeById(await mine(c, c.req.query('beach')));
    if (!center) return c.json({ error: 'no beach with that code' }, 404);
    const { left, right } = await walk(center, ['left', 'right'], depth, new Set([center.id]));
    return c.json({ center: { ...beachJson(center), you: center.owner_id === c.get('user').id }, left, right });
  });

  // GET /shore/more?from=K7F2QX&dir=left&count=6: keep walking (infinite scroll)
  app.get('/shore/more', requireUser, async (c) => {
    const dir = c.req.query('dir') as Side;
    if (!SIDES.includes(dir)) fail(400, 'dir must be left or right');
    const count = Math.min(12, Math.max(1, Number(c.req.query('count') ?? 6) | 0));
    const from = await nodeByCode(c.req.query('from') ?? '');
    if (!from) return c.json({ error: 'no beach with that code' }, 404);
    return c.json({ beaches: (await walk(from, [dir], count, new Set([from.id])))[dir] });
  });

  // Read-only 3D shore for signed-out visitors: with `code` (from beechshore.com
  // or a shared ?visit= link), centers on that public beach and walks each way;
  // without `code`, picks a public section of the shore to render on either side
  // of a signed-out player's empty beach (`center: null`, unlinked at the edges).
  // Strictly `isPublic` (on the shore and saved); off-shore or unsaved codes
  // answer 404 (leaking nothing) and still require sign-in via /shore + /beaches/:code.
  app.get('/public/shore', async (c) => {
    const depth = Math.min(12, Math.max(0, Number(c.req.query('depth') ?? 6) | 0));
    const code = c.req.query('code');
    if (code !== undefined) {
      const center = await nodeByCode(code);
      if (!center || !isPublic(center)) return c.json({ error: 'no public beach with that code' }, 404);
      const { left, right } = await walk(center, ['left', 'right'], depth, new Set([center.id]), isPublic);
      return c.json({ center: { ...beachJson(center), you: false }, left, right });
    }
    if (depth === 0) return c.json({ center: null, left: [], right: [] });
    const anchor = (
      await db.query<NodeRow>(
        `SELECT ${NODE}
           FROM ${BEACH}
           LEFT JOIN (SELECT beach_id, COUNT(*)::int AS stars FROM favorites GROUP BY beach_id) sc ON sc.beach_id = b.id
          WHERE b.on_shore AND b.sand IS NOT NULL
          ORDER BY COALESCE(sc.stars, 0) DESC, b.updated_at DESC NULLS LAST, b.id
          LIMIT 1`,
      )
    )[0];
    if (!anchor) return c.json({ center: null, left: [], right: [] });
    const walked = await walk(anchor, ['right', 'left'], depth, new Set([anchor.id]), isPublic);
    const left = [{ ...beachJson(anchor), linked: false }, ...walked.left.slice(0, depth - 1)];
    const right = walked.right.map((b, i) => (i === 0 ? { ...b, linked: false } : b));
    return c.json({ center: null, left, right });
  });

  app.get('/public/shore/more', async (c) => {
    const dir = c.req.query('dir') as Side;
    if (!SIDES.includes(dir)) fail(400, 'dir must be left or right');
    const count = Math.min(12, Math.max(1, Number(c.req.query('count') ?? 6) | 0));
    const from = await nodeByCode(c.req.query('from') ?? '');
    if (!from || !isPublic(from)) return c.json({ error: 'no public beach with that code' }, 404);
    return c.json({ beaches: (await walk(from, [dir], count, new Set([from.id]), isPublic))[dir] });
  });

  app.get('/public/beaches/:code', async (c) => {
    const who = await nodeByCode(c.req.param('code') ?? '');
    if (!who || !isPublic(who)) return c.json({ error: 'no public beach with that code' }, 404);
    await live.viewed(who.id);
    return sendBeach(c, who.id);
  });
  // a viewer's poll (docs/LIVE_SIM.md): the beach's version, and whether its owner is on it now
  app.get('/public/beaches/:code/live', async (c) => {
    const who = await nodeByCode(c.req.param('code') ?? '');
    if (!who || !isPublic(who)) return c.json({ error: 'no public beach with that code' }, 404);
    const st = await live.status(who.id);
    return st ? c.json(st) : c.json({ error: 'no saved beach yet' }, 404);
  });

  const byCode = nodeByCode;
  const shoreJson = beachJson;


  // ---------------------------------------------------------------- favorites
  const clock = () => cfg.now?.() ?? Date.now();
  app.get('/favorites', requireUser, async (c) => {
    const rows = await db.query<NodeRow>(
      `SELECT ${NODE}
         FROM favorites f JOIN ${BEACH} ON b.id = f.beach_id
        WHERE f.user_id = $1 ORDER BY f.created_at DESC LIMIT 200`,
      [c.get('user').id],
    );
    return c.json({ favorites: rows.map(shoreJson) });
  });

  app.put('/favorites/:code', requireUser, async (c) => {
    const who = await byCode(c.req.param('code') ?? '');
    if (!who) return c.json({ error: 'no beach with that code' }, 404);
    if (who.owner_id === c.get('user').id) fail(400, "that's your own beach");
    const at = clock();
    // star_first remembers the first time, so un-starring and starring again
    // doesn't count as a new star on the rising board
    // a first-ever star from this person also tells the owner, folded into
    // one inbox row per beach per day (not from someone they've blocked)
    await db.query(
      `WITH f AS (INSERT INTO favorites (user_id, beach_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING),
            s AS (INSERT INTO star_first (user_id, beach_id, at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1)
       INSERT INTO inbox (user_id, kind, actor_id, beach_id, day, created_at)
       SELECT $4, 'star', $1, $2, $5, $3 FROM s
        WHERE NOT EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $4 AND blocked_id = $1)
       ON CONFLICT (user_id, kind, beach_id, day) WHERE day IS NOT NULL
       DO UPDATE SET id = EXCLUDED.id, count = inbox.count + 1, actor_id = EXCLUDED.actor_id, created_at = EXCLUDED.created_at, read_at = NULL`,
      [c.get('user').id, who.id, at, who.owner_id, utcDay(at)],
    );
    return c.json({ favorite: shoreJson(who) });
  });

  app.delete('/favorites/:code', requireUser, async (c) => {
    const who = await byCode(c.req.param('code') ?? '');
    if (who) await db.query('DELETE FROM favorites WHERE user_id = $1 AND beach_id = $2', [c.get('user').id, who.id]);
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- leaderboard
  // GET /leaderboard?board=all|rising&limit=50: the most-starred beaches.
  // all: stars right now. rising: star velocity, each star made in the last
  // RISING_WINDOW weighing 1/2 per RISING_HALF_LIFE of age (a star today
  // counts 1, two days ago 0.5, six days ago 0.125), counted from when that
  // person first starred the beach (star_first), so re-starring isn't new.
  // Only stars that still stand count, one per person per beach, never the
  // owner's own. Beaches off the shore, or never saved, aren't listed.
  const RISING_WINDOW = 7 * 86400000;
  const RISING_HALF_LIFE = 2 * 86400000;
  interface BoardRow extends NodeRow {
    stars: string;
    recent: string;
    velocity: string | number | null;
    starred: boolean;
  }
  app.get('/leaderboard', requireUser, async (c) => {
    const board = c.req.query('board') ?? 'all';
    if (board !== 'all' && board !== 'rising') fail(400, 'board must be all or rising');
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) | 0 || 50));
    const me = c.get('user').id;
    const now = clock();
    const since = now - RISING_WINDOW;
    const rows = await db.query<BoardRow>(
      `SELECT ${NODE},
              COUNT(*) AS stars,
              COUNT(*) FILTER (WHERE s.at > $2) AS recent,
              COALESCE(SUM(POWER(0.5, GREATEST(0, $3::bigint - s.at)::float8 / $4)) FILTER (WHERE s.at > $2), 0) AS velocity,
              BOOL_OR(f.user_id = $1) AS starred
         FROM favorites f
         JOIN ${BEACH} ON b.id = f.beach_id
         JOIN star_first s ON s.user_id = f.user_id AND s.beach_id = f.beach_id
        WHERE b.on_shore AND b.sand IS NOT NULL AND f.user_id <> b.owner_id
        GROUP BY b.id, u.name
       ${board === 'rising' ? 'HAVING COUNT(*) FILTER (WHERE s.at > $2) > 0' : ''}
        ORDER BY ${board === 'rising' ? 'velocity DESC, stars DESC' : 'stars DESC, velocity DESC'}, b.created_at, b.id
        LIMIT $5`,
      [me, since, now, RISING_HALF_LIFE, limit],
    );
    return c.json({
      board,
      window: RISING_WINDOW,
      halfLife: RISING_HALF_LIFE,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        ...beachJson(r),
        stars: Number(r.stars),
        recent: Number(r.recent),
        velocity: Math.round(Number(r.velocity) * 100) / 100,
        starred: !!r.starred,
        yours: r.owner_id === me,
      })),
    });
  });

  // ---------------------------------------------------------------- pulls
  // the pools, their published odds, and whether your free go is ready
  const rand = () => cfg.rand?.() ?? cryptoRandom();
  // when each of your machines is free again (no row: right now)
  const freeAt = async (user: string) => {
    const rows = await db.query<{ pool: string; next_at: string; count: number }>(
      'SELECT pool, next_at, count FROM pull_state WHERE user_id = $1',
      [user],
    );
    return new Map(rows.map((r) => [r.pool, { at: Number(r.next_at), count: Number(r.count) }]));
  };

  app.get('/pulls', requireUser, async (c) => {
    const now = clock();
    const state = await freeAt(c.get('user').id);
    const daily = state.get('daily');
    type PoolStatus = {
      id: string;
      name: string;
      odds: Record<Rarity, number>;
      items: Record<Rarity, string[]>;
      free: boolean;
      /** one more try for beech bucks, when the free go is gone */
      paidTry?: { bucks: number };
      nextCooldown: number;
      /** the range the rest is drawn from (claw only): short after a miss, long after a win */
      cooldown?: { min: number; max: number };
      nextFree: number;
      starter?: { rare: string; paid: string; beach: string; beachAfterMs: number };
      /** how often the claw holds on to a ball of each rarity (a miss spends the go); claw only */
      grab?: Partial<Record<Rarity, number>>;
      set?: { week: number; name: string };
    };
    const pools: PoolStatus[] = Object.values(POOLS).map((p) => {
      const st = state.get(p.id);
      return {
        id: p.id,
        name: p.name,
        odds: p.odds,
        items: p.items,
        // how often the claw holds on to a ball of each rarity (a miss spends the go)
        grab: GRAB_CHANCE,
        free: !st || st.at <= now,
        paidTry: { bucks: CLAW_EXTRA_GO_BUCKS },
        // the rest after a go is random (5 min to 3 h); older apps show this
        // one number, so it's the longest it can be
        nextCooldown: COOLDOWN_MAX_MS,
        cooldown: { min: COOLDOWN_MIN_MS, max: COOLDOWN_MAX_MS },
        nextFree: st && st.at > now ? st.at : now,
        // the fixed first prizes (kept a surprise: the app doesn't show them)
        starter: { rare: STARTER.rare.item, paid: STARTER.paid.item, beach: STARTER.beach.item, beachAfterMs: STARTER.beachAfterMs },
      };
    });
    // the vending machine: same shape, but its pool is this week's set and a
    // free ball comes once a day (next UTC midnight), not on the claw's
    // random rest. No starter gifts here.
    const set = currentSet(now);
    if (set) {
      const st = state.get('vending');
      pools.push({
        id: 'vending',
        name: 'Vending machine',
        // the vending machine has no legendary tier (its tiers are common,
        // uncommon, rare, unique); the shape stays the claw's so the app
        // renders it the same way
        odds: { ...set.odds, legendary: 0 },
        items: { ...set.items, legendary: [] },
        free: !st || st.at <= now,
        paidTry: { bucks: VENDING_EXTRA_BALL_BUCKS },
        nextCooldown: nextUtcMidnight(now) - now,
        nextFree: st && st.at > now ? st.at : now,
        set: { week: set.week, name: set.name },
      });
    }
    const [me_] = await db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [c.get('user').id]);
    return c.json({
      pools,
      nextFree: daily && daily.at > now ? daily.at : now,
      /** your beech bucks, so the machines can show the price against your balance */
      bucks: centsToBucks(Number(me_?.credit_cents ?? 0)),
    });
  });

  // your free go: the server draws, records it and adds the prize to your bag —
  // unless the claw drops it, in which case the go is spent and nothing is won.
  // The wait before the next go is random, 5 minutes to 3 hours: shorter
  // after a miss, longer after a win. A ball from the vending machine is one a day instead
  // (next UTC midnight) and is always a draw from this week's set.
  /**
   * A unique item has one owner in the whole game: claim it for `me` before
   * granting. Taken already: the draw gives a rare item from the set instead.
   * `release` undoes the claim if the grant then doesn't happen (a lost race).
   */
  const claimUnique = async <T extends { item: string; rarity: string }>(
    me: string,
    got: T,
    now: number,
    fallback: () => T,
  ): Promise<{ got: T; release: () => Promise<void> }> => {
    if (got.rarity !== 'unique') return { got, release: async () => {} };
    const name = (await db.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [me]))[0]?.name ?? '';
    const won = await db.query(
      `INSERT INTO unique_items (item_id, owner_id, found_by, found_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (item_id) DO UPDATE SET owner_id = EXCLUDED.owner_id, found_by = EXCLUDED.found_by, found_at = EXCLUDED.found_at
        WHERE unique_items.owner_id IS NULL
       RETURNING item_id`,
      [got.item, me, name, now],
    );
    if (!won[0]) return { got: fallback(), release: async () => {} };
    return {
      got,
      release: async () => {
        await db.query('UPDATE unique_items SET owner_id = NULL WHERE item_id = $1 AND owner_id = $2 AND found_at = $3', [got.item, me, now]);
      },
    };
  };
  const rareFrom = (set: { items: { rare: string[] } }) => () =>
    ({ item: set.items.rare[Math.min(set.items.rare.length - 1, Math.floor(rand() * set.items.rare.length))], rarity: 'rare' }) as never;

  app.post('/pulls/:pool', requireUser, async (c) => {
    const id = c.req.param('pool') ?? '';
    const pool = Object.hasOwn(POOLS, id) ? POOLS[id] : undefined;
    // the vending machine isn't in POOLS: its items are this week's set
    const set = id === 'vending' ? currentSet(clock()) : null;
    if (!pool && !set) fail(404, 'no such machine');
    const poolId = pool?.id ?? 'vending';
    const me = c.get('user').id;
    const now = clock();
    await db.query('INSERT INTO pull_state (user_id, pool, count, next_at) VALUES ($1, $2, 0, 0) ON CONFLICT DO NOTHING', [me, poolId]);
    const count = Number((await db.query<{ count: number }>('SELECT count FROM pull_state WHERE user_id = $1 AND pool = $2', [me, poolId]))[0].count);
    // the first goes on the claw are fixed gifts (the machine says so); the
    // vending machine is always a draw from this week's set
    let got: { item: string; rarity: string };
    let missed = false;
    if (set) {
      // a vending machine dispenses: its ball never slips
      got = drawVending(set, rand);
    } else {
      const hist = (
        await db.query<{ first: string | null; beach: boolean | null }>(
          'SELECT MIN(created_at) AS first, BOOL_OR(item_id = $3) AS beach FROM pulls WHERE user_id = $1 AND pool = $2',
          [me, poolId, STARTER.beach.item],
        )
      )[0];
      // A normal draw can slip out of the claw — never a starter gift — and a
      // miss still spends the go: the rest starts either way.
      const starter = starterPrize(count + 1, hist?.first == null ? null : Number(hist.first), now, !!hist?.beach);
      const drawn = starter ?? draw(pool!, rand);
      missed = !starter && !grab(drawn.rarity, rand);
      got = drawn;
    }
    // one of a kind: claim it first (someone else has it: a rare instead)
    const unique = !missed && set ? await claimUnique(me, got, now, rareFrom(set)) : { got, release: async () => {} };
    got = unique.got;
    const wait = set ? nextUtcMidnight(now) - now : cooldownAfter(missed, rand);
    // one statement: claim the go (only if it's free and nobody claimed it
    // meanwhile); on a win, log it and give the prize. On a miss nothing is
    // won, so there is nothing to log or give — only the claim runs. (The
    // miss claim has its own numbering: every parameter must be used, or
    // Postgres can't tell its type.)
    const rows = missed
      ? await db.query(
          `UPDATE pull_state SET count = count + 1, next_at = $3 + $4
            WHERE user_id = $1 AND pool = $2 AND next_at <= $3 AND count = $5
            RETURNING user_id`,
          [me, poolId, now, wait, count],
        )
      : await db.query<{ item_id: string }>(
          `WITH claim AS (
             UPDATE pull_state SET count = count + 1, next_at = $6 + $7
              WHERE user_id = $1 AND pool = $2 AND next_at <= $6 AND count = $8
              RETURNING user_id
           ), logged AS (
             INSERT INTO pulls (user_id, pool, day, item_id, rarity, created_at)
             SELECT user_id, $2, $3, $4, $5, $6 FROM claim RETURNING user_id
           )
           INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at)
           SELECT user_id, $4, 1, 'pull', $6, NULL FROM logged RETURNING item_id`,
          [me, poolId, pullDay(now), got.item, got.rarity, now, wait, count],
        );
    if (!rows[0]) await unique.release();
    const st = (await freeAt(me)).get(poolId);
    if (!rows[0])
      return c.json({ error: set ? 'not yet: your next ball is tomorrow' : 'not yet: the claw is resting', nextFree: st?.at ?? now }, 409);
    if (missed) return c.json({ missed: true, item: null, rarity: null, dropped: { item: got.item, rarity: got.rarity }, nextFree: st?.at ?? now + wait });
    return c.json({ missed: false, item: got.item, rarity: got.rarity, nextFree: st?.at ?? now + wait });
  });

  // your paid go: one more try for beech bucks, when the free go is gone (or
  // before it — the price is the same either way, and the machine only
  // offers it when the free go is gone). The server draws, deducts the price
  // and grants the prize in one step; a broke player gets a 402 and nothing
  // is deducted or granted. A paid try never touches the free go: it doesn't
  // claim pull_state, doesn't reset the rest, and never gets a starter gift
  // — those are for free play. The claw can still drop the ball, and the
  // paid go is spent all the same.
  app.post('/pulls/:pool/paid', requireUser, async (c) => {
    const id = c.req.param('pool') ?? '';
    const pool = Object.hasOwn(POOLS, id) ? POOLS[id] : undefined;
    const set = id === 'vending' ? currentSet(clock()) : null;
    if (!pool && !set) fail(404, 'no such machine');
    const poolId = pool?.id ?? 'vending';
    const price = paidTryPrice(poolId) ?? fail(404, 'no paid tries for this machine');
    const me = c.get('user').id;
    const now = clock();
    // a paid try is exactly one draw, same as a free one — but it never gets
    // a starter gift, and the claw can still drop the ball (the go is spent)
    let got: { item: string; rarity: string };
    let missed = false;
    if (set) {
      got = drawVending(set, rand);
    } else {
      const drawn = draw(pool!, rand);
      missed = !grab(drawn.rarity, rand);
      got = drawn;
    }
    // one of a kind: claim it first (someone else has it: a rare instead)
    const unique = !missed && set ? await claimUnique(me, got, now, rareFrom(set)) : { got, release: async () => {} };
    got = unique.got;
    const paid = await claimPaidPull(db, {
      userId: me,
      pool: poolId,
      priceCents: bucksToCents(price),
      item: missed ? null : got.item,
      rarity: missed ? null : got.rarity,
      now,
    });
    if (!paid) {
      await unique.release();
      const [bal] = await db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [me]);
      const have = centsToBucks(Number(bal?.credit_cents ?? 0));
      return c.json({ error: `not enough beech bucks: ${price} needed, ${have} in your balance`, bucks: have, price }, 402);
    }
    // the free go is untouched by a paid try: its next time is unchanged
    const st = (await freeAt(me)).get(poolId);
    const nextFree = st && st.at > now ? st.at : now;
    if (missed) return c.json({ missed: true, item: null, rarity: null, dropped: { item: got.item, rarity: got.rarity }, nextFree, bucks: paid.bucks, paid: true });
    return c.json({ missed: false, item: got.item, rarity: got.rarity, nextFree, bucks: paid.bucks, paid: true });
  });

  // ---------------------------------------------------------------- digging finds
  // A good dig can turn up something buried: the server rolls (never the
  // app), from this week's vending set at the vending odds (server/src/digFinds.ts).
  // The app reports the stroke (brush travel in metres, duration in ms);
  // the roll needs a real dig, at most one roll every 30 s, and at most 3
  // finds a day (UTC). A miss still records the roll, so the next one waits.
  // what you've dug up so far (the "found" collection), newest first
  app.get('/dig-finds', requireUser, async (c) => {
    const rows = await db.query<{ item_id: string; rarity: string; created_at: string }>(
      `SELECT item_id, rarity, created_at FROM pulls WHERE user_id = $1 AND pool = 'dig' ORDER BY created_at DESC LIMIT 200`,
      [c.get('user').id],
    );
    return c.json({ finds: rows.map((r) => ({ item: r.item_id, rarity: r.rarity, at: Number(r.created_at) })) });
  });

  app.post('/dig-finds', requireUser, async (c) => {
    const me = c.get('user').id;
    const now = clock();
    const { pathM, durationMs } = await body<{ pathM?: number; durationMs?: number }>(c);
    if (!Number.isFinite(pathM) || !Number.isFinite(durationMs) || pathM! < 0 || durationMs! < 0)
      fail(400, 'expected { pathM, durationMs }');
    if (!qualifiesForFind(pathM!, durationMs!)) fail(409, 'dig a little more first');
    // digging changes the beach: only the current editor rolls for a find
    await requireEditToken(c);
    const set = currentSet(now) ?? fail(409, 'nothing buried here yet');
    const today = pullDay(now);
    // the cap and the cooldown, before the roll (the claim below re-checks,
    // so two rolls at once still can't both win)
    const st = (
      await db.query<{ day: string; finds: number; last_roll_at: string }>(
        'SELECT day, finds, last_roll_at FROM dig_state WHERE user_id = $1',
        [me],
      )
    )[0];
    const findsToday = st && st.day === today ? Number(st.finds) : 0;
    if (findsToday >= DIG_FIND_DAILY_CAP)
      return c.json({ error: 'that is all the buried treasure for today', nextFindsAt: nextUtcMidnight(now) }, 409);
    if (st && now - Number(st.last_roll_at) < DIG_FIND_ROLL_COOLDOWN_MS)
      return c.json({ error: 'slow down', nextRollAt: Number(st.last_roll_at) + DIG_FIND_ROLL_COOLDOWN_MS }, 409);
    const drawn = digDraw(set, rand);
    if (!drawn.found) {
      // the roll happened: record when, so the next one waits
      const rows = await db.query(
        `INSERT INTO dig_state (user_id, day, finds, last_roll_at) VALUES ($1, $2, 0, $3)
         ON CONFLICT (user_id) DO UPDATE SET
           day = EXCLUDED.day,
           finds = CASE WHEN dig_state.day = EXCLUDED.day THEN dig_state.finds ELSE 0 END,
           last_roll_at = EXCLUDED.last_roll_at
         WHERE $3 - dig_state.last_roll_at >= $4
         RETURNING user_id`,
        [me, today, now, DIG_FIND_ROLL_COOLDOWN_MS],
      );
      if (!rows[0]) return c.json({ error: 'slow down', nextRollAt: now + DIG_FIND_ROLL_COOLDOWN_MS }, 409);
      return c.json({ found: false });
    }
    // one of a kind: claim it first (someone else has it: a rare instead)
    const unique = await claimUnique(me, { item: drawn.item!, rarity: drawn.rarity! as string }, now, rareFrom(set));
    drawn.item = unique.got.item;
    drawn.rarity = unique.got.rarity as typeof drawn.rarity;
    // one statement: claim the find (only if still under the cap and the
    // cooldown has passed) and grant it — a racing second roll claims nothing
    const rows = await db.query<{ item_id: string }>(
      `WITH s AS (
         INSERT INTO dig_state (user_id, day, finds, last_roll_at) VALUES ($1, $2, 1, $5)
         ON CONFLICT (user_id) DO UPDATE SET
           day = EXCLUDED.day,
           finds = CASE WHEN dig_state.day = EXCLUDED.day THEN dig_state.finds + 1 ELSE 1 END,
           last_roll_at = EXCLUDED.last_roll_at
         WHERE (dig_state.day <> EXCLUDED.day OR dig_state.finds < $3)
           AND $5 - dig_state.last_roll_at >= $4
         RETURNING user_id, finds
       ), logged AS (
         INSERT INTO pulls (user_id, pool, day, item_id, rarity, created_at)
         SELECT user_id, 'dig', $2, $6, $7, $5 FROM s RETURNING user_id
       )
       INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at)
       SELECT user_id, $6, 1, 'pull', $5, NULL FROM logged RETURNING item_id`,
      [me, today, DIG_FIND_DAILY_CAP, DIG_FIND_ROLL_COOLDOWN_MS, now, drawn.item, drawn.rarity],
    );
    if (!rows[0]) {
      await unique.release();
      return c.json({ error: 'slow down', nextRollAt: now + DIG_FIND_ROLL_COOLDOWN_MS }, 409);
    }
    const after = Number(
      (await db.query<{ finds: number }>('SELECT finds FROM dig_state WHERE user_id = $1', [me]))[0]?.finds ?? 1,
    );
    const bonusTreat = await maybeGrantBonusTreat(db, me, now, rand);
    return c.json({
      found: true,
      item: drawn.item,
      rarity: drawn.rarity,
      findsToday: after,
      findsLeft: DIG_FIND_DAILY_CAP - after,
      nextFindsAt: after >= DIG_FIND_DAILY_CAP ? nextUtcMidnight(now) : null,
      ...(bonusTreat ? { bonusTreat: true } : {}),
    });
  });

  // ---------------------------------------------------------------- animals (A2: food & feeding, A3: resident pets)
  app.post('/animals/feed', requireUser, async (c) => {
    const user = c.get('user');
    const b = await body<{ beachId?: string; species?: string }>(c).catch(() => ({} as { beachId?: string; species?: string }));
    const species = speciesOf(b.species) ?? fail(400, 'unknown species');
    // resolve the beach first, so a foreign or bad beach id never spends a snack
    const beachId = await mine(c, b.beachId ?? c.req.query('beach'));
    const fed = await db.withTransaction(async (tx) => {
      // A toss and a pickup take the same lock before touching inventory or the snack row.
      await tx.query('SELECT id FROM beach WHERE id = $1 FOR NO KEY UPDATE', [beachId]);
      const now = clock();
      const res = await consumeTreat(tx, user.id, now);
      if (!res.ok) return null;

      const existingPet = await getBeachPet(tx, beachId, now);
      if (existingPet) {
        const pet = await feedBeachPet(tx, beachId, user.id, user.name, now);
        await recordSnackOut(tx, { beachId, userId: user.id, inventoryId: res.rowId, now, petPrevFedAt: existingPet.lastFedAt });
        return { remaining: res.remaining, pet };
      }
      const bond = await recordWildFeed(tx, beachId, species, now);
      await recordSnackOut(tx, { beachId, userId: user.id, inventoryId: res.rowId, now, wildSpecies: species });
      return { remaining: res.remaining, bond };
    });
    if (!fed) return c.json({ error: 'no beach snacks left', remaining: 0 }, 409);
    return c.json({ ok: true, ...fed });
  });

  // pick the snack that's out back up (by hand or with the vacuum): back in the bag
  app.post('/animals/feed/return', requireUser, async (c) => {
    const user = c.get('user');
    const b = await body<{ beachId?: string }>(c).catch(() => ({} as { beachId?: string }));
    const beachId = await mine(c, b.beachId ?? c.req.query('beach'));
    const back = await db.withTransaction(async (tx) => {
      await tx.query('SELECT id FROM beach WHERE id = $1 FOR NO KEY UPDATE', [beachId]);
      return returnSnack(tx, beachId, user.id, clock());
    });
    if (!back) return c.json({ error: 'no snack out on this beach' }, 409);
    return c.json({ ok: true, ...back });
  });

  app.get('/pet', requireUser, async (c) => {
    const me = c.get('user').id;
    const beachId = await mine(c, c.req.query('beach'));
    const now = clock();
    const pet = await getBeachPet(db, beachId, now);
    const bonds = await Promise.all(PETS.map((p) => getBondProgress(db, beachId, p.species)));
    const recentFeeders = pet ? await recentPetFeeders(db, beachId, me) : [];
    return c.json({ pet, bond: bonds[0], bonds, recentFeeders });
  });

  // ---------------------------------------------------------------- pets as things you own and move (docs/PETS.md)
  app.get('/pet/bag', requireUser, async (c) => c.json({ pets: await listBagPets(db, c.get('user').id) }));

  app.post('/pet/stow', requireUser, async (c) => {
    const user = c.get('user');
    const b = await body<{ beachId?: string }>(c).catch(() => ({} as { beachId?: string }));
    const beachId = await mine(c, b.beachId ?? c.req.query('beach'));
    const pet = await stowPet(db, { beachId, userId: user.id, now: clock() });
    if (!pet) return c.json({ error: 'no pet on this beach' }, 404);
    return c.json({ pet, bag: await listBagPets(db, user.id) });
  });

  app.post('/pet/place', requireUser, async (c) => {
    const user = c.get('user');
    const b = await body<{ beachId?: string; petId?: number; home?: { x: number; z: number } }>(c);
    const petId = Number(b.petId);
    if (!Number.isSafeInteger(petId) || petId <= 0) fail(400, 'expected petId');
    const beachId = await mine(c, b.beachId ?? c.req.query('beach'));
    const res = await placePet(db, { petId, beachId, userId: user.id, now: clock(), home: b.home ?? null });
    if (!res.ok) return c.json({ error: res.error }, res.status);
    return c.json({ pet: res.pet });
  });

  app.post('/pet/adopt', requireUser, async (c) => {
    const user = c.get('user');
    const b = await body<{ beachId?: string; species?: string; name?: string; mode?: string; home?: unknown }>(c);
    const mode = b.mode === 'shop' ? 'shop' : b.mode === 'befriend' ? 'befriend' : fail(400, 'expected mode "befriend" or "shop"');
    const species = speciesOf(b.species) ?? fail(400, 'unknown species');
    const beachId = await mine(c, b.beachId ?? c.req.query('beach'));
    const res = await adoptPet(db, {
      beachId,
      userId: user.id,
      species,
      name: cleanPetName(b.name),
      mode,
      now: clock(),
      home: cleanHome(b.home),
    });
    if (!res.ok) return c.json({ error: res.error }, res.status);
    return c.json({ pet: res.pet });
  });

  app.patch('/pet', requireUser, async (c) => {
    const b = await body<{ beachId?: string; name?: string; home?: { x: number; z: number } | null }>(c);
    const beachId = await mine(c, b.beachId ?? c.req.query('beach'));
    if (b.home !== undefined && b.name === undefined) {
      const moved = await setPetHome(db, beachId, cleanHome(b.home), clock());
      if (!moved) return c.json({ error: 'no pet on this beach' }, 404);
      return c.json({ pet: moved });
    }
    const pet = await renameBeachPet(db, beachId, cleanPetName(b.name), clock());
    if (!pet) return c.json({ error: 'no pet on this beach' }, 404);
    return c.json({ pet });
  });

  // ---------------------------------------------------------------- animals (A4: visitor pet read & feeding)
  app.get('/beaches/:code/pet', async (c) => {
    const code = normalizeCode(c.req.param('code'));
    const now = clock();
    const rows = await db.query<{ id: string; owner_id: string; on_shore: boolean }>(
      `SELECT id, owner_id, on_shore FROM beach WHERE code = $1`,
      [code],
    );
    const beach = rows[0];
    if (!beach) return c.json({ error: 'beach not found' }, 404);

    // Optional caller lookup so signed-in visitors get `canFreeFeed` and owners can view off-shore beaches
    let viewerId: string | null = null;
    const auth = c.req.header('Authorization');
    if (auth?.startsWith('Bearer ')) {
      const s = await db.query<{ user_id: string }>(
        `SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > $2`,
        [await hashToken(auth.slice(7)), now],
      );
      viewerId = s[0]?.user_id ?? null;
    }
    if (!beach.on_shore && viewerId !== beach.owner_id) return c.json({ error: 'beach not found' }, 404);

    const pet = await getBeachPet(db, beach.id, now);
    const recentFeeders = pet ? await recentPetFeeders(db, beach.id, beach.owner_id) : [];
    const canFreeFeed =
      pet && viewerId && viewerId !== beach.owner_id ? !(await hasVisitorFedToday(db, beach.id, viewerId, now)) : undefined;
    return c.json({ pet, recentFeeders, ...(canFreeFeed !== undefined ? { canFreeFeed } : {}) });
  });

  app.post('/beaches/:code/pet/feed', requireUser, async (c) => {
    const user = c.get('user');
    const code = normalizeCode(c.req.param('code') ?? '');
    const now = clock();
    const b = await body<{ useFood?: boolean }>(c).catch(() => ({} as { useFood?: boolean }));
    const rows = await db.query<{ id: string; owner_id: string; on_shore: boolean }>(
      `SELECT id, owner_id, on_shore FROM beach WHERE code = $1`,
      [code],
    );
    const beach = rows[0];
    if (!beach || (!beach.on_shore && beach.owner_id !== user.id)) return c.json({ error: 'beach not found' }, 404);
    // someone the owner has blocked can't leave their name on the pet either
    if (beach.owner_id !== user.id && (await blocked(beach.owner_id, user.id))) fail(403, 'that didn’t go through');

    const res = await visitorFeedPet(db, {
      beachId: beach.id,
      visitorId: user.id,
      visitorName: user.name,
      useFood: Boolean(b.useFood),
      now,
    });
    if (!res.ok) return c.json({ error: res.error, ...(res.freeUsedToday ? { freeUsedToday: true } : {}) }, res.status);
    return c.json({
      pet: res.pet,
      usedFood: res.usedFood,
      ...(res.remaining !== undefined ? { remaining: res.remaining } : {}),
      freeUsedToday: res.freeUsedToday,
    });
  });

  app.post('/neighbors/code', requireUser, async (c) => {
    const me = await mine(c, c.req.query('beach'));
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newNeighborCode();
      try {
        await db.query('UPDATE beach SET code = $1 WHERE id = $2', [code, me]);
        if (me === c.get('user').id) await db.query('UPDATE users SET neighbor_code = $1 WHERE id = $2', [code, me]).catch(() => {});
        return c.json({ code });
      } catch {
        /* collision: try another */
      }
    }
    return fail(500, 'could not make a new code');
  });

  // ---------------------------------------------------------------- my beaches
  const myBeaches = async (user: string) => {
    const rows = await db.query<NodeRow & { home: boolean; on_shore: boolean; items: Record<string, number> | string; pier_attached: boolean; pier_site: boolean; sections_rev: number }>(
      `SELECT ${NODE}, b.home, b.on_shore, b.items, b.sections_rev,
              EXISTS (SELECT 1 FROM beach_piers ap WHERE ap.beach_id = b.id) AS pier_attached, ${PIER_SITE} AS pier_site
         FROM ${BEACH} WHERE b.owner_id = $1 ORDER BY b.home DESC, b.created_at`,
      [user],
    );
    return Promise.all(
      rows.map(async (r) => {
        const [left, right] = await Promise.all([linked(r.id, 'left'), linked(r.id, 'right')]);
        return {
          id: r.id,
          code: r.code,
          name: r.beach_name,
          home: r.home,
          onShore: r.on_shore,
          location: r.location,
          updatedAt: r.updated_at === null ? null : Number(r.updated_at),
          items: typeof r.items === 'string' ? (JSON.parse(r.items) as Record<string, number>) : r.items,
          left: left ? { ...beachJson(left), yours: left.owner_id === user } : null,
          right: right ? { ...beachJson(right), yours: right.owner_id === user } : null,
          // docs/PIERS.md: a site sits between two of your beaches; an
          // attached pier shows there ('active') or waits for the site to
          // come back ('paused')
          pierSite: !!r.pier_site,
          pier: r.pier_attached ? (r.pier_site ? ('active' as const) : ('paused' as const)) : null,
          // docs/INLAND_SECTIONS.md: the rows behind it, front first, and the
          // revision a layout change has to be made from
          sections: r.sections ? r.sections.split(',') : [],
          sectionsRev: Number(r.sections_rev),
        };
      }),
    );
  };

  app.get('/beaches/mine', requireUser, async (c) => {
    const me = c.get('user').id;
    const [beaches, allowed, piers, sections] = await Promise.all([myBeaches(me), allowance(me), pierCounts(me), sectionCounts(me)]);
    return c.json({ allowance: allowed, cap: BEACH_CAP, beaches, piers, sections });
  });

  // make another beach (if your allowance has room)
  app.post('/beaches/mine', requireUser, async (c) => {
    const me = c.get('user').id;
    await requireEditToken(c);
    const { name, location } = await body<{ name?: string; location?: string }>(c);
    const loc = (location ?? '').slice(0, 40);
    if (loc && !/^[a-z0-9-]+$/.test(loc)) fail(400, 'bad location');
    const now = Date.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        // one statement: only if you're under your allowance
        const rows = await db.query<{ id: string }>(
          `INSERT INTO beach (id, owner_id, code, name, home, location, created_at)
           SELECT $1, $2, $3, $4, false, NULLIF($5, ''), $6
            WHERE (SELECT COUNT(*) FROM beach WHERE owner_id = $2) < $7
           RETURNING id`,
          [crypto.randomUUID(), me, newNeighborCode(), (name ?? '').trim().slice(0, 30), loc, now, await allowance(me)],
        );
        if (!rows[0]) fail(409, 'no room for another beach: get an extra beach first');
        return c.json({ beach: (await myBeaches(me)).find((b) => b.id === rows[0].id) });
      } catch (e) {
        if (e instanceof HTTPException) throw e;
        if (attempt === 4) throw e; // (a code collision: try another)
      }
    }
    return fail(500, 'could not make a beach');
  });

  app.patch('/beaches/mine/:id', requireUser, async (c) => {
    const me = c.get('user').id;
    const id = await mine(c, c.req.param('id'));
    await requireEditToken(c);
    const p = await body<{ name?: string; location?: string; home?: boolean }>(c);
    if (p.location !== undefined && !/^[a-z0-9-]{1,40}$/.test(p.location)) fail(400, 'bad location');
    if (p.name !== undefined) await db.query('UPDATE beach SET name = $1 WHERE id = $2', [String(p.name).trim().slice(0, 30), id]);
    if (p.location !== undefined) await db.query('UPDATE beach SET location = $1 WHERE id = $2', [p.location, id]);
    if (p.home === true) {
      // one statement, so there's always exactly one home
      await db.query('UPDATE beach SET home = (id = $1) WHERE owner_id = $2', [id, me]);
    }
    return c.json({ beach: (await myBeaches(me)).find((b) => b.id === id) });
  });

  app.delete('/beaches/mine/:id', requireUser, async (c) => {
    const id = await mine(c, c.req.param('id'));
    await requireEditToken(c);
    // links, requests and favorites go with it (ON DELETE CASCADE); its pet goes in the bag
    const me = c.get('user').id;
    const rows = await db.withTransaction(async (tx) => {
      await tx.query('SELECT id FROM beach WHERE id = $1 FOR NO KEY UPDATE', [id]);
      const del = await tx.query<{ id: string }>('SELECT id FROM beach WHERE id = $1 AND NOT home', [id]);
      if (del.length) await stowLocked(tx, id, me, clock());
      return del.length ? tx.query('DELETE FROM beach WHERE id = $1 AND NOT home RETURNING id', [id]) : [];
    });
    if (!rows.length) fail(400, "your home beach can't be removed (make another one home first)");
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- piers
  // docs/PIERS.md, specs/tla/Piers.tla. A pier is a bag item ('pier', bought
  // with beech bucks); a beach_piers row lands one on a beach. Rows count as
  // placed against what's owned, so the bag, trade-ins and gifts see them.
  /** piers you own, and how many are on beaches (active or paused) */
  const pierCounts = async (user: string, q: Db = db): Promise<{ owned: number; placed: number }> => {
    const r = (
      await q.query<{ owned: string | null; placed: string }>(
        `SELECT (SELECT SUM(quantity) FROM inventory WHERE user_id = $1 AND item_id = 'pier' AND quantity > 0 AND (expires_at IS NULL OR expires_at > $2)) AS owned,
                (SELECT COUNT(*) FROM beach_piers WHERE owner_id = $1) AS placed`,
        [user, clock()],
      )
    )[0];
    return { owned: Number(r?.owned ?? 0), placed: Number(r?.placed ?? 0) };
  };

  // Land: one transaction holding the player's lock (with the edit token
  // check), the beach's row, and its two links and the beaches on them
  // (FOR SHARE), so an unlink or a deletion of a supporting beach can't land
  // between the check and the insert (PlacementWasEligible), and a trade-in
  // or gift, which take the same player lock, can't take the last free pier
  // (PaidAttachment). The primary key on beach_id keeps one per beach.
  app.put('/beaches/mine/:id/pier', requireUser, async (c) => {
    const me = c.get('user').id;
    const id = await mine(c, c.req.param('id'));
    await asEditor(c, async (tx) => {
      await tx.query('SELECT id FROM beach WHERE id = $1 FOR NO KEY UPDATE', [id]);
      const sides = await tx.query<{ side: Side; owner_id: string }>(
        `SELECT n.side, nb.owner_id FROM neighbors n JOIN beach nb ON nb.id = n.neighbor_beach_id
          WHERE n.beach_id = $1 FOR SHARE OF n, nb`,
        [id],
      );
      const own = (s: Side) => sides.some((r) => r.side === s && r.owner_id === me);
      if (!own('left') || !own('right')) fail(409, 'a pier needs one of your beaches on each side');
      if ((await tx.query('SELECT 1 FROM beach_piers WHERE beach_id = $1', [id])).length) fail(409, 'this beach already has a pier');
      const { owned, placed } = await pierCounts(me, tx);
      if (owned <= placed) fail(409, 'no pier in your bag');
      await tx.query('INSERT INTO beach_piers (beach_id, owner_id, placed_at) VALUES ($1, $2, $3)', [id, me, clock()]);
    });
    return c.json({ pier: 'active', piers: await pierCounts(me) });
  });

  // Lift: active or paused, the pier goes back to the bag.
  app.delete('/beaches/mine/:id/pier', requireUser, async (c) => {
    const me = c.get('user').id;
    const id = await mine(c, c.req.param('id'));
    await asEditor(c, async (tx) => {
      const gone = await tx.query('DELETE FROM beach_piers WHERE beach_id = $1 AND owner_id = $2 RETURNING beach_id', [id, me]);
      if (!gone.length) fail(404, 'no pier on this beach');
    });
    return c.json({ pier: null, piers: await pierCounts(me) });
  });

  // ---------------------------------------------------------------- inland sections
  // docs/INLAND_SECTIONS.md, specs/tla/InlandSections.tla. A section is a bag
  // item ('section-*', bought with beech bucks); beach_sections rows place
  // them in rows behind a beach. Rows count as placed against what's owned,
  // per type, so the bag, trade-ins and gifts see them.
  /** per section type: how many you own, and how many are on your beaches */
  const sectionCounts = async (user: string, q: Db = db): Promise<{ owned: Record<string, number>; placed: Record<string, number> }> => {
    // one after the other: `q` may be a transaction's single connection
    const owned = await q.query<{ item_id: string; n: string }>(
      `SELECT item_id, SUM(quantity) AS n FROM inventory
        WHERE user_id = $1 AND item_id = ANY($2) AND quantity > 0 AND (expires_at IS NULL OR expires_at > $3) GROUP BY item_id`,
      [user, SECTION_IDS, clock()],
    );
    const placed = await q.query<{ item_id: string; n: string }>('SELECT item_id, COUNT(*) AS n FROM beach_sections WHERE owner_id = $1 GROUP BY item_id', [user]);
    const map = (rows: { item_id: string; n: string }[]) => Object.fromEntries(rows.map((r) => [r.item_id, Number(r.n)]));
    return { owned: map(owned), placed: map(placed) };
  };

  // Write (InlandSections.tla): the whole layout in one request, made from
  // the layout at `rev`. One transaction holding the player's lock (asEditor,
  // with the edit token) and the beach row: the revision must still match
  // (NoLostUpdate: a second device's change isn't silently undone), the rows
  // must fit in SECTION_ROWS and in what's owned counting every other beach
  // (PaidPlacement: trade-ins and gifts take the same player lock), then the
  // rows are replaced and the revision bumps. Appending, replacing a row,
  // reordering and returning one to the bag are all this one write.
  app.put('/beaches/mine/:id/sections', requireUser, async (c) => {
    const me = c.get('user').id;
    const id = await mine(c, c.req.param('id'));
    const { rows, rev } = await body<{ rows?: unknown; rev?: unknown }>(c);
    if (!Array.isArray(rows) || !rows.every((r) => typeof r === 'string' && isSection(r))) fail(400, 'say which sections, front row first');
    if (!Number.isInteger(rev)) fail(400, 'say which layout this was made from');
    const want = rows as string[];
    if (want.length > SECTION_ROWS) fail(409, `a beach has room for ${SECTION_ROWS} sections`);
    const out = await asEditor(c, async (tx) => {
      const [b] = await tx.query<{ sections_rev: number }>('SELECT sections_rev FROM beach WHERE id = $1 FOR NO KEY UPDATE', [id]);
      if (!b) fail(404, 'no such beach');
      if (Number(b.sections_rev) !== rev) fail(409, 'this beach changed: look again');
      const here = await tx.query<{ item_id: string }>('SELECT item_id FROM beach_sections WHERE beach_id = $1', [id]);
      const { owned, placed } = await sectionCounts(me, tx);
      const count = (list: string[], t: string) => list.filter((x) => x === t).length;
      const mineHere = here.map((r) => r.item_id);
      for (const t of new Set(want)) {
        if ((placed[t] ?? 0) - count(mineHere, t) + count(want, t) > (owned[t] ?? 0)) fail(409, 'not enough of that section in your bag');
      }
      const now = clock();
      await tx.query('DELETE FROM beach_sections WHERE beach_id = $1', [id]);
      for (let i = 0; i < want.length; i++) {
        await tx.query('INSERT INTO beach_sections (beach_id, row, owner_id, item_id, placed_at) VALUES ($1, $2, $3, $4, $5)', [id, i, me, want[i], now]);
      }
      const [next] = await tx.query<{ sections_rev: number }>('UPDATE beach SET sections_rev = sections_rev + 1 WHERE id = $1 RETURNING sections_rev', [id]);
      return Number(next.sections_rev);
    });
    return c.json({ rows: want, rev: out, sections: await sectionCounts(me) });
  });

  app.get('/beaches/mine/:id/sand', requireUser, async (c) => sendBeach(c, await mine(c, c.req.param('id'))));
  app.put('/beaches/mine/:id/sand', requireUser, async (c) => saveBeach(c, await mine(c, c.req.param('id'))));
  app.post('/beaches/mine/:id/here', requireUser, async (c) => here(c, await mine(c, c.req.param('id'))));
  app.get('/beaches/mine/:id/away', requireUser, async (c) => away(c, await mine(c, c.req.param('id'))));
  app.post('/beaches/mine/:id/away/seen', requireUser, async (c) => seen(c, await mine(c, c.req.param('id'))));

  // ---------------------------------------------------------------- checkpoints
  // Named copies of your beaches, restorable onto any of them if your bag
  // covers the things on them (docs/CHECKPOINTS.md). The server counts the
  // things itself (inspectBlob), never trusting the app's count.
  interface CheckpointRow {
    id: string;
    name: string;
    kind: 'named' | 'auto' | 'tide';
    source: 'beach' | 'import' | 'copy';
    from_beach: string | null;
    origin_beach_id: string | null;
    from_name: string;
    beach_name: string | null;
    location: string | null;
    nx: number;
    ny: number;
    bytes: number;
    items: Record<string, number> | string;
    objects: number;
    created_at: string;
  }
  const jsonMap = (v: Record<string, number> | string | null | undefined): Record<string, number> =>
    !v ? {} : typeof v === 'string' ? (JSON.parse(v) as Record<string, number>) : v;
  const checkpointJson = (r: CheckpointRow) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    source: r.source,
    // the beach it came from: its name now if it's still there, else then
    fromBeach: r.from_beach ? { id: r.from_beach, name: r.beach_name ?? r.from_name } : null,
    originBeachId: r.origin_beach_id ?? r.from_beach,
    fromName: r.from_name,
    location: r.location,
    nx: Number(r.nx),
    ny: Number(r.ny),
    items: jsonMap(r.items),
    objects: Number(r.objects),
    bytes: Number(r.bytes),
    createdAt: Number(r.created_at),
  });
  const CHECKPOINT_COLS = `c.id, c.name, c.kind, c.source, c.from_beach, c.origin_beach_id, c.from_name, b.name AS beach_name, c.location, c.nx, c.ny, c.bytes, c.items, c.objects, c.created_at`;
  const myCheckpoint = async (c: Context<Env>, id: string | undefined): Promise<CheckpointRow & { sand: unknown }> => {
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) fail(404, 'no such checkpoint');
    const rows = await db.query<CheckpointRow & { sand: unknown }>(
      `SELECT ${CHECKPOINT_COLS}, c.sand FROM checkpoints c LEFT JOIN beach b ON b.id = c.from_beach WHERE c.id = $1 AND c.owner_id = $2`,
      [id, c.get('user').id],
    );
    if (!rows[0]) fail(404, 'no such checkpoint');
    return rows[0];
  };
  const checkpointName = (raw: unknown): string => {
    const name = String(raw ?? '').trim().slice(0, CHECKPOINT_NAME_MAX);
    if (!name) fail(400, 'give the checkpoint a name');
    return name;
  };
  /** named checkpoints you may keep: 5 for each beach of your allowance */
  const checkpointLimit = async (user: string) => CHECKPOINTS_PER_BEACH * (await allowance(user));
  const checkpointUse = async (user: string) => {
    const rows = await db.query<{ named: string; bytes: string | null }>(
      `SELECT COUNT(*) FILTER (WHERE kind = 'named') AS named, SUM(bytes) FILTER (WHERE kind <> 'tide') AS bytes FROM checkpoints WHERE owner_id = $1`,
      [user],
    );
    return { named: Number(rows[0]?.named ?? 0), bytes: Number(rows[0]?.bytes ?? 0) };
  };
  const checkRoom = async (user: string, adding: number) => {
    const [use, limit] = await Promise.all([checkpointUse(user), checkpointLimit(user)]);
    if (use.named >= limit) fail(409, `you have ${limit} checkpoints, the most you can keep: delete one first`);
    if (use.bytes + adding > CHECKPOINT_BYTES_PER_USER) fail(413, 'your checkpoints are full: delete some first');
  };
  const inspect = (bytes: Uint8Array) => {
    try {
      return inspectBlob(bytes);
    } catch (e) {
      if (e instanceof BadBlob) return fail(400, `not a saved beach (${e.message})`);
      throw e;
    }
  };
  const makeLimiter = createRateLimiter(60, 3600000);
  const restoreLimiter = createRateLimiter(30, 3600000);

  /** what you own of each non-free item (unexpired) */
  const ownedItems = async (user: string, q: Db = db): Promise<Record<string, number>> => {
    const rows = await q.query<{ item_id: string; n: string }>(
      `SELECT item_id, SUM(quantity) AS n FROM inventory WHERE user_id = $1 AND quantity > 0 AND (expires_at IS NULL OR expires_at > $2) GROUP BY item_id`,
      [user, clock()],
    );
    return Object.fromEntries(rows.map((r) => [r.item_id, Number(r.n)]));
  };
  /** what's on your beaches other than `except` */
  const itemsElsewhere = async (user: string, except: string, q: Db = db): Promise<Record<string, number>> => {
    const rows = await q.query<{ items: Record<string, number> | string }>('SELECT items FROM beach WHERE owner_id = $1 AND id <> $2', [user, except]);
    const out: Record<string, number> = {};
    for (const r of rows) for (const [k, v] of Object.entries(jsonMap(r.items))) out[k] = (out[k] ?? 0) + Number(v);
    // piers aren't in any save: they're placed by beach_piers rows (docs/PIERS.md)
    const piers = Number((await q.query<{ n: string }>('SELECT COUNT(*) AS n FROM beach_piers WHERE owner_id = $1', [user]))[0]?.n ?? 0);
    if (piers) out.pier = (out.pier ?? 0) + piers;
    // nor are inland sections: beach_sections rows (docs/INLAND_SECTIONS.md)
    const secs = await q.query<{ item_id: string; n: string }>('SELECT item_id, COUNT(*) AS n FROM beach_sections WHERE owner_id = $1 GROUP BY item_id', [user]);
    for (const r of secs) out[r.item_id] = (out[r.item_id] ?? 0) + Number(r.n);
    return out;
  };
  const fitOf = async (user: string, need: Record<string, number>, target: string, q: Db = db) => {
    const owned = await ownedItems(user, q);
    const elsewhere = await itemsElsewhere(user, target, q);
    return { need, owned, elsewhere, short: shortfall(need, owned, elsewhere) };
  };

  // One restore at a time per person: in this process (PGlite interleaves
  // on one connection) and across server instances (an advisory lock).
  const restoring = new Map<string, Promise<unknown>>();
  const userLockKey = (user: string) => (parseInt(user.replace(/-/g, '').slice(0, 7), 16) % 1_000_000_000) + 1_000_000;
  const oneAtATime = async <T>(user: string, fn: () => Promise<T>): Promise<T> => {
    while (restoring.has(user)) await restoring.get(user)!.catch(() => {});
    const run = db.withLock(userLockKey(user), fn);
    restoring.set(user, run);
    try {
      return await run;
    } finally {
      restoring.delete(user);
    }
  };

  app.get('/checkpoints', requireUser, async (c) => {
    const me = c.get('user').id;
    const [rows, limit, use] = await Promise.all([
      db.query<CheckpointRow>(
        `SELECT ${CHECKPOINT_COLS} FROM checkpoints c LEFT JOIN beach b ON b.id = c.from_beach WHERE c.owner_id = $1 ORDER BY c.created_at DESC, c.name`,
        [me],
      ),
      checkpointLimit(me),
      checkpointUse(me),
    ]);
    return c.json({ limit, named: use.named, bytesUsed: use.bytes, bytesLimit: CHECKPOINT_BYTES_PER_USER, checkpoints: rows.map(checkpointJson) });
  });

  // a checkpoint of one of your beaches, copied here (no upload)
  app.post('/beaches/mine/:id/checkpoints', requireUser, async (c) => {
    const me = c.get('user').id;
    const beachId = await mine(c, c.req.param('id'));
    // auto: the beach's one automatic copy ("Before import"), replacing the
    // last one and not counted against your named checkpoints
    const { name, auto } = await body<{ name?: string; auto?: boolean }>(c);
    const label = checkpointName(name);
    if (!makeLimiter(me)) fail(429, 'too many checkpoints at once: try again later');
    const rows = await db.query<{ sand: unknown; location: string; nx: number; ny: number; name: string }>(
      'SELECT sand, location, nx, ny, name FROM beach WHERE id = $1 AND sand IS NOT NULL',
      [beachId],
    );
    if (!rows[0]) fail(404, 'that beach has nothing saved yet');
    const bytes = toBytes(rows[0].sand);
    const info = inspect(bytes);
    if (auto) {
      const total = await checkpointUse(me);
      if (total.bytes + bytes.byteLength > CHECKPOINT_BYTES_PER_USER) fail(413, 'your checkpoints are full: delete some first');
    } else await checkRoom(me, bytes.byteLength);
    const r = await db.query<{ id: string }>(
      `INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, from_name, location, nx, ny, sand, bytes, items, objects, created_at, origin_beach_id)
       VALUES ($1, $2, $3, $14, 'beach', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $4)
       ON CONFLICT (from_beach) WHERE kind = 'auto' DO UPDATE SET
         name = EXCLUDED.name, from_name = EXCLUDED.from_name, location = EXCLUDED.location, nx = EXCLUDED.nx, ny = EXCLUDED.ny,
         sand = EXCLUDED.sand, bytes = EXCLUDED.bytes, items = EXCLUDED.items, objects = EXCLUDED.objects, created_at = EXCLUDED.created_at,
         origin_beach_id = EXCLUDED.origin_beach_id
       RETURNING id`,
      [
        crypto.randomUUID(),
        me,
        label,
        beachId,
        rows[0].name,
        rows[0].location,
        rows[0].nx,
        rows[0].ny,
        bytes,
        bytes.byteLength,
        JSON.stringify(info.items),
        info.objects,
        clock(),
        auto ? 'auto' : 'named',
      ],
    );
    return c.json({ checkpoint: checkpointJson((await myCheckpoint(c, r[0].id)) as CheckpointRow) }, 201);
  });

  // import: a beach made elsewhere (a beach file, encoded by the app)
  app.post('/checkpoints', requireUser, async (c) => {
    const me = c.get('user').id;
    let label: string;
    try {
      label = checkpointName(decodeURIComponent(c.req.header('X-Checkpoint-Name') ?? ''));
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return fail(400, 'bad X-Checkpoint-Name');
    }
    const location = (c.req.header('X-Beach-Location') ?? '').slice(0, 40);
    if (location && !/^[a-z0-9-]+$/.test(location)) fail(400, 'bad X-Beach-Location');
    if (Number(c.req.header('Content-Length') ?? 0) > MAX_BEACH_BYTES) fail(413, 'beach too large');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BEACH_BYTES) fail(413, 'beach too large');
    const info = inspect(bytes);
    if (info.nx !== info.ny) fail(400, 'not a saved beach (the grid must be square)');
    if (!makeLimiter(me)) fail(429, 'too many checkpoints at once: try again later');
    await checkRoom(me, bytes.byteLength);
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, from_name, location, nx, ny, sand, bytes, items, objects, created_at)
       VALUES ($1, $2, $3, 'named', 'import', NULL, '', NULLIF($4, ''), $5, $6, $7, $8, $9, $10, $11)`,
      [id, me, label, location, info.nx, info.ny, bytes, bytes.byteLength, JSON.stringify(info.items), info.objects, clock()],
    );
    return c.json({ checkpoint: checkpointJson((await myCheckpoint(c, id)) as CheckpointRow) }, 201);
  });

  app.get('/checkpoints/:id/sand', requireUser, async (c) => {
    const r = await myCheckpoint(c, c.req.param('id'));
    return new Response(toBytes(r.sand) as BodyInit, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Beach-Location': r.location ?? '',
        'X-Beach-Nx': String(r.nx),
        'X-Beach-Ny': String(r.ny),
      },
    });
  });

  app.patch('/checkpoints/:id', requireUser, async (c) => {
    const r = await myCheckpoint(c, c.req.param('id'));
    const { name } = await body<{ name?: string }>(c);
    await db.query('UPDATE checkpoints SET name = $1 WHERE id = $2', [checkpointName(name), r.id]);
    return c.json({ checkpoint: checkpointJson((await myCheckpoint(c, r.id)) as CheckpointRow) });
  });

  app.delete('/checkpoints/:id', requireUser, async (c) => {
    const r = await myCheckpoint(c, c.req.param('id'));
    await db.query('DELETE FROM checkpoints WHERE id = $1', [r.id]);
    return c.body(null, 204);
  });

  // would it fit onto that beach? (the bag's owned minus what's on your other beaches)
  app.get('/checkpoints/:id/fit', requireUser, async (c) => {
    const me = c.get('user').id;
    const r = await myCheckpoint(c, c.req.param('id'));
    const target = await mine(c, c.req.query('beach'));
    const fit = await fitOf(me, jsonMap(r.items), target);
    return c.json({ ok: fit.short.length === 0, ...fit });
  });

  /**
   * Put a saved beach's bytes onto one of your beaches, inside asEditor's
   * transaction: what was there becomes the beach's automatic "Before ..."
   * checkpoint (skipped if it had no save), and the epoch goes up so other
   * devices reload instead of saving over it. Shared by a restore and a
   * copy, so the two can't drift.
   */
  const writeOnto = async (
    tx: Db,
    target: string,
    bytes: Uint8Array,
    info: { nx: number; ny: number },
    placed: Record<string, number>,
    beforeName: string,
    copied?: { from: string; code: string; version: number },
  ) => {
    const current = (await tx.query<{ sand: unknown }>('SELECT sand FROM beach WHERE id = $1 AND sand IS NOT NULL', [target]))[0];
    let before: { items: Record<string, number>; objects: number } = { items: {}, objects: 0 };
    if (current) {
      try {
        before = inspectBlob(toBytes(current.sand));
      } catch {
        /* an unreadable old save: keep it, uncounted */
      }
    }
    const now = clock();
    const rows = await tx.query<{ version: number; epoch: number; undo: string | null }>(
      `WITH snap AS (
         INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, from_name, location, nx, ny, sand, bytes, items, objects, created_at, origin_beach_id)
         SELECT $1, owner_id, $2, 'auto', 'beach', id, name, location, nx, ny, sand, octet_length(sand), $3, $4, $5, id
           FROM beach WHERE id = $6 AND sand IS NOT NULL
         ON CONFLICT (from_beach) WHERE kind = 'auto' DO UPDATE SET
           name = EXCLUDED.name, from_name = EXCLUDED.from_name, location = EXCLUDED.location, nx = EXCLUDED.nx, ny = EXCLUDED.ny,
           sand = EXCLUDED.sand, bytes = EXCLUDED.bytes, items = EXCLUDED.items, objects = EXCLUDED.objects, created_at = EXCLUDED.created_at,
           origin_beach_id = EXCLUDED.origin_beach_id
         RETURNING id
       )
       UPDATE beach SET sand = $7, nx = $8, ny = $9, items = $10, version = version + 1, updated_at = $5, epoch = epoch + 1,
              simulated_until = $5,
              copied_from = CASE WHEN $11::boolean THEN $12::uuid ELSE copied_from END,
              copied_from_code = CASE WHEN $11::boolean THEN $13 ELSE copied_from_code END,
              copied_version = CASE WHEN $11::boolean THEN $14::integer ELSE copied_version END
        WHERE id = $6
       RETURNING version, epoch, (SELECT id FROM snap) AS undo`,
      [
        crypto.randomUUID(),
        beforeName.slice(0, 80),
        JSON.stringify(before.items),
        before.objects,
        now,
        target,
        bytes,
        info.nx,
        info.ny,
        JSON.stringify(placed),
        !!copied,
        copied?.from ?? null,
        copied?.code ?? null,
        copied?.version ?? null,
      ],
    );
    return { version: rows[0].version, epoch: Number(rows[0].epoch), updatedAt: now, undo: rows[0].undo };
  };

  // put a checkpoint on one of your beaches; what was there becomes its
  // "before restoring" checkpoint, so it can be undone
  app.post('/beaches/mine/:id/restore', requireUser, async (c) => {
    const me = c.get('user').id;
    const target = await mine(c, c.req.param('id'));
    const { checkpoint, mode = 'strict' } = await body<{ checkpoint?: string; mode?: 'strict' | 'drop-missing' }>(c);
    if (mode !== 'strict' && mode !== 'drop-missing') fail(400, 'mode must be strict or drop-missing');
    // a restore replaces the beach: only the current editor may do it
    await requireEditToken(c);
    const cp = await myCheckpoint(c, checkpoint);
    if (!restoreLimiter(me)) fail(429, 'too many restores: try again later');
    return oneAtATime(me, () => asEditor(c, async (tx) => {
      let bytes = toBytes(cp.sand);
      const info = inspect(bytes);
      const fit = await fitOf(me, info.items, target, tx);
      let dropped = 0;
      if (fit.short.length) {
        if (mode === 'strict') return c.json({ error: 'short', short: fit.short }, 409);
        ({ bytes, dropped } = dropMissing(bytes, fit.short));
      }
      const placed = dropped ? inspect(bytes) : info;
      const done = await writeOnto(tx, target, bytes, info, placed.items, `Before restoring “${cp.name}”`);
      return c.json({ ...done, dropped });
    }));
  });

  // ---------------------------------------------------------------- copying a beach
  // Copy a beach on the shore (or one of your own) onto one of your beaches,
  // or a new one (docs/COPY_BEACH.md). Like a restore, with someone else's
  // save as the source. specs/tla/BeachCopy.tla: the read of the source
  // (public, the version you previewed), the bag and allowance checks and
  // the write are one transaction holding your player lock, with the
  // source row read FOR SHARE, so its owner's save or hide waits for it.
  const copyLimiter = createRateLimiter(20, 3600000);
  const NO_BEACH = '00000000-0000-0000-0000-000000000000';
  interface CopySource {
    id: string;
    owner_id: string;
    code: string;
    name: string;
    owner_name: string | null;
    location: string | null;
    version: number;
    updated_at: string | null;
    on_shore: boolean;
    sand: unknown;
  }
  /** a beach you may copy: public (on the shore and saved), or yours and saved; else 404 */
  const copySource = async (q: Db, code: string | undefined, me: string, lock = false): Promise<CopySource> => {
    const rows = await q.query<CopySource>(
      `SELECT b.id, b.owner_id, b.code, b.name, u.name AS owner_name, b.location, b.version, b.updated_at, b.on_shore, b.sand
         FROM beach b JOIN users u ON u.id = b.owner_id
        WHERE b.code = $1${lock ? ' FOR SHARE OF b' : ''}`,
      [normalizeCode(code ?? '')],
    );
    const r = rows[0];
    if (!r || r.sand === null || (r.owner_id !== me && !r.on_shore)) fail(404, 'no beach to copy with that code');
    return r!;
  };
  /** the copy's target: one of your beaches, or 'new' (null) */
  const copyTarget = async (c: Context<Env>, raw: unknown): Promise<string | null> => {
    if (raw === 'new') return null;
    if (typeof raw !== 'string') return fail(400, "target is one of your beaches, or 'new'");
    return mine(c, raw);
  };
  const beachCount = async (me: string, q: Db = db) =>
    Number((await q.query<{ n: string }>('SELECT COUNT(*) AS n FROM beach WHERE owner_id = $1', [me]))[0]?.n ?? 0);

  // would it fit? what's short, and what to buy so it does
  app.get('/beaches/:code/copy-fit', requireUser, async (c) => {
    const me = c.get('user').id;
    const src = await copySource(db, c.req.param('code'), me);
    const target = await copyTarget(c, c.req.query('target') ?? 'new');
    const info = inspect(toBytes(src.sand));
    const fit = await fitOf(me, info.items, target ?? NO_BEACH);
    const [allowed, count] = await Promise.all([allowance(me), beachCount(me)]);
    const room = target !== null || count < allowed;
    const prices = await offerPrices();
    const basket = copyBasket(fit.short, !room && count < BEACH_CAP, (p) => prices.get(p.id) ?? null);
    const [me_] = await db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [me]);
    return c.json({
      code: src.code,
      name: src.name,
      owner: src.owner_name?.trim() || null,
      yours: src.owner_id === me,
      location: src.location,
      version: Number(src.version),
      updatedAt: src.updated_at === null ? null : Number(src.updated_at),
      nx: info.nx,
      ny: info.ny,
      objects: info.objects,
      ...fit,
      room,
      allowance: allowed,
      beaches: count,
      basket,
      bucks: centsToBucks(Number(me_?.credit_cents ?? 0)),
    });
  });

  // copy it: onto one of your beaches (replacing it, undoable) or a new one
  app.post('/beaches/mine/copy', requireUser, async (c) => {
    const me = c.get('user').id;
    const p = await body<{ from?: string; version?: number; target?: string; mode?: 'strict' | 'drop-missing'; name?: string; location?: string }>(c);
    const mode = p.mode ?? 'strict';
    if (mode !== 'strict' && mode !== 'drop-missing') fail(400, 'mode must be strict or drop-missing');
    if (!Number.isSafeInteger(p.version)) fail(400, 'version is the one you previewed');
    if (p.location !== undefined && !/^[a-z0-9-]{1,40}$/.test(p.location)) fail(400, 'bad location');
    const target = await copyTarget(c, p.target);
    await requireEditToken(c);
    if (!copyLimiter(me)) fail(429, 'too many copies: try again later');
    return oneAtATime(me, () => asEditor(c, async (tx) => {
      // Lock the two beach rows in id order before reading either: the
      // target for the update, the source shared (it can't change or leave
      // the shore until this commits). Two owners copying each other's beach
      // onto their own at once would otherwise each share the row the other
      // updates, and PostgreSQL would abort one as a deadlock (PR #118 review).
      const srcId = (await tx.query<{ id: string }>('SELECT id FROM beach WHERE code = $1', [normalizeCode(p.from ?? '')]))[0]?.id;
      const rows = [...new Set([srcId, target].filter((x): x is string => !!x))].sort();
      for (const id of rows) {
        await tx.query(`SELECT id FROM beach WHERE id = $1 ${id === target ? 'FOR NO KEY UPDATE' : 'FOR SHARE'}`, [id]);
      }
      const src = await copySource(tx, p.from, me);
      if (Number(src.version) !== p.version) return c.json({ error: 'changed', version: Number(src.version) }, 409);
      let bytes = toBytes(src.sand);
      const info = inspect(bytes);
      let beach = target;
      if (beach === null) {
        // a new beach: only if you're under your allowance (we hold your lock)
        const allowed = await allowance(me, tx);
        if ((await beachCount(me, tx)) >= allowed) return c.json({ error: 'room' }, 409);
        const name = (p.name ?? `${src.name || 'Beach'} (copy)`).trim().slice(0, 30);
        const location = p.location ?? src.location ?? null;
        const made = await tx.query<{ id: string }>(
          `INSERT INTO beach (id, owner_id, code, name, home, location, created_at) VALUES ($1, $2, $3, $4, false, $5, $6) RETURNING id`,
          [crypto.randomUUID(), me, newNeighborCode(), name, location, clock()],
        );
        beach = made[0].id;
      }
      if (beach === src.id) fail(400, 'that is the beach you are copying');
      const fit = await fitOf(me, info.items, beach, tx);
      let dropped = 0;
      if (fit.short.length) {
        if (mode === 'strict') {
          // nothing written: the new beach (if any) goes with the rollback
          throw new CopyShort(fit.short);
        }
        ({ bytes, dropped } = dropMissing(bytes, fit.short));
      }
      const placed = dropped ? inspect(bytes) : info;
      const done = await writeOnto(tx, beach, bytes, info, placed.items, `Before copying “${src.name || src.code}”`, {
        from: src.id,
        code: src.code,
        version: Number(src.version),
      });
      if (src.owner_id !== me) {
        // counted once per person; the owner hears about it the first time
        const first = await tx.query('INSERT INTO beach_copies (source_beach, copier, first_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING 1', [
          src.id,
          me,
          clock(),
        ]);
        if (first.length) {
          await tx.query(`INSERT INTO inbox (user_id, kind, actor_id, beach_id, created_at) VALUES ($1, 'copied', $2, $3, $4)`, [src.owner_id, me, src.id, clock()]);
        }
      }
      logEvent('beach_copy', { mode, dropped, fresh: target === null, own: src.owner_id === me });
      return c.json({ beach, code: (await tx.query<{ code: string }>('SELECT code FROM beach WHERE id = $1', [beach]))[0].code, ...done, dropped });
    })).catch((e) => {
      if (e instanceof CopyShort) return c.json({ error: 'short', short: e.short }, 409);
      throw e;
    });
  });

  // keep a copy as a checkpoint: nothing is placed, so the bag isn't checked
  app.post('/checkpoints/copy', requireUser, async (c) => {
    const me = c.get('user').id;
    const p = await body<{ from?: string; version?: number }>(c);
    if (!makeLimiter(me)) fail(429, 'too many checkpoints at once: try again later');
    const src = await copySource(db, p.from, me);
    if (p.version !== undefined && Number(src.version) !== p.version) return c.json({ error: 'changed', version: Number(src.version) }, 409);
    const bytes = toBytes(src.sand);
    const info = inspect(bytes);
    await checkRoom(me, bytes.byteLength);
    const id = crypto.randomUUID();
    const label = (src.name || src.code).slice(0, CHECKPOINT_NAME_MAX);
    await db.query(
      `INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, from_name, location, nx, ny, sand, bytes, items, objects, created_at)
       VALUES ($1, $2, $3, 'named', 'copy', NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, me, label, `${src.owner_name?.trim() || 'Someone'} · ${src.code}`, src.location, info.nx, info.ny, bytes, bytes.byteLength, JSON.stringify(info.items), info.objects, clock()],
    );
    return c.json({ checkpoint: checkpointJson((await myCheckpoint(c, id)) as CheckpointRow) }, 201);
  });

  // ---------------------------------------------------------------- the shop
  // The app buys through Apple / Google; we only check and grant (store.ts).
  const bundleId = cfg.appleBundleId ?? 'app.beech.beach';
  const androidPackage = cfg.androidPackage ?? 'app.beech.beach';
  const stores = {
    apple: cfg.stores?.apple ?? ((jws: string, b: string) => verifyAppleTransaction(jws, b)),
    google: cfg.stores?.google ?? verifyGooglePurchase,
    appleRefund: cfg.stores?.appleRefund ?? ((p: string, b: string) => appleRefund(p, b)),
    googleVoided: cfg.stores?.googleVoided ?? googleVoided,
  };

  app.get('/store/products', async (c) => {
    const price = await creatorOffers(db);
    return c.json({
      products: PRODUCTS.flatMap((p) => {
        if (p.bucksOnly) return [];
        const cents = price(p);
        return cents === null ? [] : [{ id: p.id, name: p.name, grants: p.grants, usd: cents / 100, blurb: p.blurb, featured: !!p.featured }];
      }),
      // the web shop can take payment itself (Xsolla), instead of pointing at the apps
      webCheckout: !!cfg.xsolla,
    });
  });

  /** what each offer costs now, in beech bucks (null: not for sale) */
  const offerPrices = async (q: Db = db): Promise<Map<string, number | null>> => {
    const out = new Map<string, number | null>();
    for (const p of PRODUCTS) {
      const cents = offerCents(p, await creatorOffer(q, p));
      out.set(p.id, cents === null ? null : centsToBucks(cents));
    }
    return out;
  };

  // The shop for apps that know beech bucks (docs/BEECH_BUCKS.md): packs for
  // real money, offers for beech bucks. (/store/products stays as it was for
  // the app versions already in the stores.)
  app.get('/store/catalog', async (c) => {
    const prices = await offerPrices();
    return c.json({
      packs: PACKS.map((p) => ({ id: p.id, name: p.name, usd: p.usd, bucks: p.bucks, blurb: p.blurb, featured: !!p.featured })),
      offers: PRODUCTS.flatMap((p) => {
        const bucks = prices.get(p.id);
        return bucks === null || bucks === undefined ? [] : [{ id: p.id, name: p.name, grants: p.grants, bucks, blurb: p.blurb, featured: !!p.featured }];
      }),
      webCheckout: !!cfg.xsolla,
    });
  });

  /**
   * The app finished a purchase: { platform: ios | android, productId, jws (iOS) | token (Android) }.
   * We check it with the store, record it once, and add what it grants to
   * your bag. Sending the same purchase again is harmless (it says so).
   */
  app.post('/store/purchase', requireUser, async (c) => {
    const me = c.get('user').id;
    const { platform, productId, jws, token } = await body<{ platform?: string; productId?: string; jws?: string; token?: string }>(c);
    const product = realMoneyProductById(productId ?? '');
    if (!product) fail(404, 'no such product');
    const ok = (platform === 'ios' && jws) || (platform === 'android' && token) || (platform === 'dev' && cfg.devAuth && token);
    if (!ok) fail(400, 'expected { platform: ios, jws } or { platform: android, token }');
    let v: VerifiedPurchase;
    try {
      if (platform === 'ios') v = await stores.apple(jws!, bundleId);
      else if (platform === 'android') v = await stores.google(androidPackage, product!.id, token!);
      // local development and e2e only: a pretend store
      else v = { store: 'dev', transactionId: token!, productId: product!.id, environment: 'Dev', purchasedAt: clock() };
    } catch (e) {
      return c.json({ error: `the store did not confirm this purchase: ${(e as Error).message}` }, 402);
    }
    if (v!.productId !== product!.id) fail(400, 'that purchase is for a different product');
    // the app ties each purchase to the account that made it
    if (v!.account && v!.account !== me) fail(403, 'that purchase belongs to another account');
    const now = clock();
    // Record it once, then grant (a pack's beech bucks, or an old app's
    // things) and any creator credit in the same transaction.
    const { rows, promo } = await db.withTransaction(async (tx) => {
      const granted = await tx.query<{ purchase_id: string }>(
        `INSERT INTO purchases (user_id, store, transaction_id, product_id, environment, purchased_at, granted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (store, transaction_id) DO NOTHING
         RETURNING id AS purchase_id`,
        [me, v.store, v.transactionId, product!.id, v.environment, v.purchasedAt, now],
      );
      let appliedPromo: { code: string; bonusBucks: number } | null = null;
      if (granted.length) {
        appliedPromo = (await grantPurchase(tx, { userId: me, purchaseId: granted[0].purchase_id, product: product!, now })).promo;
      }
      if (granted.length && v.store !== 'dev' && v.environment.toLowerCase() === 'production') {
        const offer = await creatorOffer(tx, product!, true);
        if (offer) {
          const purchaseId = granted[0].purchase_id;
          await awardCreatorCredit(tx, {
            offer, buyer: me, purchaseRef: `store:${purchaseId}`, storePurchaseId: purchaseId,
            paidCents: await nativeSalePrice(tx, offer.id, v.purchasedAt), now,
          });
        }
      }
      return { rows: granted, promo: appliedPromo };
    });
    if (!rows.length) {
      const prev = (await db.query<{ user_id: string }>('SELECT user_id FROM purchases WHERE store = $1 AND transaction_id = $2', [v!.store, v!.transactionId]))[0];
      if (prev && prev.user_id !== me) fail(409, 'that purchase was already used by another account');
      return c.json({ already: true, product: product!.id, grants: product!.grants });
    }
    return c.json({ already: false, product: product!.id, grants: product!.grants, promo: promo ?? undefined });
  });

  /** A refund: the purchase is marked, and what it granted expires now. */
  const refund = async (store: 'apple' | 'google' | 'xsolla' | 'steam', transactionId: string) => {
    await revokeStorePurchase(db, store, transactionId, clock());
  };

  // App Store Server Notifications V2 (set this URL in App Store Connect → App Information)
  app.post('/store/apple/notifications', async (c) => {
    const { signedPayload } = await body<{ signedPayload?: string }>(c);
    if (!signedPayload) fail(400, 'expected signedPayload');
    let tx: string | null;
    try {
      tx = await stores.appleRefund(signedPayload!, bundleId);
    } catch {
      return fail(401, 'not from Apple');
    }
    if (tx) await refund('apple', tx);
    return c.body(null, 200);
  });

  // Google Play real-time developer notifications (a Pub/Sub push subscription to this URL)
  app.post('/store/google/rtdn', async (c) => {
    if (!cfg.googleRtdn) fail(404, 'not set up');
    let order: string | null;
    try {
      order = await stores.googleVoided(c.req.header('Authorization'), await body(c), cfg.googleRtdn!);
    } catch {
      return fail(401, 'not from Google');
    }
    if (order) await refund('google', order);
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- web checkout (Xsolla)
  // docs/WEB_PAYMENTS.md. The browser shop pays through Xsolla Pay Station
  // (Xsolla is the merchant of record); the apps never use this — they sell
  // through Apple and Google only. A paid order grants exactly what a store
  // purchase grants, through the same purchases + inventory rows.
  const WEB_ORDER_TTL_MS = 24 * 3600 * 1000; // Xsolla's payment tokens last 24 hours
  const xsollaToken = cfg.xsollaToken ?? createPaymentToken;
  const checkoutLimiter = createRateLimiter(10); // checkouts started, per user per minute

  interface WebOrderRow {
    id: string;
    user_id: string;
    product_id: string;
    amount_cents: number;
    creator_submission_id: string | null;
    provider_order_id: string | null;
    sandbox: boolean;
    status: string;
    created_at: string | number;
    paid_at: string | number | null;
  }
  /** an unpaid order past its token's life reads as expired (no sweeper needed) */
  const orderView = (o: WebOrderRow) => {
    const created = Number(o.created_at);
    const status = o.status === 'created' && clock() - created > WEB_ORDER_TTL_MS ? 'expired' : o.status;
    return {
      id: o.id,
      productId: o.product_id,
      amountCents: Number(o.amount_cents),
      status,
      createdAt: created,
      paidAt: o.paid_at === null ? null : Number(o.paid_at),
      grants: storeProductById(o.product_id)?.grants ?? [],
    };
  };
  const isUuid = (s: string) => UUID_PATTERN.test(s);

  const webCheckout = async (c: Context<Env>) => {
    if (!cfg.xsolla) fail(404, 'buying on the web is not open yet: buy in the beech app');
    const me = c.get('user').id;
    if (!checkoutLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const { productId, promoCode, country: rawCountry, mount } = await body<{ productId?: string; promoCode?: string; country?: unknown; mount?: unknown }>(c);
    // from your account page on beechshore: Pay Station comes back there, to
    // one of two fixed places (never a URL from the request)
    let returnUrl: string | undefined;
    if (c.get('shore')) {
      if (!packById(productId ?? '')) fail(400, 'only sand-dollar packs are sold here');
      returnUrl = mount === 'game' ? new URL('/shore/account', cfg.xsolla?.returnUrl ?? 'https://play.beech.games/').toString() : `${(cfg.shoreUrl ?? 'https://beechshore.com').replace(/\/$/, '')}/account`;
    }
    // the web sells beech-buck packs (docs/BEECH_BUCKS.md); item products stay
    // accepted for a page loaded before the beech-bucks release
    const product = realMoneyProductById(productId ?? '');
    if (!product) fail(404, 'no such product');
    if (rawCountry !== undefined && (typeof rawCountry !== 'string' || !/^[A-Za-z]{2}$/.test(rawCountry))) {
      return fail(400, 'country must be a two-letter code');
    }
    const country = rawCountry?.toUpperCase();
    // Xsolla charges its catalog price, so a promo from our own list can't
    // discount a card payment (docs/WEB_PAYMENTS.md, "Promo codes"). A code
    // loaded on the account applies automatically as bonus bb when a bb pack
    // grants, so a promoCode sent here is refused with a pointer there.
    if (promoCode) fail(400, 'promo codes apply automatically from your account: load the code first, then pay by card');
    const id = crypto.randomUUID();
    const now = clock();
    const offer = await creatorOffer(db, product!);
    const amount = salePriceCents(product!, offer) ?? fail(404, 'that product is not for sale');
    // a free item has nothing to pay: it's claimed through /store/credit-purchase
    if (amount === 0) fail(400, 'that one is free: claim it in the shop');
    await db.query(
      `INSERT INTO web_orders (id, user_id, product_id, amount_cents, sandbox, created_at, creator_submission_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, me, product!.id, amount, cfg.xsolla!.sandbox, now, offer?.id ?? null],
    );
    let t: { token: string; orderId: string };
    try {
      t = await xsollaToken(cfg.xsolla!, {
        userId: me,
        sku: product!.id,
        webOrderId: id,
        returnUrl,
        country,
        ip: (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim() || undefined,
      });
    } catch (e) {
      // the order never got a token: nothing can pay it, so drop it
      await db.query('DELETE FROM web_orders WHERE id = $1', [id]);
      logEvent('web_checkout_error', { product: product!.id, message: (e as Error).message }, 'ERROR');
      return c.json({ error: 'the checkout could not be opened right now: try again in a minute' }, 502);
    }
    await db.query('UPDATE web_orders SET provider_order_id = $2 WHERE id = $1', [id, t!.orderId]);
    logEvent('web_checkout', { product: product!.id, order: id, sandbox: cfg.xsolla!.sandbox });
    return c.json({ order: id, url: payStationUrl(t!.token, cfg.xsolla!.sandbox) });
  };
  app.post('/store/web-checkout', requireUser, webCheckout);

  const webOrder = async (c: Context<Env>) => {
    const id = c.req.param('id') ?? '';
    if (!isUuid(id)) fail(404, 'no such order');
    const rows = await db.query<WebOrderRow>('SELECT * FROM web_orders WHERE id = $1 AND user_id = $2', [id, c.get('user').id]);
    if (!rows[0]) fail(404, 'no such order');
    return c.json({ order: orderView(rows[0]) });
  };
  app.get('/store/web-orders/:id', requireUser, webOrder);

  /**
   * Xsolla's webhooks. Not session-authenticated: the signature is the
   * authentication, checked over the raw body before anything is parsed.
   * Answers 204 to anything verified and handled (including a repeat, so
   * Xsolla's retries are harmless), 400 with Xsolla's error body otherwise.
   */
  app.post('/store/xsolla/webhook', async (c) => {
    if (!cfg.xsolla) fail(404, 'not set up');
    const x = cfg.xsolla!;
    const raw = new Uint8Array(await c.req.arrayBuffer());
    if (!verifyWebhookSignature(raw, c.req.header('Authorization'), x.webhookSecret)) {
      logEvent('xsolla_webhook', { outcome: 'bad_signature' }, 'WARNING');
      return c.json(xsollaError('INVALID_SIGNATURE', 'Invalid signature'), 400);
    }
    let w: XsollaWebhook;
    try {
      w = JSON.parse(new TextDecoder().decode(raw)) as XsollaWebhook;
    } catch {
      return c.json(xsollaError('INVALID_PARAMETER', 'Invalid JSON'), 400);
    }
    const type = w.notification_type ?? '';
    const log = (outcome: string, extra: Record<string, unknown> = {}, sev: 'INFO' | 'WARNING' | 'ERROR' = 'INFO') =>
      logEvent('xsolla_webhook', { type, outcome, order: w.order?.id ?? null, ...extra }, sev);

    const userExists = async (id: string | undefined) =>
      !!id && isUuid(id) && (await db.query<{ id: string }>('SELECT id FROM users WHERE id = $1', [id])).length > 0;

    if (type === 'user_validation') {
      if (!(await userExists(w.user?.id ?? w.user?.external_id))) {
        log('invalid_user', {}, 'WARNING');
        return c.json(xsollaError('INVALID_USER', 'Invalid user'), 400);
      }
      return c.body(null, 204);
    }

    // find our order: by Xsolla's order id, else by the id we sent it
    const ours = w.custom_parameters?.web_order ?? w.transaction?.external_id ?? w.billing?.transaction?.external_id;
    const providerId = w.order?.id !== undefined ? String(w.order.id) : null;
    const find = async () => {
      if (providerId) {
        const r = await db.query<WebOrderRow>('SELECT * FROM web_orders WHERE provider_order_id = $1', [providerId]);
        if (r[0]) return r[0];
      }
      if (ours && isUuid(ours)) return (await db.query<WebOrderRow>('SELECT * FROM web_orders WHERE id = $1', [ours]))[0];
      return undefined;
    };

    if (type === 'order_paid') {
      const o = await find();
      if (!o || !providerId || o.provider_order_id !== providerId) {
        log('unknown_order', {}, 'ERROR');
        return c.json(xsollaError('INCORRECT_INVOICE', 'Unknown order'), 400);
      }
      const buyer = w.user?.external_id ?? w.user?.id;
      if (buyer !== o.user_id) {
        log('wrong_user', {}, 'ERROR');
        return c.json(xsollaError('INVALID_USER', 'Invalid user'), 400);
      }
      // a sandbox (test card) payment never grants in a live setup
      const testPayment = w.order?.mode === 'sandbox' || w.billing?.transaction?.dry_run === 1 || w.transaction?.dry_run === 1;
      if (testPayment && !x.sandbox) {
        log('sandbox_payment_on_live', {}, 'ERROR');
        return c.json(xsollaError('INVALID_PARAMETER', 'Sandbox payment'), 400);
      }
      // what was paid for must be exactly what we sold: the product, once,
      // and (in US dollars) our price
      const product = storeProductById(o.product_id)!;
      const items = w.items ?? [];
      if (items.length !== 1 || items[0].sku !== product.id || Number(items[0].quantity ?? 1) !== 1) {
        log('wrong_items', { items: items.map((i) => i.sku) }, 'ERROR');
        return c.json(xsollaError('INCORRECT_INVOICE', 'Unexpected items'), 400);
      }
      const currency = (w.order?.currency ?? '').toUpperCase();
      const paidCents = Math.round(Number(w.order?.amount ?? NaN) * 100);
      if (currency === 'USD' && paidCents !== Number(o.amount_cents)) {
        log('wrong_amount', { paid_cents: paidCents, want_cents: Number(o.amount_cents) }, 'ERROR');
        return c.json(xsollaError('INCORRECT_AMOUNT', 'Incorrect amount'), 400);
      }
      if (currency && currency !== 'USD') log('local_currency', { currency });
      const now = clock();
      // Record the payment once, mark the order paid, and grant (beech bucks) and credit atomically.
      // A retried webhook hits the purchases unique key and changes nothing.
      // An order Xsolla already canceled is not revived by a late payment.
      const granted = await db.withTransaction(async (tx) => {
        const [order] = await tx.query<{ status: string }>('SELECT status FROM web_orders WHERE id = $1 FOR NO KEY UPDATE', [o.id]);
        if (order?.status !== 'created') return [];
        const rows = await tx.query<{ purchase_id: string }>(
          `WITH p AS (
             INSERT INTO purchases (user_id, store, transaction_id, product_id, environment, purchased_at, granted_at)
             VALUES ($1, 'xsolla', $2, $3, $4, $5, $5)
             ON CONFLICT (store, transaction_id) DO NOTHING
             RETURNING id, user_id
           ), o AS (
             UPDATE web_orders SET status = 'paid', paid_at = $5 WHERE id = $6 AND status = 'created' AND EXISTS (SELECT 1 FROM p)
             RETURNING id
           )
           SELECT p.id AS purchase_id FROM p`,
          [o.user_id, providerId, product.id, testPayment ? 'Sandbox' : 'Production', now, o.id],
        );
        if (rows.length) await grantPurchase(tx, { userId: o.user_id, purchaseId: rows[0].purchase_id, product, now });
        if (rows.length && o.creator_submission_id && !testPayment && !o.sandbox) {
          await awardCheckoutCreatorCredit(tx, {
            submissionId: o.creator_submission_id, product, buyer: o.user_id, storePurchaseId: rows[0].purchase_id,
            paidCents: Number(o.amount_cents), now,
          });
        }
        return rows;
      });
      log(granted.length ? 'granted' : 'already', { product: product.id });
      return c.body(null, 204);
    }

    if (type === 'order_canceled' || type === 'refund') {
      const o = await find();
      if (!o) {
        log('unknown_order', {}, 'WARNING');
        // nothing of ours to take back; don't make Xsolla retry for days
        return c.body(null, 204);
      }
      await db.withTransaction(async (tx) => {
        // Take the order lock first, just like settlement. A concurrent refund
        // either prevents the grant or reverses the already completed grant.
        await tx.query(
          `UPDATE web_orders SET status = CASE WHEN status = 'paid' THEN 'refunded' ELSE 'canceled' END
            WHERE id = $1 AND status IN ('created', 'paid')`,
          [o.id],
        );
        if (o.provider_order_id) await revokeStorePurchase(tx, 'xsolla', o.provider_order_id, clock());
      });
      log('revoked', { was: o.status });
      return c.body(null, 204);
    }

    // payment, partial refunds, disputes and the rest: acknowledged, acted
    // on elsewhere (order_paid / order_canceled carry what we need)
    log('ignored');
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- Steam Wallet (ISteamMicroTxn)
  // docs/STEAM.md. Server-authoritative Steam Wallet microtransactions:
  //   1. POST /store/steam/init { productId } -> InitTxn/v3 (opens Steam Overlay)
  //   2. POST /store/steam/finalize { orderId } -> FinalizeTxn/v2 + atomic grant
  //   3. POST /store/steam/cancel { orderId } -> marks order canceled
  const steamInit = cfg.steamTxn?.init ?? initSteamTxn;
  const steamFinalize = cfg.steamTxn?.finalize ?? finalizeSteamTxn;
  const isOrderId = (s: string) => /^\d{1,19}$/.test(s);

  app.post('/store/steam/init', requireUser, async (c) => {
    if (!cfg.steamStore) fail(404, 'Steam purchases are not enabled yet');
    const me = c.get('user').id;
    if (!checkoutLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const { productId } = await body<{ productId?: string }>(c);
    // Steam sells beech-buck packs (docs/BEECH_BUCKS.md); the item products stay
    // on sale here for the Steam builds already out (PR #118 review)
    const product = realMoneyProductById(productId ?? '');
    if (!product) fail(404, 'no such product');

    const idRows = await db.query<{ provider_sub: string }>(
      "SELECT provider_sub FROM user_identities WHERE user_id = $1 AND provider = 'steam' LIMIT 1",
      [me],
    );
    const steamId = idRows[0]?.provider_sub;
    if (!steamId) fail(400, 'sign in through Steam to buy with Steam Wallet');

    const now = clock();
    const offer = await creatorOffer(db, product!);
    const amountCents = salePriceCents(product!, offer) ?? fail(404, 'that product is not for sale');
    if (amountCents === 0) fail(400, 'that one is free: claim it in the shop');
    const inserted = await db.query<{ order_id: string }>(
      `INSERT INTO steam_orders (user_id, steam_id, product_id, amount_cents, sandbox, created_at, creator_submission_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING order_id::text AS order_id`,
      [me, steamId, product!.id, amountCents, cfg.steamStore!.sandbox, now, offer?.id ?? null],
    );
    const orderId = inserted[0]!.order_id;
    try {
      const { transId } = await steamInit(cfg.steamStore!, {
        orderId,
        steamId,
        itemId: product!.steamItemId ?? fail(404, 'that product is not sold on Steam'),
        amountCents,
        description: product!.name,
      });
      await db.query('UPDATE steam_orders SET trans_id = $2 WHERE order_id = $1', [orderId, transId]);
      logEvent('steam_checkout_init', { product: product!.id, order_id: orderId, sandbox: cfg.steamStore!.sandbox });
      return c.json({ orderId });
    } catch (e) {
      await db.query('DELETE FROM steam_orders WHERE order_id = $1', [orderId]);
      logEvent('steam_checkout_error', { product: product!.id, message: (e as Error).message }, 'ERROR');
      return c.json({ error: 'Steam checkout could not be started right now: try again in a minute' }, 502);
    }
  });

  app.post('/store/steam/finalize', requireUser, async (c) => {
    if (!cfg.steamStore) fail(404, 'Steam purchases are not enabled yet');
    const me = c.get('user').id;
    const { orderId } = await body<{ orderId?: string }>(c);
    const oid = String(orderId ?? '').trim();
    if (!isOrderId(oid)) fail(400, 'invalid orderId');

    const rows = await db.query<{ product_id: string; amount_cents: number; creator_submission_id: string | null; sandbox: boolean; status: string }>(
      'SELECT product_id, amount_cents, creator_submission_id, sandbox, status FROM steam_orders WHERE order_id = $1 AND user_id = $2',
      [oid, me],
    );
    const o = rows[0];
    if (!o) fail(404, 'no such order');
    const product = storeProductById(o!.product_id)!;
    if (o!.status === 'paid') return c.json({ ok: true, already: true, grants: product.grants });
    if (o!.status !== 'created') fail(409, `order is ${o!.status}`);

    let transId: string;
    try {
      const r = await steamFinalize(cfg.steamStore!, oid);
      transId = r.transId;
    } catch (e) {
      logEvent('steam_finalize_error', { order_id: oid, message: (e as Error).message }, 'WARNING');
      return c.json({ error: 'Steam could not finalize that purchase yet' }, 402);
    }

    const now = clock();
    const granted = await db.withTransaction(async (tx) => {
      const [order] = await tx.query<{ status: string }>('SELECT status FROM steam_orders WHERE order_id = $1 FOR NO KEY UPDATE', [oid]);
      if (order?.status === 'paid') return { rows: [] as { purchase_id: string }[], promo: null };
      if (order?.status !== 'created') fail(409, 'the order is no longer open');
      const rows = await tx.query<{ purchase_id: string }>(
        `WITH p AS (
           INSERT INTO purchases (user_id, store, transaction_id, product_id, environment, purchased_at, granted_at)
           VALUES ($1, 'steam', $2, $3, $4, $5, $5)
           ON CONFLICT (store, transaction_id) DO NOTHING
           RETURNING id, user_id
         ), o AS (
           UPDATE steam_orders SET status = 'paid', trans_id = $2, paid_at = $5
            WHERE order_id = $6 AND status = 'created' AND EXISTS (SELECT 1 FROM p)
           RETURNING order_id
         )
         SELECT p.id AS purchase_id FROM p`,
        [me, transId, product.id, o!.sandbox ? 'Sandbox' : 'Production', now, oid],
      );
      let appliedPromo: { code: string; bonusBucks: number } | null = null;
      if (rows.length) appliedPromo = (await grantPurchase(tx, { userId: me, purchaseId: rows[0].purchase_id, product, now })).promo;
      if (rows.length && o!.creator_submission_id && !o!.sandbox) {
        await awardCheckoutCreatorCredit(tx, {
          submissionId: o!.creator_submission_id, product, buyer: me, storePurchaseId: rows[0].purchase_id,
          paidCents: Number(o!.amount_cents), now,
        });
      }
      return { rows, promo: appliedPromo };
    });
    logEvent('steam_checkout_paid', { product: product.id, order_id: oid, granted: granted.rows.length > 0 });
    return c.json({ ok: true, already: granted.rows.length === 0, grants: product.grants, promo: granted.promo ?? undefined });
  });

  app.post('/store/steam/cancel', requireUser, async (c) => {
    const me = c.get('user').id;
    const { orderId } = await body<{ orderId?: string }>(c);
    const oid = String(orderId ?? '').trim();
    if (!isOrderId(oid)) fail(400, 'invalid orderId');
    await db.query("UPDATE steam_orders SET status = 'canceled' WHERE order_id = $1 AND user_id = $2 AND status = 'created'", [oid, me]);
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- gift cards, promos, credit
  // Gift cards are prepaid credit; promo codes are loaded onto an account and
  // automatically grant extra bonus bb on the next matching bb pack purchase
  // (always picking the loaded code that gives the best bonus for that pack).
  // See docs/GIFT_CARDS_PROMOS.md and specs/tla/PromoCodes.tla.
  const redeemLimiter = createRateLimiter(10); // gift card / promo code attempts, per user per minute
  const creditLimiter = createRateLimiter(30); // quotes and credit purchases, per user per minute

  const packBonusesFor = (promos: Awaited<ReturnType<typeof accountPromos>>) => {
    const out: Record<string, { code: string; bonusBucks: number }> = {};
    for (const p of PACKS) {
      const best = bestPromoForPack(promos, p);
      if (best) out[p.id] = best;
    }
    return out;
  };

  const loadPromoHandler = async (c: Context<Env>) => {
    const me = c.get('user').id;
    if (!redeemLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const { code } = await body<{ code?: string }>(c);
    const now = clock();
    const res = await loadAccountPromo(db, me, String(code ?? ''), now);
    if (!res.ok) return fail(res.status, res.error);
    const promos = await accountPromos(db, me, now);
    return c.json({ promo: res.promo, promos, packBonuses: packBonusesFor(promos) });
  };
  app.post('/promo-codes/load', requireUser, loadPromoHandler);
  app.get('/promo-codes/mine', requireUser, async (c) => {
    const promos = await accountPromos(db, c.get('user').id, clock());
    return c.json({ promos, packBonuses: packBonusesFor(promos) });
  });

  // --- players: redeem a gift card, see credit, buy with credit ---
  const redeemGiftCard = async (c: Context<Env>) => {
    const me = c.get('user').id;
    if (!redeemLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const { code } = await body<{ code?: string }>(c);
    if (!isGiftCodeShape(code ?? '')) fail(404, "that code isn't valid");
    const hash = hashGiftCode(code!, pepper);
    const now = clock();
    const known = (
      await db.query<{ status: string; expires_at: string | null }>('SELECT status, expires_at FROM gift_cards WHERE code_hash = $1', [hash])
    )[0];
    if (!known) fail(404, "that code isn't valid");
    if (known.status !== 'active') fail(409, known.status === 'redeemed' ? 'that card was already used' : 'that card is disabled');
    if (known.expires_at !== null && Number(known.expires_at) <= now) fail(409, 'that card has expired');
    // one transaction: claim the card (only if still active and unexpired —
    // a second redeem racing this one claims nothing), then its beech bucks
    // in (10 cents a buck, a part buck rounded up), paying off any debt first
    const result = await db.withTransaction(async (tx) => {
      const [claimed] = await tx.query<{ id: string; amount_cents: number }>(
        `UPDATE gift_cards SET status = 'redeemed', redeemed_by = $2, redeemed_at = $3
          WHERE code_hash = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > $3)
          RETURNING id, amount_cents`,
        [hash, me, now],
      );
      if (!claimed) return null;
      const cents = Math.ceil(Number(claimed.amount_cents) / BUCK) * BUCK;
      await creditBalance(tx, me, cents, 'gift_card', String(claimed.id), now);
      const [u] = await tx.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [me]);
      return { creditedCents: cents, creditCents: Number(u.credit_cents) };
    });
    if (!result) fail(409, 'that card was just used');
    return c.json({ ...result!, credited: result!.creditedCents / BUCK, bucks: result!.creditCents / BUCK });
  };
  app.post('/gift-cards/redeem', requireUser, redeemGiftCard);

  app.get('/credit', requireUser, async (c) => {
    const rows = await db.query<{ credit_cents: number; creator_credit_debt_cents: number }>(
      'SELECT credit_cents, creator_credit_debt_cents FROM users WHERE id = $1',
      [c.get('user').id],
    );
    const cents = Number(rows[0]?.credit_cents ?? 0);
    return c.json({ creditCents: cents, bucks: centsToBucks(cents), debt: centsToBucks(Number(rows[0]?.creator_credit_debt_cents ?? 0)) });
  });

  /** An offer's price in cents of beech bucks (whole bucks): a community item's approved price, rounded; else its bucks price. */
  const offerCents = (product: Product, offer: Awaited<ReturnType<typeof creatorOffer>>): number | null => {
    if (!offer) return bucksToCents(product.bucks);
    const cents = salePriceCents(product, offer);
    return cents === null ? null : roundToBuck(cents);
  };
  // What a product costs in beech bucks, before buying (docs/BEECH_BUCKS.md).
  // Promo codes never discount a credit purchase: they add bonus bb to bb
  // pack purchases, applied automatically from the account (see promos.ts),
  // so a promoCode sent here is refused.
  app.post('/store/quote', requireUser, async (c) => {
    const me = c.get('user').id;
    if (!creditLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const { productId, promoCode } = await body<{ productId?: string; promoCode?: string }>(c);
    if (promoCode !== undefined) fail(400, 'promo codes are for beech-buck packs: load the code on your account instead');
    const product = productById(productId ?? '');
    if (!product) fail(404, 'no such product');
    const priceCents = offerCents(product!, await creatorOffer(db, product!)) ?? fail(404, 'that product is not for sale');
    return c.json({
      product: product!.id,
      priceCents,
      discountCents: 0,
      finalCents: priceCents,
      price: centsToBucks(priceCents),
      final: centsToBucks(priceCents),
    });
  });

  /**
   * Buy with beech bucks (Spend in specs/tla/SandBucks.tla): one offer, or a
   * basket of them ("buy what's missing", docs/COPY_BEACH.md). The debit, the
   * grant (each unit with its trade-in value: the price paid, shared out) and
   * any creator credit commit together. A repeated request ID returns the
   * first receipt. Promo codes never apply here: they add bonus bb to bb
   * pack purchases, applied automatically from the account (see promos.ts).
   */
  const buyWithBucks = async (
    c: Context<Env>,
    me: string,
    lines: { product: Product; quantity: number }[],
    opts: { requestId?: string; freeOnly?: boolean; ref: string },
  ) => {
    const { requestId, freeOnly } = opts;
    if (requestId !== undefined && (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId))) fail(400, 'invalid request ID');
    if (freeOnly !== undefined && typeof freeOnly !== 'boolean') fail(400, 'invalid free claim');
    const now = clock();
    const result = await db.withTransaction(async (tx) => {
      const balance = async () => (await tx.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [me]))[0]?.credit_cents ?? 0;
      if (requestId) {
        const [claimed] = await tx.query(
          `INSERT INTO credit_shop_orders (user_id, request_id, product_id, promo_code, paid_cents, discount_cents)
           VALUES ($1, $2, $3, NULL, 0, 0) ON CONFLICT DO NOTHING RETURNING 1`,
          [me, requestId, opts.ref],
        );
        if (!claimed) {
          const [order] = await tx.query<{ product_id: string; promo_code: string | null; paid_cents: number; discount_cents: number }>(
            'SELECT product_id, promo_code, paid_cents, discount_cents FROM credit_shop_orders WHERE user_id = $1 AND request_id = $2',
            [me, requestId],
          );
          if (!order || order.product_id !== opts.ref || order.promo_code !== null) fail(409, 'that request ID was used for a different purchase');
          if (freeOnly && order.paid_cents !== 0) fail(409, 'that request ID was used for a paid purchase');
          return { paidCents: order.paid_cents, discountCents: order.discount_cents, creditCents: await balance() };
        }
      }
      // what each line costs, and its creator (if it's a community item)
      const priced: { product: Product; quantity: number; cents: number; offer: Awaited<ReturnType<typeof creatorOffer>> }[] = [];
      for (const l of lines) {
        const offer = await creatorOffer(tx, l.product, true);
        const cents = offerCents(l.product, offer) ?? fail(404, `${l.product.name} is not for sale`);
        priced.push({ ...l, cents, offer });
      }
      const price = priced.reduce((t, l) => t + l.cents * l.quantity, 0);
      if (freeOnly && price !== 0) fail(409, 'that item is no longer free. Reopen the shop for its current price.');
      const paid = price;
      for (const l of priced) if (l.offer) await lockCreditUsers(tx, me, l.offer);
      const available = await balance();
      if (available < paid) throw new HTTPException(402, {
        message: `not enough beech bucks: ${centsToBucks(paid)} needed, ${centsToBucks(available)} in your balance`,
      });
      // every unit's trade-in value: what was paid, shared out by list value
      const perLine = priced.map((l) => Array.from({ length: l.quantity }, () => unitsOf(l.product.grants)).flat());
      const lineShares = shareOut(paid, priced.map((l) => l.cents * l.quantity));
      const units = perLine.flat();
      const values = perLine.flatMap((u, i) => shareOut(lineShares[i], u.map((item) => listBucks(item) ?? 1)));
      const creatorItems = new Set(priced.filter((l) => l.offer).map((l) => l.product.grants[0].item));
      const rows = new Map<string, { item: string; qty: number; unit: number }>();
      units.forEach((item, i) => {
        // a community item's units each get their own row: each carries its own royalty
        const key = creatorItems.has(item) ? `${item}|#${i}` : `${item}|${values[i]}`;
        const r = rows.get(key) ?? { item, qty: 0, unit: values[i] };
        r.qty++;
        rows.set(key, r);
      });
      const grant = [...rows.values()];
      const granted = await claimCreditPurchase(tx, {
        userId: me,
        productId: opts.ref,
        finalCents: paid,
        items: grant.map((g) => g.item),
        quantities: grant.map((g) => g.qty),
        unitCents: grant.map((g) => g.unit),
        now,
      });
      if (!granted.length) fail(409, 'that did not go through: try again');
      // a community item's creator earns 30% of what its units were paid
      for (const l of priced) {
        if (!l.offer) continue;
        const item = l.product.grants[0].item;
        const paidEach = units.map((u, i) => (u === item ? values[i] : -1)).filter((v) => v >= 0);
        const own = granted.filter((r) => r.item_id === item);
        for (let k = 0; k < own.length; k++) {
          await awardCreatorCredit(tx, { offer: l.offer, buyer: me, purchaseRef: `credit:${own[k].id}`, paidCents: paidEach[k] ?? 0, now });
        }
      }
      if (requestId) await tx.query(
        'UPDATE credit_shop_orders SET paid_cents = $3, discount_cents = 0 WHERE user_id = $1 AND request_id = $2',
        [me, requestId, paid],
      );
      return { paidCents: paid, discountCents: 0, creditCents: await balance() };
    });
    return {
      ...result,
      paid: centsToBucks(Number(result.paidCents)),
      discount: centsToBucks(Number(result.discountCents)),
      bucks: centsToBucks(Number(result.creditCents)),
    };
  };

  // one offer (the shop), or a free one
  app.post('/store/credit-purchase', requireUser, async (c) => {
    const me = c.get('user').id;
    if (!creditLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const { productId, promoCode, requestId, freeOnly } =
      await body<{ productId?: string; promoCode?: string; requestId?: string; freeOnly?: boolean }>(c);
    if (promoCode !== undefined) fail(400, 'promo codes are for beech-buck packs: load the code on your account instead');
    const product = productById(productId ?? '') ?? fail(404, 'no such product');
    const r = await buyWithBucks(c, me, [{ product, quantity: 1 }], { requestId, freeOnly, ref: product.id });
    return c.json({ product: product.id, grants: product.grants, ...r });
  });
  app.post('/store/buy', requireUser, async (c) => {
    const me = c.get('user').id;
    if (!creditLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const p = await body<{ productId?: string; basket?: { product?: string; quantity?: number }[]; promoCode?: string; requestId?: string }>(c);
    if (p.promoCode !== undefined) fail(400, 'promo codes are for beech-buck packs: load the code on your account instead');
    let lines: { product: Product; quantity: number }[];
    if (p.basket !== undefined) {
      if (!Array.isArray(p.basket) || !p.basket.length || p.basket.length > 20) fail(400, 'a basket is 1 to 20 lines');
      lines = p.basket.map((l) => {
        const product = productById(String(l.product ?? '')) ?? fail(404, 'no such product');
        const quantity = Number(l.quantity ?? 1);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) fail(400, 'a quantity is 1 to 20');
        return { product, quantity };
      });
    } else {
      lines = [{ product: productById(p.productId ?? '') ?? fail(404, 'no such product'), quantity: 1 }];
    }
    const ref = lines.length === 1 && lines[0].quantity === 1 ? lines[0].product.id : `basket:${lines.map((l) => `${l.product.id}x${l.quantity}`).join(',')}`.slice(0, 200);
    const r = await buyWithBucks(c, me, lines, { requestId: p.requestId, ref });
    return c.json({ lines: lines.map((l) => ({ product: l.product.id, quantity: l.quantity, grants: l.product.grants })), ...r });
  });

  // ---------------------------------------------------------------- trade-ins
  // What each thing in your bag trades in for (docs/BEECH_BUCKS.md): how many
  // you own, how many are on your beaches, and the value of each unit,
  // newest first (the order a trade-in takes them).
  app.get('/bag', requireUser, async (c) => {
    const me = c.get('user').id;
    const now = clock();
    const rows = await db.query<{ item_id: string; quantity: number; unit_cents: number | null }>(
      `SELECT item_id, quantity, unit_cents FROM inventory
        WHERE user_id = $1 AND quantity > 0 AND (expires_at IS NULL OR expires_at > $2)
        ORDER BY acquired_at DESC, id DESC`,
      [me, now],
    );
    const placed = await itemsElsewhere(me, NO_BEACH);
    const [count, uniques] = await Promise.all([
      beachCount(me),
      db.query<{ item_id: string }>('SELECT item_id FROM unique_items WHERE owner_id = $1', [me]),
    ]);
    const unique = new Set(uniques.map((u) => u.item_id));
    const items = new Map<string, { item: string; owned: number; placed: number; values: number[] }>();
    for (const r of rows) {
      const list = listBucks(r.item_id);
      if (list === null || unique.has(r.item_id)) continue;
      const e = items.get(r.item_id) ?? { item: r.item_id, owned: 0, placed: r.item_id === 'beach' ? Math.max(0, count - 1) : (placed[r.item_id] ?? 0), values: [] };
      e.owned += Number(r.quantity);
      for (let i = 0; i < Number(r.quantity) && e.values.length < 50; i++) e.values.push(r.unit_cents === null ? list : centsToBucks(Number(r.unit_cents)));
      items.set(r.item_id, e);
    }
    return c.json({
      items: [...items.values()].map((e) => ({ ...e, free: Math.max(0, e.owned - e.placed) })),
    });
  });

  // Trade a thing in for its beech bucks (TradeAtomic in specs/tla/SandBucks.tla):
  // one transaction holding the player's lock (the one saves, restores,
  // copies and gifts take), so a save placing it, or a second trade-in of the
  // same last one, can't land in between. Only what isn't on a beach.
  app.post('/bag/trade-in', requireUser, async (c) => {
    const me = c.get('user').id;
    const { item, quantity = 1 } = await body<{ item?: string; quantity?: number }>(c);
    if (typeof item !== 'string' || !item || item.length > 40) fail(400, 'say which thing to trade in');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) fail(400, 'a quantity is 1 to 50');
    if (!tradeable(item!) || (await db.query('SELECT 1 FROM unique_items WHERE item_id = $1', [item])).length) {
      fail(400, "that can't be traded in");
    }
    if (!creditLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const now = clock();
    const list = bucksToCents(listBucks(item!)!);
    const out = await withPlayerWriteLock(me, async (tx) => {
      const [{ n: ownedN }] = await tx.query<{ n: string | null }>(
        `SELECT SUM(quantity) AS n FROM inventory WHERE user_id = $1 AND item_id = $2 AND quantity > 0 AND (expires_at IS NULL OR expires_at > $3)`,
        [me, item, now],
      );
      const owned = Number(ownedN ?? 0);
      let free: number;
      if (item === 'beach') {
        free = Math.min(owned, (await allowance(me, tx)) - (await beachCount(me, tx)));
      } else {
        const placed = (await itemsElsewhere(me, NO_BEACH, tx))[item!] ?? 0;
        free = owned - placed;
      }
      if (free < quantity) return { error: free > 0 ? `only ${free} can be traded in` : item === 'beach' ? 'every extra beach is in use' : 'pick it up off your beach first', free: Math.max(0, free) };
      // the newest first: "buy it, then change your mind" gives back exactly what was paid
      const rows = await tx.query<{ id: string; quantity: number; unit_cents: number | null; royalty_ref: string }>(
        `SELECT id, quantity, unit_cents,
                COALESCE(royalty_ref, CASE WHEN purchase_id IS NOT NULL THEN 'store:' || purchase_id ELSE 'credit:' || id END) AS royalty_ref
           FROM inventory
          WHERE user_id = $1 AND item_id = $2 AND quantity > 0 AND (expires_at IS NULL OR expires_at > $3)
          ORDER BY acquired_at DESC, id DESC FOR UPDATE`,
        [me, item, now],
      );
      let left = quantity;
      let cents = 0;
      for (const r of rows) {
        if (left <= 0) break;
        const take = Math.min(left, Number(r.quantity));
        const unit = r.unit_cents === null ? list : Number(r.unit_cents);
        await tx.query('UPDATE inventory SET quantity = quantity - $2 WHERE id = $1 AND quantity >= $2', [r.id, take]);
        await tx.query('INSERT INTO trade_ins (user_id, inventory_id, item_id, quantity, value_cents, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
          me, r.id, item, take, unit * take, now,
        ]);
        // a community item's creator gives back the credit it earned
        if (take === Number(r.quantity)) await reverseCreatorCreditByRef(tx, r.royalty_ref, now);
        cents += unit * take;
        left -= take;
      }
      await creditBalance(tx, me, cents, 'trade_in', item!, now);
      const [u] = await tx.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [me]);
      return { cents, balance: Number(u.credit_cents) };
    });
    if ('error' in out) return c.json({ error: out.error, free: out.free }, 409);
    return c.json({ item, quantity, credited: centsToBucks(out.cents), bucks: centsToBucks(out.balance) });
  });

  // (after /beaches/mine…, so 'mine' isn't taken for a code)
  app.get('/beaches/:code', requireUser, async (c) => {
    const who = await byCode(c.req.param('code') ?? '');
    if (!who) return c.json({ error: 'no beach with that code' }, 404);
    if (who.owner_id !== c.get('user').id) await live.viewed(who.id);
    return sendBeach(c, who.id);
  });
  app.get('/beaches/:code/live', requireUser, async (c) => {
    const who = await byCode(c.req.param('code') ?? '');
    if (!who) return c.json({ error: 'no beach with that code' }, 404);
    if (who.owner_id === c.get('user').id) return c.json({ error: 'your own beach' }, 400);
    const st = await live.status(who.id);
    return st ? c.json(st) : c.json({ error: 'no saved beach yet' }, 404);
  });

  // ---------------------------------------------------------------- gifts
  // Give one of your items to the owner of the beach with that code. Instant:
  // there is no inbox to accept it in. One statement moves it, so two gifts
  // of the same last item can't both go through: the second UPDATE finds
  // quantity 0 and moves nothing. Free items have no inventory rows, so
  // there is nothing to give (everyone already has them). The row on the
  // sand is untouched: gifting moves what you own, not what's placed.
  const GIFT_PER_HOUR = 20;
  /**
   * Move one of `me`'s `item` to `to` (the owner of `beach`), log it, and
   * write its inbox row, all in one statement. The oldest unexpired row
   * goes, so a race on the last one leaves the second gift with nothing to
   * move. Returns the inbox row's id, or null when there was nothing to give.
   */
  const giveOne = async (tx: Db, me: string, item: string, to: string, beach: string, now: number): Promise<string | null> => {
    // a pier on a beach stays yours (Piers.tla, PaidAttachment): only a free
    // one can go, checked under the giver's lock, which placing one also takes
    if (item === 'pier') {
      const { owned, placed } = await pierCounts(me, tx);
      if (owned <= placed) return null;
    }
    // so does a placed inland section (InlandSections.tla, PaidPlacement)
    if (isSection(item)) {
      const { owned, placed } = await sectionCounts(me, tx);
      if ((owned[item] ?? 0) <= (placed[item] ?? 0)) return null;
    }
    const rows = await tx.query<{ inbox: string | null }>(
      `WITH giver AS (
         UPDATE inventory SET quantity = quantity - 1
          WHERE id = (
            SELECT id FROM inventory
             WHERE user_id = $1 AND item_id = $2 AND quantity > 0
               AND (expires_at IS NULL OR expires_at > $3)
             ORDER BY acquired_at ASC LIMIT 1
          ) AND quantity > 0
         RETURNING id, item_id, expires_at, purchase_id, unit_cents, royalty_ref
       ), given AS (
         -- the gift keeps the purchase it came from, so a refund of that
         -- purchase takes it back from the recipient too (otherwise: buy,
         -- gift it to a second account, get a refund, keep the item)
         -- and its trade-in value (docs/BEECH_BUCKS.md), so a discount can't be cashed out by gifting
         -- and the creator royalty it earned, so trading the gift in takes that back
         INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at, purchase_id, unit_cents, royalty_ref)
         SELECT $4, item_id, 1, 'gift', $3, expires_at, purchase_id, unit_cents,
                COALESCE(royalty_ref, CASE WHEN purchase_id IS NOT NULL THEN 'store:' || purchase_id ELSE 'credit:' || id END)
           FROM giver
         RETURNING item_id
       ), logged AS (
         INSERT INTO gifts (from_id, to_id, item_id, created_at)
         SELECT $1, $4, item_id, $3 FROM giver
         RETURNING item_id
       ), passed_on AS (
         -- a one-of-a-kind item changes owner with it
         UPDATE unique_items SET owner_id = $4 WHERE item_id = $2 AND owner_id = $1 AND EXISTS (SELECT 1 FROM giver)
         RETURNING item_id
       ), told AS (
         INSERT INTO inbox (user_id, kind, actor_id, beach_id, item_id, created_at)
         SELECT $4, 'gift', $1, $5, item_id, $3 FROM giver
         RETURNING id
       )
       SELECT (SELECT id FROM told) AS inbox`,
      [me, item, now, to, beach],
    );
    return rows[0]?.inbox ?? null;
  };
  const giftsThisHour = async (tx: Db, me: string, now: number) =>
    Number((await tx.query<{ n: string }>('SELECT COUNT(*) AS n FROM gifts WHERE from_id = $1 AND created_at > $2', [me, now - 3600000]))[0].n);

  const sendGift = async (c: Context<Env>) => {
    const { code, item } = await body<{ code?: string; item?: string }>(c);
    if (normalizeCode(code ?? '').length !== 6) fail(400, 'neighbor codes are 6 letters and numbers');
    if (!item || typeof item !== 'string' || item.length > 40) fail(400, 'say which item to give');
    const me = c.get('user').id;
    const them = await nodeByCode(code!);
    if (!them) fail(404, 'no beach has that code');
    if (them!.owner_id === me) fail(400, "that's your own code");
    if (await blocked(them!.owner_id, me)) fail(403, 'that didn’t go through');
    await db.withTransaction(async (tx) => {
      // Share the sender lock with visitor gifts so the hourly limit holds
      // when both actions happen at once.
      await tx.query('SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE', [me]);
      const now = clock();
      if ((await giftsThisHour(tx, me, now)) >= GIFT_PER_HOUR) fail(429, 'slow down: 20 gifts an hour is the limit');
      if (!(await giveOne(tx, me, item!, them!.owner_id, them!.id, now))) fail(409, "you don't have one of those to give");
    });
    return c.json({ item, to: { name: them!.name, code: them!.code } });
  };
  app.post('/gifts', requireUser, sendGift);

  // ---------------------------------------------------------------- the beach guide
  // A checklist that teaches the game one mechanic at a time (docs/INVITES_GUIDE.md).
  // Each step is done once: the row and its gift go in one statement, so a
  // retry or a second device can't double a gift. Steps the server can see
  // for itself (a claw go, a star, a friend who joined) are checked here.
  /** the steps that count toward the bonus and settling in (not `invite`, not the bonus marker) */
  const COUNTED = `step NOT IN ('invite', 'bonus')`;
  const serverCheck: Record<string, (user: string) => Promise<boolean>> = {
    claw: async (u) => (await db.query(`SELECT 1 FROM pulls WHERE user_id = $1 AND pool = 'daily' LIMIT 1`, [u])).length > 0,
    vending: async (u) => (await db.query(`SELECT 1 FROM pulls WHERE user_id = $1 AND pool = 'vending' LIMIT 1`, [u])).length > 0,
    checkpoint: async (u) => (await db.query(`SELECT 1 FROM checkpoints WHERE owner_id = $1 AND kind = 'named' AND source IN ('beach', 'import') LIMIT 1`, [u])).length > 0,
    star: async (u) => (await db.query('SELECT 1 FROM star_first WHERE user_id = $1 LIMIT 1', [u])).length > 0,
    invite: async (u) => (await db.query('SELECT 1 FROM referrals WHERE inviter_id = $1 LIMIT 1', [u])).length > 0,
  };
  /** one reward row */
  const REWARD_ROW = `INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at)`;

  /**
   * If `invitee` came through an invite before the beech-buck bonus (a legacy
   * referral, bonus_bucks NULL) and has now done enough of the guide, mark
   * them settled in and give their inviter the next rung of the old ladder.
   * The rank is unique per inviter: two friends settling at the same moment
   * can't take the same rung (the loser's statement fails and it retries).
   */
  const settle = async (invitee: string): Promise<void> => {
    const r = (
      await db.query<{ inviter_id: string; n: string }>(
        `SELECT inviter_id, (SELECT COUNT(*) FROM guide_steps WHERE user_id = $1 AND ${COUNTED}) AS n
           FROM referrals WHERE invitee_id = $1 AND qualified_at IS NULL AND bonus_bucks IS NULL`,
        [invitee],
      )
    )[0];
    if (!r || Number(r.n) < SETTLE_STEPS) return;
    for (let attempt = 0; attempt < 5; attempt++) {
      const top = await db.query<{ m: number | null }>('SELECT MAX(reward_rank) AS m FROM referrals WHERE inviter_id = $1', [r.inviter_id]);
      const rank = Number(top[0]?.m ?? 0) + 1;
      const item = ladderReward(rank);
      try {
        await db.query(
          `WITH q AS (
             UPDATE referrals SET qualified_at = $2, reward_rank = $3, reward_item = $4
              WHERE invitee_id = $1 AND qualified_at IS NULL AND bonus_bucks IS NULL
             RETURNING inviter_id
           ), g AS (
             ${REWARD_ROW} SELECT inviter_id, $4, 1, 'reward', $2 FROM q WHERE $4::text IS NOT NULL RETURNING 1
           ), told AS (
             INSERT INTO inbox (user_id, kind, actor_id, item_id, created_at) SELECT inviter_id, 'invite_settled', $1, $4, $2 FROM q RETURNING 1
           )
           SELECT (SELECT COUNT(*) FROM q) AS n`,
          [invitee, clock(), rank, item],
        );
        return;
      } catch (e) {
        if ((e as { code?: string }).code !== '23505') throw e; // someone else took that rank: try the next
      }
    }
  };

  app.get('/guide', requireUser, async (c) => {
    const rows = await db.query<{ step: string; done_at: string }>(
      'SELECT step, done_at FROM guide_steps WHERE user_id = $1 ORDER BY done_at',
      [c.get('user').id],
    );
    return c.json({ done: rows.map((r) => ({ step: r.step, at: Number(r.done_at) })) });
  });

  app.post('/guide/:step', requireUser, async (c) => {
    const step = guideStep(c.req.param('step') ?? '');
    if (!step) fail(400, 'no such step in the guide');
    const me = c.get('user').id;
    if (step!.serverChecked && !(await serverCheck[step!.id](me))) fail(409, 'not yet');
    const now = clock();
    const rows = await db.query<{ n: string }>(
      `WITH s AS (
         INSERT INTO guide_steps (user_id, step, done_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING step
       ), g AS (
         ${REWARD_ROW} SELECT $1, $4, 1, 'reward', $3 FROM s WHERE $4::text IS NOT NULL RETURNING 1
       )
       SELECT (SELECT COUNT(*) FROM s) AS n`,
      [me, step!.id, now, step!.gift],
    );
    const fresh = Number(rows[0].n) > 0;
    let bonus: string | null = null;
    if (fresh && step!.id !== 'invite') {
      // every counted step done: the bonus, once (its own marker row)
      const b = await db.query<{ n: string }>(
        `WITH have AS (
           SELECT COUNT(*) AS n FROM guide_steps WHERE user_id = $1 AND ${COUNTED}
         ), b AS (
           INSERT INTO guide_steps (user_id, step, done_at) SELECT $1, 'bonus', $2 FROM have WHERE n >= $3
           ON CONFLICT DO NOTHING RETURNING 1
         ), g AS (
           ${REWARD_ROW} SELECT $1, $4, 1, 'reward', $2 FROM b RETURNING 1
         )
         SELECT (SELECT COUNT(*) FROM b) AS n`,
        [me, now, BONUS_STEPS.length, GUIDE_BONUS],
      );
      if (Number(b[0].n) > 0) bonus = GUIDE_BONUS;
      await settle(me);
    }
    return c.json({ step: step!.id, new: fresh, gift: fresh ? step!.gift : null, bonus });
  });

  // ---------------------------------------------------------------- invites
  // An invite link is ?invite=CODE (the inviter's beach code). The start
  // screen asks who it's from before anyone signs in, so this one needs no
  // session; it says no more than a visit link's preview already does.
  const inviteLookups = createRateLimiter(30);
  app.get('/invites/:code', async (c) => {
    const ip = (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown';
    if (!inviteLookups(ip)) return c.json({ error: 'slow down' }, 429);
    const them = await nodeByCode(c.req.param('code') ?? '');
    if (!them) return c.json({ error: 'no beach has that code' }, 404);
    return c.json({ name: them.name?.trim() || 'Someone', welcomeBucks: INVITE_BONUS });
  });

  // A new player who came through a link claims it once (ClaimAtomic in
  // specs/tla/Invites.tla): one transaction writes the referral (unique per
  // invitee, so a second device's claim finds it and gets nothing), its rank
  // (unique per inviter, so two friends can't both take the last of the
  // cap's ranks: the loser retries) and both bonuses.
  app.post('/referrals/claim', requireUser, async (c) => {
    const { code } = await body<{ code?: string }>(c);
    if (normalizeCode(code ?? '').length !== 6) fail(400, 'invite codes are 6 letters and numbers');
    const me = c.get('user').id;
    const them = await nodeByCode(code!);
    if (!them) fail(404, 'no beach has that code');
    if (them!.owner_id === me) fail(400, "that's your own invite");
    const now = clock();
    const created = Number((await db.query<{ created_at: string }>('SELECT created_at FROM users WHERE id = $1', [me]))[0]?.created_at ?? 0);
    if (now - created > CLAIM_WINDOW_MS) fail(409, 'invites are for new players');
    const bonus = INVITE_BONUS * BUCK;
    let claimed: { rank: number | null } | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        claimed = await db.withTransaction(async (tx) => {
          const [r] = await tx.query<{ reward_rank: number | null }>(
            `INSERT INTO referrals (invitee_id, inviter_id, code, created_at, reward_rank, bonus_bucks)
             SELECT $1, $2, $3, $4, CASE WHEN m < $5 THEN m + 1 END, $6
               FROM (SELECT COALESCE(MAX(reward_rank), 0) AS m FROM referrals WHERE inviter_id = $2) top
             ON CONFLICT (invitee_id) DO NOTHING RETURNING reward_rank`,
            [me, them!.owner_id, them!.code, now, REWARD_CAP, INVITE_BONUS],
          );
          if (!r) return null;
          // credit in user-id order so two players claiming each other's invite at once can't deadlock
          const credits: [string, string][] = [[me, `invited_by:${them!.owner_id}`]];
          if (r.reward_rank !== null) credits.push([them!.owner_id, `invited:${me}`]);
          credits.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
          for (const [uid, ref] of credits) await creditBalance(tx, uid, bonus, 'invite_bonus', ref, now);
          // the inviter's guide (a friend joined) and inbox
          await tx.query(`INSERT INTO guide_steps (user_id, step, done_at) VALUES ($1, 'invite', $2) ON CONFLICT DO NOTHING`, [them!.owner_id, now]);
          await tx.query(`INSERT INTO inbox (user_id, kind, actor_id, created_at) VALUES ($1, 'invite_joined', $2, $3)`, [them!.owner_id, me, now]);
          return { rank: r.reward_rank === null ? null : Number(r.reward_rank) };
        });
        break;
      } catch (e) {
        // another friend took that rank at the same moment: try the next
        if ((e as { code?: string }).code !== '23505' || attempt >= 4) throw e;
      }
    }
    if (!claimed) fail(409, 'you already joined through an invite');
    return c.json({ inviter: { name: them!.name?.trim() || 'Someone', code: them!.code }, bucks: INVITE_BONUS, inviterRewarded: claimed!.rank !== null });
  });

  /** Your invites: your link's code, who joined, and what each one earned you. */
  const referralsOf = async (me: string) => {
    const code = (await db.query<{ code: string }>('SELECT code FROM beach WHERE id = $1', [await homeOf(me)]))[0]?.code ?? '';
    const rows = await db.query<{ name: string; qualified_at: string | null; reward_item: string | null; reward_rank: number | null; bonus_bucks: number | null; created_at: string }>(
      `SELECT u.name, r.qualified_at, r.reward_item, r.reward_rank, r.bonus_bucks, r.created_at
         FROM referrals r JOIN users u ON u.id = r.invitee_id
        WHERE r.inviter_id = $1 ORDER BY r.created_at`,
      [me],
    );
    const friends = rows.map((r) => ({
      name: r.name?.trim() || 'Someone',
      joinedAt: Number(r.created_at),
      settled: r.qualified_at !== null,
      /** an old ladder reward (before the beech-buck bonus) */
      reward: r.reward_item,
      /** beech bucks this friend earned you (0 past the cap, or a legacy referral) */
      bucks: r.bonus_bucks !== null && r.reward_rank !== null ? Number(r.bonus_bucks) : 0,
    }));
    return {
      code,
      joined: friends.length,
      settled: friends.filter((f) => f.settled).length,
      earned: friends.reduce((t, f) => t + f.bucks, 0),
      friends,
      bonus: INVITE_BONUS,
      cap: REWARD_CAP,
      // for old app versions' invite panel
      ladder: ladder(),
      settleSteps: SETTLE_STEPS,
      welcomeGift: WELCOME_GIFT,
      steps: GUIDE_STEPS.length,
    };
  };
  app.get('/referrals', requireUser, async (c) => c.json(await referralsOf(c.get('user').id)));

  // ---------------------------------------------------------------- your account on beechshore
  // docs/BEECH_BUCKS.md, "Your account on beechshore". The shore site's
  // account page (shoreSite.ts, /account) connects with the same short-lived
  // token as item submissions (itemSubmissions.ts) and forwards its calls
  // here. Only these routes take that token: it can read your balance and
  // history, see your connected sign-ins, top up, redeem a gift card, gift
  // a thing and see your invites, and nothing else in the game.
  const requireShoreAccount = async (c: Context<Env>, next: () => Promise<void>) => {
    c.header('Cache-Control', 'no-store');
    const m = /^Bearer\s+(\S+)$/.exec(c.req.header('Authorization') ?? '');
    if (!m) fail(401, 'Connect your Beech account.');
    const now = Date.now();
    const [row] = await db.query<User>(
      `SELECT u.id, u.name FROM item_submission_sessions i JOIN sessions s ON s.token_hash = i.session_hash
         JOIN users u ON u.id = s.user_id WHERE i.token_hash = $1 AND i.expires_at > $2 AND s.expires_at > $2`,
      [await hashToken(m![1]), now],
    );
    if (!row) fail(401, 'Connect your Beech account again.');
    c.set('user', { id: row!.id, name: row!.name });
    c.set('shore', true);
    await next();
  };
  app.get('/shore-account/summary', requireShoreAccount, async (c) => {
    const me = c.get('user').id;
    const now = clock();
    const [[u], ledger, bag, invites, promos] = await Promise.all([
      db.query<{ credit_cents: number; creator_credit_debt_cents: number }>('SELECT credit_cents, creator_credit_debt_cents FROM users WHERE id = $1', [me]),
      ledgerOf(db, me),
      db.query<{ item_id: string; n: string }>(
        `SELECT item_id, SUM(quantity) AS n FROM inventory
          WHERE user_id = $1 AND quantity > 0 AND (expires_at IS NULL OR expires_at > $2)
          GROUP BY item_id ORDER BY item_id`,
        [me, now],
      ),
      referralsOf(me),
      accountPromos(db, me, now),
    ]);
    return c.json({
      user: { name: c.get('user').name },
      bucks: centsToBucks(Number(u?.credit_cents ?? 0)),
      debt: centsToBucks(Number(u?.creator_credit_debt_cents ?? 0)),
      ledger,
      bag: bag.filter((r) => r.item_id !== 'beach').map((r) => ({ item: r.item_id, name: displayName(r.item_id), owned: Number(r.n) })),
      invites,
      promos,
      packs: PACKS.map((p) => {
        const best = bestPromoForPack(promos, p);
        return {
          id: p.id,
          name: p.name,
          usd: p.usd,
          bucks: p.bucks,
          featured: !!p.featured,
          bonusBucks: best?.bonusBucks ?? 0,
          promoCode: best?.code ?? null,
        };
      }),
      webCheckout: !!cfg.xsolla,
    });
  });
  // What the beechshore account page shows under "Connected sign-ins".
  // Read-only here on purpose: attaching needs the provider's own sign-in
  // sheet, which lives in the game (native sheets / Google's web button),
  // so there is no attach action on that page for the shore token to call.
  // POST /api/account/identities stays on the game session only.
  app.get('/shore-account/identities', requireShoreAccount, async (c) => {
    return c.json({ identities: await identitiesOf(c.get('user').id) });
  });
  app.post('/shore-account/top-up', requireShoreAccount, webCheckout);
  app.get('/shore-account/web-orders/:id', requireShoreAccount, webOrder);
  app.post('/shore-account/redeem', requireShoreAccount, redeemGiftCard);
  app.post('/shore-account/promo-codes', requireShoreAccount, loadPromoHandler);
  app.post('/shore-account/gift', requireShoreAccount, sendGift);


  // ---------------------------------------------------------------- visitors and the inbox
  // docs/INBOX_NOTIFICATIONS.md. A visitor can leave a rating (shells), a
  // note and a gift on someone's beach; everything that happens to you lands
  // in your inbox, written in the same statement as the thing itself.

  /** has `owner` blocked `actor`? (blocked people can't reach you; they're told only "didn't go through") */
  const blocked = async (owner: string, actor: string): Promise<boolean> =>
    (await db.query('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [owner, actor])).length > 0;

  /** one inbox row on its own (for actions with no statement to join) */
  const inboxRow = async (user: string, kind: string, actor: string | null, beach: string | null, payload: Record<string, unknown> = {}) => {
    await db.query('INSERT INTO inbox (user_id, kind, actor_id, beach_id, payload, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)', [
      user,
      kind,
      actor,
      beach,
      JSON.stringify(payload),
      clock(),
    ]);
  };

  /** the unread count and the newest row, for the 30 s poll */
  const inboxSummary = async (user: string) => {
    const rows = await db.query<{ unread: string; id: string | null; kind: string | null; name: string | null }>(
      `SELECT (SELECT COUNT(*) FROM inbox i WHERE i.user_id = $1 AND i.read_at IS NULL
                 AND NOT EXISTS (SELECT 1 FROM blocks k WHERE k.blocker_id = $1 AND k.blocked_id = i.actor_id)) AS unread,
              l.id, l.kind, u.name
         FROM (SELECT 1) one
         LEFT JOIN LATERAL (
           SELECT i.id, i.kind, i.actor_id FROM inbox i
            WHERE i.user_id = $1 AND NOT EXISTS (SELECT 1 FROM blocks k WHERE k.blocker_id = $1 AND k.blocked_id = i.actor_id)
            ORDER BY i.id DESC LIMIT 1
         ) l ON true
         LEFT JOIN users u ON u.id = l.actor_id`,
      [user],
    );
    const r = rows[0];
    return {
      unread: Number(r?.unread ?? 0),
      latest: r?.id ? { id: Number(r.id), kind: r.kind, name: r.name?.trim() || null } : null,
    };
  };

  /** a beach's average, in shells (null until it has RATING_SHOWN_AT ratings) */
  const ratingOf = async (beach: string) => {
    const r = (await db.query<{ n: string; avg: string | null }>('SELECT COUNT(*) AS n, AVG(shells) AS avg FROM ratings WHERE beach_id = $1', [beach]))[0];
    const count = Number(r?.n ?? 0);
    return { count, average: count >= RATING_SHOWN_AT && r?.avg ? Math.round(Number(r.avg) * 10) / 10 : null };
  };

  const isNewAccount = async (user: string, now: number) =>
    now - Number((await db.query<{ created_at: string }>('SELECT created_at FROM users WHERE id = $1', [user]))[0]?.created_at ?? 0) < FREE_TEXT_AFTER_MS;

  // GET /beaches/:code/rating: the visitor card's numbers
  app.get('/beaches/:code/rating', requireUser, async (c) => {
    const them = await nodeByCode(c.req.param('code') ?? '');
    if (!them) return c.json({ error: 'no beach with that code' }, 404);
    const me = c.get('user').id;
    const mineRow = (await db.query<{ shells: number }>('SELECT shells FROM ratings WHERE rater_id = $1 AND beach_id = $2', [me, them.id]))[0];
    return c.json({
      ...(await ratingOf(them.id)),
      mine: mineRow ? Number(mineRow.shells) : null,
      yours: them.owner_id === me,
      quickNotes: QUICK_NOTES,
      freeText: !(await isNewAccount(me, clock())),
    });
  });

  // POST /beaches/:code/visit { shells?, note?, quick?, item? }: leave something
  app.post('/beaches/:code/visit', requireUser, async (c) => {
    const b = await body<{ shells?: unknown; note?: unknown; quick?: unknown; item?: unknown }>(c);
    const them = await nodeByCode(c.req.param('code') ?? '');
    if (!them) fail(404, 'no beach has that code');
    const me = c.get('user').id;
    if (them!.owner_id === me) fail(400, "that's your own beach");
    if (await blocked(them!.owner_id, me)) fail(403, 'that didn’t go through');
    const now = clock();
    const shells = b.shells === undefined || b.shells === null ? null : Number(b.shells);
    if (shells !== null && !(Number.isInteger(shells) && shells >= 1 && shells <= 5)) fail(400, 'a rating is 1 to 5 shells');
    const item = b.item === undefined || b.item === null || b.item === '' ? null : String(b.item);
    if (item !== null && item.length > 40) fail(400, 'say which item to give');
    let note: string | null = null;
    const quick = b.quick === true;
    if (b.note !== undefined && b.note !== null && b.note !== '') {
      if (quick) {
        if (!QUICK_NOTES.includes(String(b.note))) fail(400, 'that isn’t one of the quick notes');
        note = String(b.note);
      } else {
        const chk = checkNote(b.note);
        if (!chk.ok) fail(400, chk.reason);
        if (await isNewAccount(me, now)) fail(403, 'quick notes only for now');
        note = (chk as { text: string }).text;
      }
    }
    if (shells === null && note === null && item === null) fail(400, 'leave a rating, a note or a gift');
    await db.withTransaction(async (tx) => {
      // Serialize a sender’s limits and commit the gift, note, rating and inbox together.
      await tx.query('SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE', [me]);
      if (note !== null) {
        const n = (
          await tx.query<{ hour: string; here: string }>(
            `SELECT COUNT(*) FILTER (WHERE created_at > $2) AS hour,
                    COUNT(*) FILTER (WHERE created_at > $3 AND beach_id = $4) AS here
               FROM notes WHERE from_id = $1 AND created_at > LEAST($2, $3)`,
            [me, now - 3600000, now - 86400000, them!.id],
          )
        )[0];
        if (Number(n.hour) >= NOTES_PER_HOUR) fail(429, `${NOTES_PER_HOUR} notes an hour at most`);
        if (Number(n.here) >= NOTES_PER_BEACH_DAY) fail(429, `${NOTES_PER_BEACH_DAY} notes a day to one beach at most`);
      }
      let changedRating = shells;
      if (shells !== null) {
        const prev = (await tx.query<{ shells: number; updated_at: string }>('SELECT shells, updated_at FROM ratings WHERE rater_id = $1 AND beach_id = $2', [me, them!.id]))[0];
        if (prev) {
          if (Number(prev.shells) === shells) changedRating = null;
          else if (now - Number(prev.updated_at) < RATING_EVERY_MS) fail(429, 'one rating change a day');
        }
      }
      if (item !== null && (await giftsThisHour(tx, me, now)) >= GIFT_PER_HOUR) fail(429, 'slow down: 20 gifts an hour is the limit');

      // the gift first: it moves (with its own inbox row) or nothing happens at all
      let giftRow: string | null = null;
      if (item !== null) {
        giftRow = await giveOne(tx, me, item, them!.owner_id, them!.id, now);
        if (!giftRow) fail(409, "you don't have one of those to give");
      }
      // the note, the rating and the inbox row together. With a gift its row
      // becomes the visit; a rating alone folds into the day's "ratings" row.
      const alone = note === null && giftRow === null;
      await tx.query(
        `WITH n AS (
           INSERT INTO notes (from_id, to_id, beach_id, body, quick, created_at)
           SELECT $1, $2, $3, $4, $5, $7 WHERE $4::text IS NOT NULL
           RETURNING id
         ), r AS (
           INSERT INTO ratings (rater_id, beach_id, shells, updated_at)
           SELECT $1, $3, $11, $7 WHERE $11::int IS NOT NULL
           ON CONFLICT (rater_id, beach_id) DO UPDATE SET shells = EXCLUDED.shells, updated_at = EXCLUDED.updated_at
           RETURNING 1
         ), upd AS (
           UPDATE inbox SET kind = 'visit', shells = $6, note_id = (SELECT id FROM n)
            WHERE id = $8::bigint
           RETURNING 1
         ), visit AS (
           INSERT INTO inbox (user_id, kind, actor_id, beach_id, shells, note_id, created_at)
           SELECT $2, 'visit', $1, $3, $6, (SELECT id FROM n), $7
            WHERE $8::bigint IS NULL AND NOT $9::boolean
           RETURNING 1
         ), rated AS (
           INSERT INTO inbox (user_id, kind, actor_id, beach_id, day, created_at)
           SELECT $2, 'rating', $1, $3, $10, $7 WHERE $9::boolean AND $11::int IS NOT NULL
           ON CONFLICT (user_id, kind, beach_id, day) WHERE day IS NOT NULL
           DO UPDATE SET id = EXCLUDED.id, count = inbox.count + 1, actor_id = EXCLUDED.actor_id, created_at = EXCLUDED.created_at, read_at = NULL
           RETURNING 1
         )
         SELECT (SELECT COUNT(*) FROM n) AS noted`,
        [me, them!.owner_id, them!.id, note, quick, shells, now, giftRow, alone, utcDay(now), changedRating],
      );
    });
    return c.json({ rated: shells !== null, noted: note !== null, gifted: item, rating: await ratingOf(them!.id) });
  });

  // GET /inbox?before=ID: newest first, 30 a page; trims old rows as it goes
  app.get('/inbox', requireUser, async (c) => {
    const me = c.get('user').id;
    const now = clock();
    await db.query(
      `DELETE FROM inbox WHERE user_id = $1 AND (
         (read_at IS NOT NULL AND created_at < $2)
         OR id < (SELECT MIN(id) FROM (SELECT id FROM inbox WHERE user_id = $1 ORDER BY id DESC LIMIT $3) keep)
       )`,
      [me, now - INBOX_READ_TTL_MS, INBOX_KEEP],
    );
    const before = Number(c.req.query('before') ?? 0);
    const rows = await db.query<{
      id: string; kind: string; actor_id: string | null; actor_name: string | null; actor_code: string | null;
      beach_id: string | null; beach_code: string | null; beach_name: string | null; item_id: string | null; shells: number | null;
      note_id: string | null; note: string | null; note_hidden: string | null; count: number; payload: Record<string, unknown>;
      created_at: string; read_at: string | null;
    }>(
      `SELECT i.id, i.kind, i.actor_id, u.name AS actor_name, h.code AS actor_code,
              i.beach_id, b.code AS beach_code, b.name AS beach_name, i.item_id, i.shells,
              i.note_id, n.body AS note, n.hidden_at AS note_hidden, i.count, i.payload, i.created_at, i.read_at
         FROM inbox i
         LEFT JOIN users u ON u.id = i.actor_id
         LEFT JOIN beach h ON h.id = i.actor_id
         LEFT JOIN beach b ON b.id = i.beach_id
         LEFT JOIN notes n ON n.id = i.note_id
        WHERE i.user_id = $1 AND ($2::bigint = 0 OR i.id < $2::bigint)
          AND NOT EXISTS (SELECT 1 FROM blocks k WHERE k.blocker_id = $1 AND k.blocked_id = i.actor_id)
        ORDER BY i.id DESC LIMIT 30`,
      [me, Number.isSafeInteger(before) && before > 0 ? before : 0],
    );
    const ratings = new Map<string, { count: number; average: number | null }>();
    const entries = [];
    for (const r of rows) {
      let rating: { count: number; average: number | null } | undefined;
      if (r.kind === 'rating' && r.beach_id) {
        rating = ratings.get(r.beach_id) ?? (await ratingOf(r.beach_id));
        ratings.set(r.beach_id, rating);
      }
      entries.push({
        id: Number(r.id),
        kind: r.kind,
        // a deleted sender: no name, no code (the app says "a former visitor")
        from: r.actor_id ? { name: r.actor_name?.trim() || 'Someone', code: r.actor_code } : null,
        beach: r.beach_code ? { code: r.beach_code, name: r.beach_name || null } : null,
        item: r.item_id,
        shells: r.shells === null ? null : Number(r.shells),
        note: r.note_id ? (r.note_hidden ? { id: Number(r.note_id), removed: true } : { id: Number(r.note_id), text: r.note }) : null,
        count: Number(r.count),
        rating,
        payload: r.payload ?? {},
        at: Number(r.created_at),
        read: r.read_at !== null,
      });
    }
    return c.json({ ...(await inboxSummary(me)), entries });
  });

  // POST /inbox/read { upTo }: everything up to that row has been seen
  app.post('/inbox/read', requireUser, async (c) => {
    const { upTo } = await body<{ upTo?: number }>(c);
    if (!Number.isSafeInteger(upTo)) fail(400, 'upTo is a row id');
    await db.query('UPDATE inbox SET read_at = $3 WHERE user_id = $1 AND id <= $2 AND read_at IS NULL', [c.get('user').id, upTo, clock()]);
    return c.json(await inboxSummary(c.get('user').id));
  });

  // POST /notes/:id/report { reason }: only the note's recipient can report it
  app.post('/notes/:id/report', requireUser, async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id)) fail(404, 'no such note');
    const { reason } = await body<{ reason?: string }>(c);
    const note = (await db.query<{ to_id: string }>('SELECT to_id FROM notes WHERE id = $1', [id]))[0];
    if (!note || note.to_id !== c.get('user').id) fail(404, 'no such note');
    await db.query(
      `INSERT INTO reports (reporter_id, note_id, reason, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (reporter_id, note_id) DO NOTHING`,
      [c.get('user').id, id, String(reason ?? '').slice(0, 200), clock()],
    );
    logEvent('note_reported', { note: id });
    return c.body(null, 204);
  });

  // blocks: by any beach code of theirs. Silent: they're never told.
  app.get('/blocks', requireUser, async (c) => {
    const rows = await db.query<{ name: string; code: string | null }>(
      `SELECT u.name, h.code FROM blocks k JOIN users u ON u.id = k.blocked_id LEFT JOIN beach h ON h.id = k.blocked_id
        WHERE k.blocker_id = $1 ORDER BY k.created_at DESC`,
      [c.get('user').id],
    );
    return c.json({ blocked: rows.map((r) => ({ name: r.name?.trim() || 'Someone', code: r.code })) });
  });
  app.put('/blocks/:code', requireUser, async (c) => {
    const them = await nodeByCode(c.req.param('code') ?? '');
    if (!them) fail(404, 'no beach has that code');
    if (them!.owner_id === c.get('user').id) fail(400, "that's you");
    // under the push lock, so a push being sent now finishes first and none
    // after this returns carries them (specs/tla/Push.tla, Block)
    await db.withTransaction(async (tx) => {
      await lockPush(tx, c.get('user').id);
      await tx.query('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
        c.get('user').id,
        them!.owner_id,
        clock(),
      ]);
    });
    // their pending requests to you go too
    await db.query(
      `DELETE FROM neighbor_requests r USING beach f, beach t
        WHERE f.id = r.from_beach AND t.id = r.to_beach AND f.owner_id = $2 AND t.owner_id = $1`,
      [c.get('user').id, them!.owner_id],
    );
    return c.body(null, 204);
  });
  app.delete('/blocks/:code', requireUser, async (c) => {
    const them = await nodeByCode(c.req.param('code') ?? '');
    if (them) await db.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [c.get('user').id, them.owner_id]);
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- push notifications
  // docs/INBOX_NOTIFICATIONS.md ("Push"), specs/tla/Push.tla. A device
  // subscribes; the tick (Cloud Scheduler, or the server's own timer) sends
  // what's due under the player's push lock. Steam has no push service: the
  // running app shows OS notifications from the poll instead.
  const pushCfg = cfg.push?.config ?? {};
  const pushSend: PushSender = cfg.push?.send ?? makeSender(pushCfg, fetch, clock);
  const pushOn = (platform: string) =>
    platform === 'web' ? !!pushCfg.web : platform === 'ios' ? !!pushCfg.apns : platform === 'android' ? !!pushCfg.fcm : false;

  // GET /push/config: what this server can push to (the web key is public)
  app.get('/push/config', (c) =>
    c.json({ web: pushCfg.web?.publicKey ?? null, ios: !!pushCfg.apns, android: !!pushCfg.fcm }),
  );

  // POST /push/subscribe { platform, endpoint, keys?: { p256dh, auth }, tz }
  app.post('/push/subscribe', requireUser, async (c) => {
    const b = await body<{ platform?: string; endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; tz?: unknown }>(c);
    const platform = String(b.platform ?? '');
    if (!['web', 'ios', 'android'].includes(platform)) fail(400, 'platform is web, ios or android');
    if (!pushOn(platform)) fail(404, 'push is not set up for that platform');
    if (!validEndpoint(platform, b.endpoint)) fail(400, 'that is not a push subscription');
    const keyOk = (k: unknown, n: number) => typeof k === 'string' && /^[A-Za-z0-9_-]+={0,2}$/.test(k) && Buffer.from(k, 'base64url').length === n;
    if (platform === 'web' && !(keyOk(b.keys?.p256dh, 65) && keyOk(b.keys?.auth, 16))) fail(400, 'that is not a push subscription');
    const tz = validTz(b.tz) ? b.tz : 'UTC';
    const me = c.get('user').id;
    // one row per endpoint: a device that signs in as someone else moves to them
    await db.query(
      `INSERT INTO push_subscriptions (user_id, session_hash, platform, endpoint, p256dh, auth, tz, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, session_hash = EXCLUDED.session_hash,
         platform = EXCLUDED.platform, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, tz = EXCLUDED.tz, created_at = EXCLUDED.created_at`,
      [me, c.get('tokenHash'), platform, b.endpoint, platform === 'web' ? b.keys!.p256dh : null, platform === 'web' ? b.keys!.auth : null, tz, clock()],
    );
    await db.query(
      `DELETE FROM push_subscriptions WHERE user_id = $1 AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2)`,
      [me, PUSH_DEVICES],
    );
    return c.body(null, 204);
  });

  // DELETE /push/subscribe { endpoint }: this device stops (waits for a send in progress)
  app.delete('/push/subscribe', requireUser, async (c) => {
    const { endpoint } = await body<{ endpoint?: unknown }>(c);
    if (typeof endpoint !== 'string') fail(400, 'which endpoint?');
    await db.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [c.get('user').id, endpoint]);
    return c.body(null, 204);
  });

  const prefsOf = async (user: string, conn = db) => {
    const r = (await conn.query<Record<NotifyPref, boolean>>('SELECT gifts, neighbors, invites, beach FROM notify_prefs WHERE user_id = $1', [user]))[0];
    return { gifts: r?.gifts ?? true, neighbors: r?.neighbors ?? true, invites: r?.invites ?? true, beach: r?.beach ?? true };
  };
  app.get('/notify-prefs', requireUser, async (c) => c.json(await prefsOf(c.get('user').id)));

  // PUT /notify-prefs { gifts?, neighbors?, invites?, beach? }: under the push lock (Push.tla, Mute)
  app.put('/notify-prefs', requireUser, async (c) => {
    const b = await body<Partial<Record<NotifyPref, unknown>>>(c);
    const me = c.get('user').id;
    const patch: Partial<Record<NotifyPref, boolean>> = {};
    for (const k of NOTIFY_PREFS) {
      const value = b[k];
      if (value === undefined) continue;
      if (typeof value !== 'boolean') fail(400, `${k} is true or false`);
      patch[k] = value as boolean;
    }
    const next = await db.withTransaction(async (tx) => {
      await lockPush(tx, me);
      const prefs = { ...(await prefsOf(me, tx)), ...patch };
      await tx.query(
        `INSERT INTO notify_prefs (user_id, gifts, neighbors, invites, beach) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE SET gifts = EXCLUDED.gifts, neighbors = EXCLUDED.neighbors, invites = EXCLUDED.invites, beach = EXCLUDED.beach`,
        [me, prefs.gifts, prefs.neighbors, prefs.invites, prefs.beach],
      );
      return prefs;
    });
    return c.json(next);
  });

  // POST /push/tick: Cloud Scheduler, once a minute, with an OIDC token
  app.post('/push/tick', async (c) => {
    if (!cfg.push?.tick) fail(404, 'not set up');
    try {
      await verifyGoogleOidc(c.req.header('Authorization'), cfg.push!.tick!);
    } catch {
      fail(401, 'not allowed');
    }
    const r = await pushTick(db, pushSend, clock);
    if (r.pushes) logEvent('push_tick', { ...r });
    return c.json(r);
  });

  return app;
}

function setCors(h: Headers, origin: string): void {
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', ['Authorization', 'Content-Type', ...BEACH_HEADERS, ...REQUEST_HEADERS].join(', '));
  h.set('Access-Control-Expose-Headers', BEACH_HEADERS.join(', '));
  h.set('Access-Control-Max-Age', '86400');
  h.append('Vary', 'Origin');
}
