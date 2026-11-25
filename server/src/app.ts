// beech API. Mounted under /api by src/server.ts, which also serves the web app.
//
//   POST   /api/auth/google      { credential }            -> { token, user }
//   POST   /api/auth/apple       { identityToken, name? }  -> { token, user }
//   POST   /api/auth/dev         { name }                  -> { token, user }   (DEV_AUTH only)
//   POST   /api/auth/logout                                -> 204
//   GET    /api/me                                         -> { user }
//   GET    /api/beach                                      -> sand bytes + X-Beach-* headers | 404
//   PUT    /api/beach            sand bytes, X-Beach-Location/Nx/Ny -> { version, updatedAt } (+ largeEdit / largeEditCheckpoint when the save reshaped the beach)
//   DELETE /api/account                                    -> 204 (user, sessions, beach, neighbor links)
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

import { PRODUCTS, productById } from './products.js';
import { issueSubmissionSession, UUID_PATTERN } from './itemSubmissions.js';
import { awardCheckoutCreatorCredit, awardCreatorCredit, creatorOffer, creatorOffers, lockCreditUsers, nativeSalePrice, salePriceCents } from './creatorCredit.js';
import {
  claimCreditPurchase,
  discountCents,
  formatCents,
  hashGiftCode,
  isGiftCodeShape,
  normalizePromoCode,
  promoBlocked,
  type Promo,
} from './giftCards.js';
import { appleRefund, googleVoided, revokeStorePurchase, verifyAppleTransaction, verifyGooglePurchase, type VerifiedPurchase } from './store.js';
import { POOLS, GRAB_CHANCE, COOLDOWN_MAX_MS, COOLDOWN_MIN_MS, cooldownAfter, cryptoRandom, draw, grab, pullDay, starterPrize, STARTER, type Rarity } from './pulls.js';
import { currentSet, drawVending, nextUtcMidnight } from './vending.js';
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
} from './animals.js';
import {
  hashToken,
  newSessionToken,
  SESSION_DAYS,
  verifyAppleIdToken,
  verifyGoogleIdToken,
  verifySteamTicket,
  type SteamAuthConfig,
  type VerifiedIdentity,
} from './auth.js';
import { toBytes, type Db } from './db.js';
import { BEACH, NODE, SIDES, beachJson, isPublic, normalizeCode, shoreGraph, type NodeRow, type Side } from './shore.js';
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
  sandDiff,
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
}

export interface User {
  id: string;
  name: string;
}

type Env = { Variables: { user: User; tokenHash: string } };

/** most beaches one person can have */
export const BEACH_CAP = 8;
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
    const { identityToken, name } = await body<{ identityToken?: string; name?: string }>(c);
    if (!identityToken) fail(400, 'missing identityToken');
    let who: VerifiedIdentity;
    try {
      who = await verifyApple(identityToken!, cfg.appleClientIds, name ?? '');
    } catch (e) {
      return fail(401, `apple sign-in failed: ${(e as Error).message}`);
    }
    return startSession(c, who);
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
      Date.now(),
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
  app.post('/edit-session', requireUser, async (c) => {
    const me = c.get('user').id;
    const token = crypto.randomUUID();
    const now = Date.now();
    const prev = await db.query('SELECT 1 FROM edit_sessions WHERE user_id = $1', [me]);
    await db.query(
      `INSERT INTO edit_sessions (user_id, token, created_at, last_seen_at) VALUES ($1, $2, $3, $3)
       ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, created_at = EXCLUDED.created_at, last_seen_at = EXCLUDED.last_seen_at`,
      [me, token, now],
    );
    if (prev.length) logEvent('edit_takeover', {}, 'INFO');
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
  const requireEditToken = async (c: Context<Env>): Promise<void> => {
    const sent = c.req.header('X-Edit-Token');
    // no token at all: an app from before edit sessions — it can't prove it
    // is the editor, so it reloads to save (the same 426 as other old apps)
    if (!sent) outdated(c, 'no X-Edit-Token');
    const rows = await db.query<{ token: string }>('SELECT token FROM edit_sessions WHERE user_id = $1', [c.get('user').id]);
    if (!rows[0] || rows[0].token !== sent) fail(409, 'fenced');
  };

  // Cross-platform account linking (docs/STEAM.md): generate a 10-minute code on
  // your existing device (web/iOS/Android), then enter it on a fresh Steam
  // account so both share the same user_id, beaches, inventory, and purchases.
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

  app.post('/account/link', requireUser, async (c) => {
    const now = (cfg.now ?? Date.now)();
    const { code } = await body<{ code?: string }>(c);
    const normalized = normalizeLinkCode(code ?? '');
    if (normalized.length !== 8) fail(400, 'enter the 8-character link code');
    const codeHash = await hashToken(normalized);
    const currentId = c.get('user').id;

    const codeRows = await db.query<{ user_id: string; expires_at: string }>(
      'SELECT user_id, expires_at FROM account_link_codes WHERE code_hash = $1',
      [codeHash],
    );
    const row = codeRows[0];
    if (!row || Number(row.expires_at) <= now) fail(404, 'that link code is invalid or has expired');
    const targetId = row.user_id;
    if (targetId === currentId) fail(400, 'this device is already signed into that account');

    // Only merge a fresh/empty account so nobody loses saved data. Stars,
    // favorites, neighbor links/requests, and checkpoints are all lost on
    // the merge (the user row is deleted; those tables cascade), so they
    // count toward "not empty" too — a fresh Steam account has none of them.
    const [beaches, items, purchases, stars, favorites, neighbors, requests, checkpoints] = await Promise.all([
      db.query<{ count: string; saved: string }>(
        'SELECT COUNT(*)::text AS count, COUNT(*) FILTER (WHERE sand IS NOT NULL)::text AS saved FROM beach WHERE owner_id = $1',
        [currentId],
      ),
      db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM inventory WHERE user_id = $1 AND quantity > 0', [currentId]),
      db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM purchases WHERE user_id = $1', [currentId]),
      db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM star_first WHERE user_id = $1', [currentId]),
      db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM favorites WHERE user_id = $1', [currentId]),
      // Neighbor links/requests name beaches, not users (migration 7), so
      // they are checked through the account's beaches.
      db.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM neighbors WHERE beach_id IN (SELECT id FROM beach WHERE owner_id = $1) OR neighbor_beach_id IN (SELECT id FROM beach WHERE owner_id = $1)',
        [currentId],
      ),
      db.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM neighbor_requests WHERE from_beach IN (SELECT id FROM beach WHERE owner_id = $1) OR to_beach IN (SELECT id FROM beach WHERE owner_id = $1)',
        [currentId],
      ),
      db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM checkpoints WHERE owner_id = $1', [currentId]),
    ]);
    const nonEmpty =
      Number(beaches[0]?.count ?? 0) > 1 ||
      Number(beaches[0]?.saved ?? 0) > 0 ||
      Number(items[0]?.count ?? 0) > 0 ||
      Number(purchases[0]?.count ?? 0) > 0 ||
      Number(stars[0]?.count ?? 0) > 0 ||
      Number(favorites[0]?.count ?? 0) > 0 ||
      Number(neighbors[0]?.count ?? 0) > 0 ||
      Number(requests[0]?.count ?? 0) > 0 ||
      Number(checkpoints[0]?.count ?? 0) > 0;
    if (nonEmpty) {
      fail(409, 'this account already has a saved beach, items, stars, neighbors, or checkpoints; delete it first to link another account');
    }

    // Consume the one-time code, move identities to targetId, and drop the empty user row.
    // One transaction: a crash between the identity move and the user delete
    // would orphan a user row with no identities (and a spent link code).
    const claimed = await db.withTransaction(async (tx) => {
      // An upload or creator-credit grant cannot slip in between this check
      // and removal of the account.
      await tx.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [currentId]);
      const [creatorState] = await tx.query(
        `SELECT 1 FROM users WHERE id = $1 AND (credit_cents > 0 OR creator_credit_debt_cents > 0)
         UNION ALL SELECT 1 FROM item_submissions WHERE submitter_user_id = $1 LIMIT 1`,
        [currentId],
      );
      if (creatorState) fail(409, 'this account already has item submissions or credit; sign in with the account you want to keep');
      const rows = await tx.query<{ user_id: string }>(
        'DELETE FROM account_link_codes WHERE code_hash = $1 AND expires_at > $2 RETURNING user_id',
        [codeHash, now],
      );
      if (!rows.length) return rows;
      await tx.query('UPDATE user_identities SET user_id = $1 WHERE user_id = $2', [targetId, currentId]);
      await tx.query('DELETE FROM users WHERE id = $1', [currentId]);
      return rows;
    });
    if (!claimed.length) fail(404, 'that link code is invalid or has expired');

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
    return c.json({ token, user: targetUser });
  });

  app.delete('/account', requireUser, async (c) => {
    // sessions, beach and neighbor links go with it (ON DELETE CASCADE)
    await db.query('DELETE FROM users WHERE id = $1', [c.get('user').id]);
    return c.body(null, 204);
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
      `INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, from_name, location, nx, ny, sand, bytes, items, objects, created_at)
       SELECT $1, owner_id, $2, 'auto', 'beach', id, name, location, nx, ny, sand, octet_length(sand), $3, $4, $5
         FROM beach WHERE id = $6 AND sand IS NOT NULL
       ON CONFLICT (from_beach) WHERE kind = 'auto' DO UPDATE SET
         name = EXCLUDED.name, from_name = EXCLUDED.from_name, location = EXCLUDED.location, nx = EXCLUDED.nx, ny = EXCLUDED.ny,
         sand = EXCLUDED.sand, bytes = EXCLUDED.bytes, items = EXCLUDED.items, objects = EXCLUDED.objects, created_at = EXCLUDED.created_at`,
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
  const overBag = async (user: string, beachId: string, placed: Record<string, number>): Promise<Short[]> => {
    const row = (await db.query<{ items: Record<string, number> | string | null }>('SELECT items FROM beach WHERE id = $1', [beachId]))[0];
    const stored = jsonMap(row?.items);
    const grew = Object.entries(placed).filter(([item, n]) => n > (stored[item] ?? 0));
    if (!grew.length) return [];
    const [owned, elsewhere] = await Promise.all([ownedItems(user), itemsElsewhere(user, beachId)]);
    const out: Short[] = [];
    for (const [item, n] of grew.sort(([a], [b]) => (a < b ? -1 : 1))) {
      const have = Math.max(stored[item] ?? 0, (owned[item] ?? 0) - (elsewhere[item] ?? 0));
      if (n > have) out.push({ item, need: n, have });
    }
    return out;
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
    const rows = await db.query<{ version: number; epoch: number }>(
      `UPDATE beach SET location = $2, nx = $3, ny = $4, version = version + 1, updated_at = $5, sand = $6, items = $7, simulated_until = $9
        WHERE id = $1 AND ($8::int IS NULL OR epoch <= $8::int) RETURNING version, epoch`,
      [beachId, location, nx, ny, now, bytes, JSON.stringify(placed), epoch, liveClock()],
      'beach.save',
    );
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
  const allowance = async (user: string): Promise<number> => {
    const rows = await db.query<{ n: string | null }>(
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

  /** Join a and b: b on a's `side`, a on b's other side. One statement, so it's all or nothing. */
  const link = async (a: string, side: Side, b: string) => {
    const now = Date.now();
    try {
      await db.query(
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
    await db.query(
      `DELETE FROM neighbor_requests
        WHERE (from_beach = $1 AND (side = $2 OR to_beach = $3)) OR (from_beach = $3 AND (side = $4 OR to_beach = $1))
           OR (to_beach = $1 AND side = $4) OR (to_beach = $3 AND side = $2)`,
      [a, side, b, opposite(side)],
    );
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
        nextCooldown: nextUtcMidnight(now) - now,
        nextFree: st && st.at > now ? st.at : now,
        set: { week: set.week, name: set.name },
      });
    }
    return c.json({
      pools,
      nextFree: daily && daily.at > now ? daily.at : now,
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
    const species = b.species === 'crab' || !b.species ? 'crab' : fail(400, 'unknown species');
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
    const bond = await getBondProgress(db, beachId, 'crab');
    const recentFeeders = pet ? await recentPetFeeders(db, beachId, me) : [];
    return c.json({ pet, bond, recentFeeders });
  });

  app.post('/pet/adopt', requireUser, async (c) => {
    const user = c.get('user');
    const b = await body<{ beachId?: string; species?: string; name?: string; mode?: string }>(c);
    const mode = b.mode === 'shop' ? 'shop' : b.mode === 'befriend' ? 'befriend' : fail(400, 'expected mode "befriend" or "shop"');
    const species = !b.species || b.species === 'crab' ? 'crab' : fail(400, 'unknown species');
    const beachId = await mine(c, b.beachId ?? c.req.query('beach'));
    const res = await adoptPet(db, {
      beachId,
      userId: user.id,
      species,
      name: cleanPetName(b.name),
      mode,
      now: clock(),
    });
    if (!res.ok) return c.json({ error: res.error }, res.status);
    return c.json({ pet: res.pet });
  });

  app.patch('/pet', requireUser, async (c) => {
    const b = await body<{ beachId?: string; name?: string }>(c);
    const beachId = await mine(c, b.beachId ?? c.req.query('beach'));
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
    const rows = await db.query<NodeRow & { home: boolean; on_shore: boolean; items: Record<string, number> | string }>(
      `SELECT ${NODE}, b.home, b.on_shore, b.items FROM ${BEACH} WHERE b.owner_id = $1 ORDER BY b.home DESC, b.created_at`,
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
        };
      }),
    );
  };

  app.get('/beaches/mine', requireUser, async (c) => {
    const me = c.get('user').id;
    const [beaches, allowed] = await Promise.all([myBeaches(me), allowance(me)]);
    return c.json({ allowance: allowed, cap: BEACH_CAP, beaches });
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
    // links, requests and favorites go with it (ON DELETE CASCADE)
    const rows = await db.query('DELETE FROM beach WHERE id = $1 AND NOT home RETURNING id', [id]);
    if (!rows.length) fail(400, "your home beach can't be removed (make another one home first)");
    return c.body(null, 204);
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
    source: 'beach' | 'import';
    from_beach: string | null;
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
    fromName: r.from_name,
    location: r.location,
    nx: Number(r.nx),
    ny: Number(r.ny),
    items: jsonMap(r.items),
    objects: Number(r.objects),
    bytes: Number(r.bytes),
    createdAt: Number(r.created_at),
  });
  const CHECKPOINT_COLS = `c.id, c.name, c.kind, c.source, c.from_beach, c.from_name, b.name AS beach_name, c.location, c.nx, c.ny, c.bytes, c.items, c.objects, c.created_at`;
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
  const ownedItems = async (user: string): Promise<Record<string, number>> => {
    const rows = await db.query<{ item_id: string; n: string }>(
      `SELECT item_id, SUM(quantity) AS n FROM inventory WHERE user_id = $1 AND quantity > 0 AND (expires_at IS NULL OR expires_at > $2) GROUP BY item_id`,
      [user, clock()],
    );
    return Object.fromEntries(rows.map((r) => [r.item_id, Number(r.n)]));
  };
  /** what's on your beaches other than `except` */
  const itemsElsewhere = async (user: string, except: string): Promise<Record<string, number>> => {
    const rows = await db.query<{ items: Record<string, number> | string }>('SELECT items FROM beach WHERE owner_id = $1 AND id <> $2', [user, except]);
    const out: Record<string, number> = {};
    for (const r of rows) for (const [k, v] of Object.entries(jsonMap(r.items))) out[k] = (out[k] ?? 0) + Number(v);
    return out;
  };
  const fitOf = async (user: string, need: Record<string, number>, target: string) => {
    const [owned, elsewhere] = await Promise.all([ownedItems(user), itemsElsewhere(user, target)]);
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
      `INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, from_name, location, nx, ny, sand, bytes, items, objects, created_at)
       VALUES ($1, $2, $3, $14, 'beach', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (from_beach) WHERE kind = 'auto' DO UPDATE SET
         name = EXCLUDED.name, from_name = EXCLUDED.from_name, location = EXCLUDED.location, nx = EXCLUDED.nx, ny = EXCLUDED.ny,
         sand = EXCLUDED.sand, bytes = EXCLUDED.bytes, items = EXCLUDED.items, objects = EXCLUDED.objects, created_at = EXCLUDED.created_at
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
    return oneAtATime(me, async () => {
      let bytes = toBytes(cp.sand);
      const info = inspect(bytes);
      const fit = await fitOf(me, info.items, target);
      let dropped = 0;
      if (fit.short.length) {
        if (mode === 'strict') return c.json({ error: 'short', short: fit.short }, 409);
        ({ bytes, dropped } = dropMissing(bytes, fit.short));
      }
      const placed = dropped ? inspect(bytes) : info;
      // what's there now becomes the beach's "before restoring" checkpoint
      const current = (await db.query<{ sand: unknown }>('SELECT sand FROM beach WHERE id = $1 AND sand IS NOT NULL', [target]))[0];
      let before: { items: Record<string, number>; objects: number } = { items: {}, objects: 0 };
      if (current) {
        try {
          before = inspectBlob(toBytes(current.sand));
        } catch {
          /* an unreadable old save: keep it, uncounted */
        }
      }
      const now = clock();
      const rows = await db.query<{ version: number; epoch: number; undo: string | null }>(
        `WITH snap AS (
           INSERT INTO checkpoints (id, owner_id, name, kind, source, from_beach, from_name, location, nx, ny, sand, bytes, items, objects, created_at)
           SELECT $1, owner_id, $2, 'auto', 'beach', id, name, location, nx, ny, sand, octet_length(sand), $3, $4, $5
             FROM beach WHERE id = $6 AND sand IS NOT NULL
           ON CONFLICT (from_beach) WHERE kind = 'auto' DO UPDATE SET
             name = EXCLUDED.name, from_name = EXCLUDED.from_name, location = EXCLUDED.location, nx = EXCLUDED.nx, ny = EXCLUDED.ny,
             sand = EXCLUDED.sand, bytes = EXCLUDED.bytes, items = EXCLUDED.items, objects = EXCLUDED.objects, created_at = EXCLUDED.created_at
           RETURNING id
         )
         UPDATE beach SET sand = $7, nx = $8, ny = $9, items = $10, version = version + 1, updated_at = $5, epoch = epoch + 1,
                simulated_until = $5
          WHERE id = $6
         RETURNING version, epoch, (SELECT id FROM snap) AS undo`,
        [
          crypto.randomUUID(),
          `Before restoring “${cp.name}”`.slice(0, 80),
          JSON.stringify(before.items),
          before.objects,
          now,
          target,
          bytes,
          info.nx,
          info.ny,
          JSON.stringify(placed.items),
        ],
      );
      return c.json({ version: rows[0].version, epoch: Number(rows[0].epoch), updatedAt: now, undo: rows[0].undo, dropped });
    });
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
        const cents = price(p);
        return cents === null ? [] : [{ id: p.id, name: p.name, grants: p.grants, usd: cents / 100, blurb: p.blurb, featured: !!p.featured }];
      }),
      // the web shop can take payment itself (Xsolla), instead of pointing at the apps
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
    const product = productById(productId ?? '');
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
    const items = product!.grants.map((g) => g.item);
    const qty = product!.grants.map((g) => g.quantity);
    // Grant the items and any creator credit in the same transaction.
    const rows = await db.withTransaction(async (tx) => {
      const granted = await tx.query<{ purchase_id: string }>(
        `WITH p AS (
           INSERT INTO purchases (user_id, store, transaction_id, product_id, environment, purchased_at, granted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (store, transaction_id) DO NOTHING
           RETURNING id, user_id
         )
         INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, purchase_id)
         SELECT p.user_id, g.item, g.qty, 'shop', $7, p.id FROM p, unnest($8::text[], $9::int[]) AS g(item, qty)
         RETURNING purchase_id`,
        [me, v.store, v.transactionId, product!.id, v.environment, v.purchasedAt, now, items, qty],
      );
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
      return granted;
    });
    if (!rows.length) {
      const prev = (await db.query<{ user_id: string }>('SELECT user_id FROM purchases WHERE store = $1 AND transaction_id = $2', [v!.store, v!.transactionId]))[0];
      if (prev && prev.user_id !== me) fail(409, 'that purchase was already used by another account');
      return c.json({ already: true, product: product!.id, grants: product!.grants });
    }
    return c.json({ already: false, product: product!.id, grants: product!.grants });
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
      grants: productById(o.product_id)?.grants ?? [],
    };
  };
  const isUuid = (s: string) => UUID_PATTERN.test(s);

  app.post('/store/web-checkout', requireUser, async (c) => {
    if (!cfg.xsolla) fail(404, 'buying on the web is not open yet: buy in the beech app');
    const me = c.get('user').id;
    if (!checkoutLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const { productId, promoCode } = await body<{ productId?: string; promoCode?: string }>(c);
    const product = productById(productId ?? '');
    if (!product) fail(404, 'no such product');
    // Xsolla charges its catalog price, so a promo from our own list can't
    // discount a card payment yet (docs/WEB_PAYMENTS.md, "Promo codes").
    if (promoCode) fail(400, 'promo codes work with credit only for now: clear the code to pay by card');
    const id = crypto.randomUUID();
    const now = clock();
    const offer = await creatorOffer(db, product!);
    const amount = salePriceCents(product!, offer) ?? fail(404, 'that product is not for sale');
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
  });

  app.get('/store/web-orders/:id', requireUser, async (c) => {
    const id = c.req.param('id') ?? '';
    if (!isUuid(id)) fail(404, 'no such order');
    const rows = await db.query<WebOrderRow>('SELECT * FROM web_orders WHERE id = $1 AND user_id = $2', [id, c.get('user').id]);
    if (!rows[0]) fail(404, 'no such order');
    return c.json({ order: orderView(rows[0]) });
  });

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
      const product = productById(o.product_id)!;
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
      const grantItems = product.grants.map((g) => g.item);
      const qty = product.grants.map((g) => g.quantity);
      // Record the payment once, mark the order paid, and grant items and credit atomically.
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
           INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, purchase_id)
           SELECT p.user_id, g.item, g.qty, 'shop', $5, p.id FROM p, unnest($7::text[], $8::int[]) AS g(item, qty)
           RETURNING purchase_id`,
          [o.user_id, providerId, product.id, testPayment ? 'Sandbox' : 'Production', now, o.id, grantItems, qty],
        );
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
    const product = productById(productId ?? '');
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
        itemId: product!.steamItemId,
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
    const product = productById(o!.product_id)!;
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
    const grantItems = product.grants.map((g) => g.item);
    const qty = product.grants.map((g) => g.quantity);
    const granted = await db.withTransaction(async (tx) => {
      const [order] = await tx.query<{ status: string }>('SELECT status FROM steam_orders WHERE order_id = $1 FOR NO KEY UPDATE', [oid]);
      if (order?.status === 'paid') return [];
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
         INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, purchase_id)
         SELECT p.user_id, g.item, g.qty, 'shop', $5, p.id FROM p, unnest($7::text[], $8::int[]) AS g(item, qty)
         RETURNING purchase_id`,
        [me, transId, product.id, o!.sandbox ? 'Sandbox' : 'Production', now, oid, grantItems, qty],
      );
      if (rows.length && o!.creator_submission_id && !o!.sandbox) {
        await awardCheckoutCreatorCredit(tx, {
          submissionId: o!.creator_submission_id, product, buyer: me, storePurchaseId: rows[0].purchase_id,
          paidCents: Number(o!.amount_cents), now,
        });
      }
      return rows;
    });
    logEvent('steam_checkout_paid', { product: product.id, order_id: oid, granted: granted.length > 0 });
    return c.json({ ok: true, already: granted.length === 0, grants: product.grants });
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
  // Gift cards are prepaid credit; credit buys products server-side, where
  // a promo code can discount the price. The server prices from its own
  // product list — a client-supplied price is never trusted. See
  // docs/GIFT_CARDS_PROMOS.md.
  const redeemLimiter = createRateLimiter(10); // gift card guesses, per user per minute
  const creditLimiter = createRateLimiter(30); // quotes and credit purchases, per user per minute

  const loadPromo = async (code: string, conn = db): Promise<Promo | null> => {
    const rows = await conn.query<{
      code: string;
      kind: string;
      value: number;
      applies_to: string | null;
      max_uses: number | null;
      uses: number;
      active: boolean;
      expires_at: string | null;
    }>('SELECT code, kind, value, applies_to, max_uses, uses, active, expires_at FROM promo_codes WHERE code = $1', [code]);
    const r = rows[0];
    if (!r) return null;
    return {
      code: r.code,
      kind: r.kind as 'percent' | 'fixed',
      value: Number(r.value),
      appliesTo: r.applies_to,
      maxUses: r.max_uses === null ? null : Number(r.max_uses),
      uses: Number(r.uses),
      active: r.active,
      expiresAt: r.expires_at === null ? null : Number(r.expires_at),
    };
  };

  // --- players: redeem a gift card, see credit, buy with credit ---
  app.post('/gift-cards/redeem', requireUser, async (c) => {
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
    // one statement: claim the card (only if still active and unexpired —
    // a second redeem racing this one claims nothing), credit the player,
    // and log the movement, all or nothing
    const rows = await db.query<{ amount_cents: number; credit_cents: number }>(
      `WITH claimed AS (
         UPDATE gift_cards SET status = 'redeemed', redeemed_by = $2, redeemed_at = $3
          WHERE code_hash = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > $3)
          RETURNING id, amount_cents
       ), credited AS (
         UPDATE users SET credit_cents = credit_cents + (SELECT amount_cents FROM claimed)
          WHERE id = $2 AND EXISTS (SELECT 1 FROM claimed)
          RETURNING credit_cents
       ), logged AS (
         INSERT INTO credit_ledger (user_id, kind, amount_cents, ref, created_at)
         SELECT $2, 'gift_card', amount_cents, id::text, $3 FROM claimed
         RETURNING 1
       )
       SELECT claimed.amount_cents, credited.credit_cents FROM claimed, credited`,
      [hash, me, now],
    );
    if (!rows[0]) fail(409, 'that card was just used');
    return c.json({ creditedCents: Number(rows[0].amount_cents), creditCents: Number(rows[0].credit_cents) });
  });

  app.get('/credit', requireUser, async (c) => {
    const rows = await db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [c.get('user').id]);
    return c.json({ creditCents: Number(rows[0]?.credit_cents ?? 0) });
  });

  // What a product costs with a promo code, before buying (validates the
  // code but doesn't use it).
  app.post('/store/quote', requireUser, async (c) => {
    const me = c.get('user').id;
    if (!creditLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const { productId, promoCode } = await body<{ productId?: string; promoCode?: string }>(c);
    const product = productById(productId ?? '');
    if (!product) fail(404, 'no such product');
    const offer = await creatorOffer(db, product!);
    const priceCents = salePriceCents(product!, offer) ?? fail(404, 'that product is not for sale');
    let discount = 0;
    let promo: Promo | null = null;
    if (promoCode) {
      promo = await loadPromo(normalizePromoCode(promoCode));
      if (!promo) fail(404, 'no such code');
      const blocked = promoBlocked(promo!, product!.id, clock());
      if (blocked) fail(400, blocked);
      discount = discountCents(promo!, priceCents);
    }
    return c.json({
      product: product!.id,
      priceCents,
      discountCents: discount,
      finalCents: priceCents - discount,
      promo: promo ? promo.code : undefined,
    });
  });

  // The credit debit, promo, inventory grant, receipt and creator credit
  // commit together. A repeated request ID returns the first receipt.
  app.post('/store/credit-purchase', requireUser, async (c) => {
    const me = c.get('user').id;
    if (!creditLimiter(me)) return c.json({ error: 'slow down' }, 429);
    const { productId, promoCode, requestId } = await body<{ productId?: string; promoCode?: string; requestId?: string }>(c);
    const product = productById(productId ?? '') ?? fail(404, 'no such product');
    if (requestId !== undefined && (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId))) fail(400, 'invalid request ID');
    if (promoCode !== undefined && typeof promoCode !== 'string') fail(400, 'invalid promo code');
    const code = promoCode ? normalizePromoCode(promoCode) : null;
    const now = clock();
    const result = await db.withTransaction(async (tx) => {
      const balance = async () => (await tx.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [me]))[0]?.credit_cents ?? 0;
      if (requestId) {
        const [claimed] = await tx.query(
          `INSERT INTO credit_shop_orders (user_id, request_id, product_id, promo_code, paid_cents, discount_cents)
           VALUES ($1, $2, $3, $4, 0, 0) ON CONFLICT DO NOTHING RETURNING 1`,
          [me, requestId, product.id, code],
        );
        if (!claimed) {
          const [order] = await tx.query<{ product_id: string; promo_code: string | null; paid_cents: number; discount_cents: number }>(
            'SELECT product_id, promo_code, paid_cents, discount_cents FROM credit_shop_orders WHERE user_id = $1 AND request_id = $2',
            [me, requestId],
          );
          if (!order || order.product_id !== product.id || order.promo_code !== code) fail(409, 'that request ID was used for a different purchase');
          return { paidCents: order.paid_cents, discountCents: order.discount_cents, creditCents: await balance() };
        }
      }

      const offer = await creatorOffer(tx, product, true);
      const price = salePriceCents(product, offer) ?? fail(404, 'that product is not for sale');
      let discount = 0;
      if (code !== null) {
        const promo = await loadPromo(code, tx) ?? fail(404, 'no such code');
        const blocked = promoBlocked(promo, product.id, now);
        if (blocked) fail(400, blocked);
        discount = discountCents(promo, price);
      }
      const paid = price - discount;
      if (offer) await lockCreditUsers(tx, me, offer);
      const available = await balance();
      if (available < paid) throw new HTTPException(402, {
        message: `not enough credit: ${formatCents(paid)} needed, ${formatCents(available)} available`,
      });

      const granted = await claimCreditPurchase(tx, {
        userId: me,
        productId: product.id,
        promoCode: code,
        finalCents: paid,
        discountCents: discount,
        items: product.grants.map((g) => g.item),
        quantities: product.grants.map((g) => g.quantity),
        now,
      });
      if (!granted.length) fail(409, 'that did not go through: try again');
      if (offer) await awardCreatorCredit(tx, { offer, buyer: me, purchaseRef: `credit:${granted[0]}`, paidCents: paid, now });
      if (requestId) await tx.query(
        'UPDATE credit_shop_orders SET paid_cents = $3, discount_cents = $4 WHERE user_id = $1 AND request_id = $2',
        [me, requestId, paid, discount],
      );
      return { paidCents: paid, discountCents: discount, creditCents: await balance() };
    });
    return c.json({ product: product.id, grants: product.grants, ...result });
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
    const rows = await tx.query<{ inbox: string | null }>(
      `WITH giver AS (
         UPDATE inventory SET quantity = quantity - 1
          WHERE id = (
            SELECT id FROM inventory
             WHERE user_id = $1 AND item_id = $2 AND quantity > 0
               AND (expires_at IS NULL OR expires_at > $3)
             ORDER BY acquired_at ASC LIMIT 1
          ) AND quantity > 0
         RETURNING item_id, expires_at, purchase_id
       ), given AS (
         -- the gift keeps the purchase it came from, so a refund of that
         -- purchase takes it back from the recipient too (otherwise: buy,
         -- gift it to a second account, get a refund, keep the item)
         INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at, expires_at, purchase_id)
         SELECT $4, item_id, 1, 'gift', $3, expires_at, purchase_id FROM giver
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

  app.post('/gifts', requireUser, async (c) => {
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
  });

  // ---------------------------------------------------------------- the beach guide
  // A checklist that teaches the game one mechanic at a time (docs/INVITES_GUIDE.md).
  // Each step is done once: the row and its gift go in one statement, so a
  // retry or a second device can't double a gift. Steps the server can see
  // for itself (a claw go, a star, a friend who joined) are checked here.
  /** the steps that count toward the bonus and settling in (not `invite`, not the bonus marker) */
  const COUNTED = `step NOT IN ('invite', 'bonus')`;
  const serverCheck: Record<string, (user: string) => Promise<boolean>> = {
    claw: async (u) => (await db.query(`SELECT 1 FROM pulls WHERE user_id = $1 AND pool = 'daily' LIMIT 1`, [u])).length > 0,
    star: async (u) => (await db.query('SELECT 1 FROM star_first WHERE user_id = $1 LIMIT 1', [u])).length > 0,
    invite: async (u) => (await db.query('SELECT 1 FROM referrals WHERE inviter_id = $1 LIMIT 1', [u])).length > 0,
  };
  /** one reward row */
  const REWARD_ROW = `INSERT INTO inventory (user_id, item_id, quantity, source, acquired_at)`;

  /**
   * If `invitee` came through an invite and has now done enough of the guide,
   * mark them settled in and give their inviter the next rung of the ladder.
   * The rank is unique per inviter: two friends settling at the same moment
   * can't take the same rung (the loser's statement fails and it retries).
   */
  const settle = async (invitee: string): Promise<void> => {
    const r = (
      await db.query<{ inviter_id: string; n: string }>(
        `SELECT inviter_id, (SELECT COUNT(*) FROM guide_steps WHERE user_id = $1 AND ${COUNTED}) AS n
           FROM referrals WHERE invitee_id = $1 AND qualified_at IS NULL`,
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
              WHERE invitee_id = $1 AND qualified_at IS NULL
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
    return c.json({ name: them.name?.trim() || 'Someone', welcomeGift: WELCOME_GIFT });
  });

  // A new player who came through a link claims it once: they get the welcome
  // gift now; the inviter's reward waits until they settle in (settle()).
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
    const rows = await db.query<{ n: string }>(
      `WITH r AS (
         INSERT INTO referrals (invitee_id, inviter_id, code, created_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (invitee_id) DO NOTHING RETURNING inviter_id
       ), g AS (
         ${REWARD_ROW} SELECT $1, $5, 1, 'reward', $4 FROM r RETURNING 1
       ), s AS (
         -- the inviter's guide: a friend joined
         INSERT INTO guide_steps (user_id, step, done_at) SELECT inviter_id, 'invite', $4 FROM r
         ON CONFLICT DO NOTHING RETURNING 1
       ), told AS (
         INSERT INTO inbox (user_id, kind, actor_id, created_at) SELECT inviter_id, 'invite_joined', $1, $4 FROM r RETURNING 1
       )
       SELECT (SELECT COUNT(*) FROM r) AS n`,
      [me, them!.owner_id, them!.code, now, WELCOME_GIFT],
    );
    if (Number(rows[0].n) === 0) fail(409, 'you already joined through an invite');
    // guide steps done before the claim (signed out, then synced) count too
    await settle(me);
    return c.json({ inviter: { name: them!.name?.trim() || 'Someone', code: them!.code }, gift: WELCOME_GIFT });
  });

  // Your invites: your link's code, who joined, who settled in, and the ladder.
  app.get('/referrals', requireUser, async (c) => {
    const me = c.get('user').id;
    const code = (await db.query<{ code: string }>('SELECT code FROM beach WHERE id = $1', [await homeOf(me)]))[0]?.code ?? '';
    const rows = await db.query<{ name: string; qualified_at: string | null; reward_item: string | null; created_at: string }>(
      `SELECT u.name, r.qualified_at, r.reward_item, r.created_at
         FROM referrals r JOIN users u ON u.id = r.invitee_id
        WHERE r.inviter_id = $1 ORDER BY r.created_at`,
      [me],
    );
    const friends = rows.map((r) => ({
      name: r.name?.trim() || 'Someone',
      joinedAt: Number(r.created_at),
      settled: r.qualified_at !== null,
      reward: r.reward_item,
    }));
    return c.json({
      code,
      joined: friends.length,
      settled: friends.filter((f) => f.settled).length,
      friends,
      ladder: ladder(),
      cap: REWARD_CAP,
      settleSteps: SETTLE_STEPS,
      welcomeGift: WELCOME_GIFT,
      steps: GUIDE_STEPS.length,
    });
  });


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
    await db.query('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
      c.get('user').id,
      them!.owner_id,
      clock(),
    ]);
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
