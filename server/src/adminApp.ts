// The admin console: a separate app from the game (its own Cloud Run
// service, adminServer.ts), sharing the database. See
// docs/GIFT_CARDS_PROMOS.md ("Admin console").
//
// Nothing loads without a Google sign-in. GET / serves only a sign-in page
// until the browser holds an admin session; the console page and every
// /api route need one (or the CLI token). A session is made by POST
// /auth/google with a Google ID token whose *verified* email is on
// ADMIN_EMAILS; it lives in an HttpOnly, Secure, SameSite=Strict cookie, and
// the allowlist is checked again on every request.
//
//   GET    /                                -> sign-in page, or the console when signed in
//   POST   /auth/google      { credential }  -> 204 + session cookie | 403
//   POST   /auth/logout                      -> 204
//   GET    /api/me
//   GET    /api/stats
//   GET    /api/products
//   POST   /api/gift-cards   { amountCents, expiresAt?, note? }   (the code is shown once)
//   GET    /api/gift-cards
//   POST   /api/gift-cards/:id/disable
//   POST   /api/promo-codes  { code, kind, value, appliesTo?, maxUses?, expiresAt? }
//   GET    /api/promo-codes
//   POST   /api/promo-codes/:code/disable
//   GET    /api/redemptions
//   GET    /api/beaches?q=&limit=&offset=   search by code, beach name, owner name or email
//   GET    /api/beaches/:id                  one beach: owner, neighbors, requests, checkpoints
//   PATCH  /api/beaches/:id  { name?, onShore? }
//   POST   /api/beaches/:id/new-code
//   POST   /api/beaches/:id/unlink { side }
//   POST   /api/beaches/:id/clear            (what was there becomes its "before" checkpoint)
//   DELETE /api/beaches/:id                  (not a home beach)
//
// CSRF: the cookie is SameSite=Strict, and every cookie-authenticated
// request must also carry `X-Beech-Admin: 1`, a header a cross-site page
// can't send without a CORS preflight this app never answers.

import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';

import { adminConsoleHtml, adminSignInHtml } from './adminPage.js';
import { hashToken, newSessionToken, verifyGoogleIdToken } from './auth.js';
import { BUCK, centsToBucks } from './bucks.js';
import { clawBack, creditBalance } from './bucksDb.js';
import { BadBlob, inspectBlob } from './checkpoints.js';
import { centsToBucks } from './bucks.js';
import { toBytes, type Db } from './db.js';
import { formatCents, hashesEqual, hashGiftCode, isAdminEmail, isPromoCodeShape, newGiftCardCode, normalizePromoCode } from './giftCards.js';
import { ledgerLabel } from './ledger.js';
import { createRateLimiter, logEvent, routeLabel } from './observability.js';
import { PACKS, PRODUCTS, bucksIn, packById, productById, storeProductById } from './products.js';
import { accountPromos } from './promos.js';
import { revokePurchaseById } from './store.js';
import { adminSubmission, adminSubmissions, eligibleProduct, limitUpload, multipart, reviewSubmission, UUID_PATTERN } from './itemSubmissions.js';

export interface AdminConfig {
  /** the web OAuth client id (public): the sign-in button and the ID token's audience */
  googleClientId: string | null;
  /** verified Google emails allowed in (ADMIN_EMAILS). Empty: nobody. */
  adminEmails: string[];
  /** SHA-256 hex of ADMIN_API_TOKEN, the CLI's credential. Unset: no CLI. */
  adminTokenHash?: string;
  /** GIFT_CODE_PEPPER: must match the game server's, or issued cards won't redeem */
  codePepper?: string;
  /** the game's URL, for "open this beach" links (BEECH_APP_URL) */
  appUrl?: string;
  /** injectable for tests */
  verifyGoogle?: typeof verifyGoogleIdToken;
  now?: () => number;
}

type Env = { Variables: { actor: string; email: string | null } };

export const ADMIN_COOKIE = '__Host-beech-admin';
export const ADMIN_SESSION_HOURS = 12;
export const CSRF_HEADER = 'X-Beech-Admin';
const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const fail = (status: 400 | 401 | 403 | 404 | 409 | 429 | 500, message: string): never => {
  throw new HTTPException(status, { message });
};

const newBeachCode = (): string => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
};

/** a per-response nonce for the Content-Security-Policy */
const newNonce = (): string => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
};

export function createAdminApp(db: Db, cfg: AdminConfig): Hono<Env> {
  const app = new Hono<Env>();
  const clock = () => cfg.now?.() ?? Date.now();
  const verifyGoogle = cfg.verifyGoogle ?? verifyGoogleIdToken;
  const pepper = cfg.codePepper ?? '';
  const limiter = createRateLimiter(120);
  const signInLimiter = createRateLimiter(10);
  const ipOf = (c: Context) => (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown';

  app.use('*', async (c, next) => {
    await next();
    // admin answers are never cached, framed or sent on as a referrer
    c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.set('X-Frame-Options', 'DENY');
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'no-referrer');
    c.res.headers.set('Strict-Transport-Security', 'max-age=31536000');
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    logEvent('admin_error', { route: routeLabel(c), message: err.message, stack: String(err.stack ?? '').slice(0, 1000) }, 'ERROR');
    return c.json({ error: 'something went wrong' }, 500);
  });
  app.notFound((c) => c.json({ error: 'not found' }, 404));

  // ---------------------------------------------------------------- sessions
  /** the signed-in admin's email from the session cookie, or null */
  const sessionEmail = async (c: Context): Promise<{ email: string; tokenHash: string } | null> => {
    const token = getCookie(c, ADMIN_COOKIE);
    if (!token || token.length > 100) return null;
    const tokenHash = await hashToken(token);
    const rows = await db.query<{ email: string; expires_at: string }>('SELECT email, expires_at FROM admin_sessions WHERE token_hash = $1', [
      tokenHash,
    ]);
    const row = rows[0];
    if (!row || Number(row.expires_at) < clock()) return null;
    // the allowlist is read on every request: taking an email off it locks them out now
    if (!isAdminEmail(row.email, cfg.adminEmails)) return null;
    return { email: row.email, tokenHash };
  };

  const csp = (nonce: string, google: boolean) =>
    [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'${google ? ' https://accounts.google.com/gsi/client' : ''}`,
      `style-src 'nonce-${nonce}'${google ? " 'unsafe-inline' https://accounts.google.com/gsi/style" : ''}`,
      google ? 'frame-src https://accounts.google.com/gsi/' : '',
      `connect-src 'self'${google ? ' https://accounts.google.com/gsi/' : ''}`,
      "img-src 'self' data:",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]
      .filter(Boolean)
      .join('; ');

  app.get('/health', (c) => c.text('ok'));

  // The page: the console only for a signed-in admin. Everyone else gets the
  // sign-in page, which holds nothing but a Google button.
  app.get('/', async (c) => {
    const nonce = newNonce();
    const s = await sessionEmail(c);
    if (s) {
      c.header('Content-Security-Policy', csp(nonce, false));
      return c.html(adminConsoleHtml({ nonce, email: s.email, appUrl: cfg.appUrl ?? null }));
    }
    c.header('Content-Security-Policy', csp(nonce, true));
    return c.html(adminSignInHtml({ nonce, googleClientId: cfg.googleClientId }));
  });

  const requireCsrfHeader = (c: Context) => {
    if (c.req.header(CSRF_HEADER) !== '1') fail(403, 'not allowed');
  };

  app.post('/auth/google', async (c) => {
    requireCsrfHeader(c);
    if (!signInLimiter(ipOf(c))) fail(429, 'slow down');
    if (!cfg.googleClientId) fail(403, 'Google sign-in is not configured');
    const { credential } = await body<{ credential?: string }>(c);
    if (!credential || typeof credential !== 'string') fail(400, 'credential required');
    let email: string | undefined;
    try {
      // the audience is the web client only: a token minted for another app doesn't count
      email = (await verifyGoogle(credential!, [cfg.googleClientId!])).email;
    } catch {
      fail(401, 'Google sign-in failed');
    }
    // an unverified email never arrives here (verifyGoogleIdToken drops it)
    if (!isAdminEmail(email, cfg.adminEmails)) {
      logEvent('admin_sign_in', { ok: false }, 'WARNING');
      fail(403, 'not allowed');
    }
    const token = newSessionToken();
    const now = clock();
    await db.query('INSERT INTO admin_sessions (token_hash, email, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
      await hashToken(token),
      email!.toLowerCase(),
      now,
      now + ADMIN_SESSION_HOURS * 3600000,
    ]);
    await db.query('DELETE FROM admin_sessions WHERE expires_at < $1', [now]);
    setCookie(c, ADMIN_COOKIE, token, { path: '/', secure: true, httpOnly: true, sameSite: 'Strict', maxAge: ADMIN_SESSION_HOURS * 3600 });
    logEvent('admin_sign_in', { ok: true });
    return c.body(null, 204);
  });

  app.post('/auth/logout', async (c) => {
    requireCsrfHeader(c);
    const token = getCookie(c, ADMIN_COOKIE);
    if (token) await db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [await hashToken(token)]);
    deleteCookie(c, ADMIN_COOKIE, { path: '/', secure: true });
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- the API gate
  // Two ways in: the CLI's bearer token (compared by hash, in constant time),
  // or a signed-in session cookie plus the CSRF header. Both are refused
  // with the same flat words, so nothing about the allowlist leaks.
  const api = new Hono<Env>();
  api.use('*', async (c, next) => {
    if (!limiter(ipOf(c))) return c.json({ error: 'slow down' }, 429);
    const m = /^Bearer\s+(\S+)$/.exec(c.req.header('Authorization') ?? '');
    if (m) {
      if (cfg.adminTokenHash && hashesEqual(await hashToken(m[1]), cfg.adminTokenHash)) {
        c.set('actor', 'cli-token');
        c.set('email', null);
        return next();
      }
      fail(401, 'sign in first');
    }
    const s = await sessionEmail(c);
    if (!s) fail(401, 'sign in first');
    requireCsrfHeader(c);
    c.set('actor', s!.email);
    c.set('email', s!.email);
    return next();
  });

  /** an admin audit line. `detail` must never hold a gift card code. */
  const audit = async (actor: string, action: string, targetType: string, targetId: string, detail: Record<string, unknown>, tx: Db = db) => {
    await tx.query('INSERT INTO admin_audit (actor, action, target_type, target_id, detail, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
      actor,
      action,
      targetType,
      targetId,
      JSON.stringify(detail),
      clock(),
    ]);
  };

  async function body<T>(c: Context): Promise<T> {
    try {
      return (await c.req.json()) as T;
    } catch {
      return fail(400, 'expected a JSON body');
    }
  }

  api.get('/me', (c) => c.json({ admin: true, via: c.get('actor') === 'cli-token' ? 'token' : 'session', email: c.get('email') }));

  api.get('/item-submissions', async (c) => {
    const status = c.req.query('status') ?? 'pending';
    const offset = Number(c.req.query('offset') ?? '0');
    if (!['pending', 'approved', 'rejected'].includes(status) || !Number.isSafeInteger(offset) || offset < 0) {
      return fail(400, 'Invalid submission filter.');
    }
    const rows = await adminSubmissions(db, status, offset);
    return c.json({ submissions: rows.slice(0, 25), more: rows.length > 25 });
  });

  api.get('/item-submissions/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID_PATTERN.test(id)) return fail(404, 'No such submission.');
    const submission = await adminSubmission(db, id);
    if (!submission) return fail(404, 'No such submission.');
    const products = PRODUCTS.filter((p) => eligibleProduct(p.id)).map((p) => ({ id: p.id, itemId: p.grants[0].item }));
    return c.json({ submission, products });
  });

  api.get('/item-submissions/:id/files/:file', async (c) => {
    const { id, file } = c.req.param();
    if (!UUID_PATTERN.test(id) || !['original', 'preview', 'replacement'].includes(file)) {
      return fail(404, 'No such upload.');
    }
    const [row] = await db.query<{ filename: string | null; bytes: unknown }>(
      `SELECT CASE $2 WHEN 'original' THEN asset_filename WHEN 'replacement' THEN replacement_filename
          ELSE CASE preview_mime WHEN 'image/png' THEN 'preview.png' ELSE 'preview.jpg' END END AS filename,
          CASE $2 WHEN 'original' THEN asset_bytes WHEN 'replacement' THEN replacement_bytes ELSE preview_bytes END AS bytes
       FROM item_submissions WHERE id = $1`, [id, file],
    );
    if (!row?.filename || !row.bytes) return fail(404, 'No such upload.');
    return c.body(toBytes(row.bytes).slice(), 200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${row.filename}"`,
    });
  });

  api.post('/item-submissions/:id/review', limitUpload, async (c) => {
    const id = c.req.param('id');
    if (!UUID_PATTERN.test(id)) return fail(404, 'No such submission.');
    const actor = c.get('actor');
    const form = await multipart(c.req.raw);
    const decision = await db.withTransaction(async (tx) => {
      const result = await reviewSubmission(tx, id, form, actor, clock());
      await audit(actor, 'review', 'item_submission', id, result, tx);
      return result;
    });
    return c.json(decision);
  });

  api.get('/products', (c) =>
    c.json({
      products: PRODUCTS.map((p) => ({ id: p.id, name: p.name, usd: p.usd, bucks: p.bucks })),
      packs: PACKS.map((p) => ({ id: p.id, name: p.name, usd: p.usd, bucks: p.bucks })),
    }),
  );

  api.get('/stats', async (c) => {
    const dayAgo = clock() - 86400000;
    const rows = await db.query<Record<string, string>>(
      `SELECT (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM beach) AS beaches,
              (SELECT COUNT(*) FROM beach WHERE sand IS NOT NULL) AS built,
              (SELECT COUNT(*) FROM beach WHERE NOT on_shore) AS hidden,
              (SELECT COUNT(*) FROM beach WHERE updated_at > $1) AS active_day,
              (SELECT COUNT(*) FROM neighbors) / 2 AS links`,
      [dayAgo],
    );
    const r = rows[0];
    return c.json({
      users: Number(r.users),
      beaches: Number(r.beaches),
      built: Number(r.built),
      hidden: Number(r.hidden),
      activeDay: Number(r.active_day),
      links: Number(r.links),
    });
  });

  // ---------------------------------------------------------------- gift cards
  api.post('/gift-cards', async (c) => {
    const { amountCents, expiresAt, note } = await body<{ amountCents?: number; expiresAt?: number | null; note?: string }>(c);
    const amount = Math.floor(Number(amountCents ?? NaN));
    if (!Number.isInteger(amount) || amount < 50 || amount > 100000) fail(400, 'amountCents must be 50 to 100000 ($0.50 to $1,000)');
    const exp = expiresAt == null ? null : Math.floor(Number(expiresAt));
    if (exp !== null && (!Number.isInteger(exp) || exp <= clock())) fail(400, 'expiresAt must be in the future');
    const cleanNote = String(note ?? '').trim().slice(0, 200);
    const now = clock();
    const actor = c.get('actor');
    // the code is returned once, in this response, and never again: only
    // its hash is stored, so a leaked database can't redeem the card
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newGiftCardCode();
      try {
        const id = crypto.randomUUID();
        await db.query(
          'INSERT INTO gift_cards (id, code_hash, amount_cents, status, issued_at, expires_at, note) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [id, hashGiftCode(code, pepper), amount, 'active', now, exp, cleanNote],
        );
        await audit(actor, 'gift_card.issue', 'gift_card', id, { amountCents: amount, expiresAt: exp });
        return c.json({ id, code, amountCents: amount, amount: formatCents(amount), status: 'active', issuedAt: now, expiresAt: exp, note: cleanNote });
      } catch (e) {
        if ((e as { code?: string }).code === '23505' && attempt < 4) continue; // hash collision: try another code
        throw e;
      }
    }
    return fail(500, 'could not make a gift card');
  });

  api.get('/gift-cards', async (c) => {
    const rows = await db.query<{
      id: string;
      amount_cents: number;
      status: string;
      issued_at: string;
      expires_at: string | null;
      redeemed_at: string | null;
      note: string;
      redeemed_name: string | null;
    }>(
      `SELECT g.id, g.amount_cents, g.status, g.issued_at, g.expires_at, g.redeemed_at, g.note, u.name AS redeemed_name
         FROM gift_cards g LEFT JOIN users u ON u.id = g.redeemed_by ORDER BY g.issued_at DESC LIMIT 100`,
    );
    return c.json({
      giftCards: rows.map((r) => ({
        id: r.id,
        amountCents: Number(r.amount_cents),
        amount: formatCents(Number(r.amount_cents)),
        status: r.status,
        issuedAt: Number(r.issued_at),
        expiresAt: r.expires_at === null ? null : Number(r.expires_at),
        redeemedAt: r.redeemed_at === null ? null : Number(r.redeemed_at),
        redeemedBy: r.redeemed_name ?? undefined,
        note: r.note,
      })),
    });
  });

  api.post('/gift-cards/:id/disable', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) fail(404, 'no active gift card with that id');
    const rows = await db.query<{ id: string }>("UPDATE gift_cards SET status = 'disabled' WHERE id = $1 AND status = 'active' RETURNING id", [id]);
    if (!rows[0]) fail(404, 'no active gift card with that id');
    await audit(c.get('actor'), 'gift_card.disable', 'gift_card', id, {});
    return c.json({ id, status: 'disabled' });
  });

  // ---------------------------------------------------------------- promo codes
  api.post('/promo-codes', async (c) => {
    const { code, kind, value, appliesTo, maxUses, expiresAt } = await body<{
      code?: string;
      kind?: string;
      value?: number;
      appliesTo?: string | null;
      maxUses?: number | null;
      expiresAt?: number | null;
    }>(c);
    const clean = normalizePromoCode(code ?? '');
    if (!isPromoCodeShape(code ?? '')) fail(400, 'codes are 3-32 letters and numbers');
    if (kind !== 'percent') fail(400, 'kind must be percent: promo codes are a percentage bonus on bb packs');
    const v = Math.floor(Number(value ?? NaN));
    if (!Number.isInteger(v) || v <= 0 || v > 100) fail(400, 'percent is 1-100');
    const applies = appliesTo ? String(appliesTo) : null;
    if (applies && !packById(applies) && !productById(applies)) fail(400, 'no such pack or product');
    const max = maxUses == null ? null : Math.floor(Number(maxUses));
    if (max !== null && (!Number.isInteger(max) || max <= 0)) fail(400, 'maxUses must be a positive number');
    const exp = expiresAt == null ? null : Math.floor(Number(expiresAt));
    if (exp !== null && (!Number.isInteger(exp) || exp <= clock())) fail(400, 'expiresAt must be in the future');
    const now = clock();
    try {
      await db.query(
        'INSERT INTO promo_codes (code, kind, value, applies_to, max_uses, active, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, true, $6, $7)',
        [clean, kind, v, applies, max, now, exp],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') fail(409, 'that code already exists');
      throw e;
    }
    await audit(c.get('actor'), 'promo.create', 'promo_code', clean, { kind, value: v, appliesTo: applies, maxUses: max, expiresAt: exp });
    return c.json({ promo: { code: clean, kind, value: v, appliesTo: applies, maxUses: max, uses: 0, active: true, createdAt: now, expiresAt: exp } });
  });

  api.get('/promo-codes', async (c) => {
    const rows = await db.query<{
      code: string;
      kind: string;
      value: number;
      applies_to: string | null;
      max_uses: number | null;
      uses: number;
      active: boolean;
      created_at: string;
      expires_at: string | null;
    }>('SELECT code, kind, value, applies_to, max_uses, uses, active, created_at, expires_at FROM promo_codes ORDER BY created_at DESC LIMIT 100');
    return c.json({
      promos: rows.map((r) => ({
        code: r.code,
        kind: r.kind,
        value: Number(r.value),
        appliesTo: r.applies_to,
        maxUses: r.max_uses === null ? null : Number(r.max_uses),
        uses: Number(r.uses),
        active: r.active,
        createdAt: Number(r.created_at),
        expiresAt: r.expires_at === null ? null : Number(r.expires_at),
      })),
    });
  });

  api.post('/promo-codes/:code/disable', async (c) => {
    const code = normalizePromoCode(c.req.param('code'));
    const rows = await db.query<{ code: string }>('UPDATE promo_codes SET active = false WHERE code = $1 AND active RETURNING code', [code]);
    if (!rows[0]) fail(404, 'no active promo code with that code');
    await audit(c.get('actor'), 'promo.disable', 'promo_code', code, {});
    return c.json({ code, active: false });
  });

  api.get('/redemptions', async (c) => {
    const cards = await db.query<{ id: string; amount_cents: number; redeemed_at: string; note: string; redeemed_name: string | null }>(
      `SELECT g.id, g.amount_cents, g.redeemed_at, g.note, u.name AS redeemed_name
         FROM gift_cards g JOIN users u ON u.id = g.redeemed_by WHERE g.status = 'redeemed' ORDER BY g.redeemed_at DESC LIMIT 50`,
    );
    const promos = await db.query<{ code: string; product_id: string; discount_cents: number; bonus_bucks: number; purchase_id: string | null; created_at: string; user_name: string | null }>(
      `SELECT p.code, p.product_id, p.discount_cents, p.bonus_bucks, p.purchase_id, p.created_at, u.name AS user_name
         FROM promo_uses p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 50`,
    );
    const ledger = await db.query<{ kind: string; amount_cents: number; ref: string; created_at: string; user_name: string | null }>(
      `SELECT l.kind, l.amount_cents, l.ref, l.created_at, u.name AS user_name
         FROM credit_ledger l JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 50`,
    );
    return c.json({
      giftCards: cards.map((r) => ({ id: r.id, amountCents: Number(r.amount_cents), redeemedAt: Number(r.redeemed_at), redeemedBy: r.redeemed_name, note: r.note })),
      promoUses: promos.map((r) => ({
        code: r.code,
        productId: r.product_id,
        discountCents: Number(r.discount_cents),
        bonusBucks: Number(r.bonus_bucks),
        purchaseId: r.purchase_id ? String(r.purchase_id) : null,
        usedAt: Number(r.created_at),
        user: r.user_name,
      })),
      credit: ledger.map((r) => ({
        kind: r.kind,
        amountCents: Number(r.amount_cents),
        bucks: Math.sign(Number(r.amount_cents)) * centsToBucks(Math.abs(Number(r.amount_cents))),
        ref: r.ref,
        createdAt: Number(r.created_at),
        user: r.user_name,
      })),
    });
  });

  // ---------------------------------------------------------------- referrals
  // Who invited whom (docs/INVITES_GUIDE.md), for disputes and to spot
  // farming: the latest referrals (optionally one player's, either side),
  // and the players who invited the most, with how many settled in, how many
  // came in the last day, and how many friends signed in the same way.
  api.get('/referrals', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 100);
    const offset = Number(c.req.query('offset') ?? '0');
    if (!Number.isSafeInteger(offset) || offset < 0) fail(400, 'bad offset');
    const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    const rows = await db.query<{
      created_at: string;
      qualified_at: string | null;
      reward_rank: number | null;
      reward_item: string | null;
      bonus_bucks: number | null;
      code: string;
      inviter_id: string;
      inviter_name: string;
      inviter_email: string | null;
      invitee_id: string;
      invitee_name: string;
      invitee_email: string | null;
      invitee_provider: string;
      invitee_joined: string;
    }>(
      `SELECT r.created_at, r.qualified_at, r.reward_rank, r.reward_item, r.bonus_bucks, r.code,
              a.id AS inviter_id, a.name AS inviter_name, a.email AS inviter_email,
              b.id AS invitee_id, b.name AS invitee_name, b.email AS invitee_email, b.provider AS invitee_provider, b.created_at AS invitee_joined
         FROM referrals r JOIN users a ON a.id = r.inviter_id JOIN users b ON b.id = r.invitee_id
        WHERE $1 = '' OR a.name ILIKE $2 OR a.email ILIKE $2 OR b.name ILIKE $2 OR b.email ILIKE $2 OR r.code ILIKE $2
           OR a.id::text = $1 OR b.id::text = $1
        ORDER BY r.created_at DESC, r.invitee_id
        LIMIT 51 OFFSET $3`,
      [q, like, offset],
    );
    const dayAgo = clock() - 86400000;
    const top = await db.query<{ id: string; name: string; email: string | null; n: string; settled: string; day: string; same_provider: string; rewarded: string }>(
      `SELECT a.id, a.name, a.email, COUNT(*) AS n,
              COUNT(r.qualified_at) AS settled,
              COUNT(*) FILTER (WHERE r.created_at > $1) AS day,
              COUNT(*) FILTER (WHERE b.provider = a.provider) AS same_provider,
              COUNT(r.reward_rank) AS rewarded
         FROM referrals r JOIN users a ON a.id = r.inviter_id JOIN users b ON b.id = r.invitee_id
        GROUP BY a.id, a.name, a.email
        ORDER BY COUNT(*) DESC, MAX(r.created_at) DESC
        LIMIT 20`,
      [dayAgo],
    );
    const totals = (
      await db.query<{ n: string; settled: string; day: string }>(
        `SELECT COUNT(*) AS n, COUNT(qualified_at) AS settled, COUNT(*) FILTER (WHERE created_at > $1) AS day FROM referrals`,
        [dayAgo],
      )
    )[0];
    const num = (v: string | number | null) => (v === null ? null : Number(v));
    return c.json({
      totals: { referrals: Number(totals.n), settled: Number(totals.settled), lastDay: Number(totals.day) },
      top: top.map((t) => ({
        id: t.id,
        name: t.name,
        email: t.email,
        invited: Number(t.n),
        settled: Number(t.settled),
        lastDay: Number(t.day),
        sameProvider: Number(t.same_provider),
        rewarded: Number(t.rewarded),
      })),
      referrals: rows.slice(0, 50).map((r) => ({
        at: Number(r.created_at),
        code: r.code,
        inviter: { id: r.inviter_id, name: r.inviter_name, email: r.inviter_email },
        invitee: { id: r.invitee_id, name: r.invitee_name, email: r.invitee_email, provider: r.invitee_provider, joinedAt: Number(r.invitee_joined) },
        settledAt: num(r.qualified_at),
        rewardRank: num(r.reward_rank),
        rewardItem: r.reward_item,
        bonusBucks: num(r.bonus_bucks),
      })),
      more: rows.length > 50,
    });
  });

  // ---------------------------------------------------------------- beech bucks
  // Trade-ins and debts (docs/BEECH_BUCKS.md), read-only: what players traded
  // in lately (searchable by player or item) and who owes bucks after a
  // refund clawed back what they'd already spent.
  api.get('/bucks', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 100);
    const offset = Number(c.req.query('offset') ?? '0');
    if (!Number.isSafeInteger(offset) || offset < 0) fail(400, 'bad offset');
    const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    const now = clock();
    const totals = (
      await db.query<{ day_n: string; day_cents: string | null; week_n: string; week_cents: string | null; debtors: string; debt: string | null; balance: string | null }>(
        `SELECT (SELECT COUNT(*) FROM trade_ins WHERE created_at > $1) AS day_n,
                (SELECT SUM(value_cents) FROM trade_ins WHERE created_at > $1) AS day_cents,
                (SELECT COUNT(*) FROM trade_ins WHERE created_at > $2) AS week_n,
                (SELECT SUM(value_cents) FROM trade_ins WHERE created_at > $2) AS week_cents,
                (SELECT COUNT(*) FROM users WHERE creator_credit_debt_cents > 0) AS debtors,
                (SELECT SUM(creator_credit_debt_cents) FROM users) AS debt,
                (SELECT SUM(credit_cents) FROM users) AS balance`,
        [now - 86400000, now - 7 * 86400000],
      )
    )[0];
    const trades = await db.query<{ id: string; item_id: string; quantity: number; value_cents: number; created_at: string; user_id: string; name: string; email: string | null }>(
      `SELECT t.id, t.item_id, t.quantity, t.value_cents, t.created_at, u.id AS user_id, u.name, u.email
         FROM trade_ins t JOIN users u ON u.id = t.user_id
        WHERE $1 = '' OR u.name ILIKE $2 OR u.email ILIKE $2 OR t.item_id ILIKE $2 OR u.id::text = $1
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 51 OFFSET $3`,
      [q, like, offset],
    );
    const debts = await db.query<{ id: string; name: string; email: string | null; debt: number; balance: number; last_refund: string | null }>(
      `SELECT u.id, u.name, u.email, u.creator_credit_debt_cents AS debt, u.credit_cents AS balance,
              (SELECT MAX(l.created_at) FROM credit_ledger l WHERE l.user_id = u.id AND l.kind LIKE '%\\_refund') AS last_refund
         FROM users u WHERE u.creator_credit_debt_cents > 0
        ORDER BY u.creator_credit_debt_cents DESC, u.id
        LIMIT 50`,
    );
    const bb = (cents: string | number | null) => centsToBucks(Number(cents ?? 0));
    return c.json({
      totals: {
        tradeInsDay: Number(totals.day_n),
        bucksDay: bb(totals.day_cents),
        tradeInsWeek: Number(totals.week_n),
        bucksWeek: bb(totals.week_cents),
        debtors: Number(totals.debtors),
        debtBucks: bb(totals.debt),
        balanceBucks: bb(totals.balance),
      },
      tradeIns: trades.slice(0, 50).map((t) => ({
        id: Number(t.id),
        at: Number(t.created_at),
        item: t.item_id,
        quantity: Number(t.quantity),
        bucks: bb(t.value_cents),
        player: { id: t.user_id, name: t.name, email: t.email },
      })),
      more: trades.length > 50,
      debts: debts.map((d) => ({
        player: { id: d.id, name: d.name, email: d.email },
        debtBucks: bb(d.debt),
        balanceBucks: bb(d.balance),
        lastRefundAt: d.last_refund === null ? null : Number(d.last_refund),
      })),
    });
  });

  // ---------------------------------------------------------------- beaches
  interface BeachRow {
    id: string;
    code: string;
    name: string;
    home: boolean;
    on_shore: boolean;
    location: string | null;
    nx: number | null;
    ny: number | null;
    version: number;
    epoch: number;
    updated_at: string | null;
    created_at: string;
    bytes: number | null;
    items: Record<string, number> | string;
    owner_id: string;
    owner_name: string;
    owner_email: string | null;
    owner_provider: string;
    left_code: string | null;
    right_code: string | null;
  }
  const BEACH_COLS = `b.id, b.code, b.name, b.home, b.on_shore, b.location, b.nx, b.ny, b.version, b.epoch, b.updated_at, b.created_at,
       octet_length(b.sand) AS bytes, b.items, b.owner_id, u.name AS owner_name, u.email AS owner_email, u.provider AS owner_provider,
       (SELECT nb.code FROM neighbors n JOIN beach nb ON nb.id = n.neighbor_beach_id WHERE n.beach_id = b.id AND n.side = 'left') AS left_code,
       (SELECT nb.code FROM neighbors n JOIN beach nb ON nb.id = n.neighbor_beach_id WHERE n.beach_id = b.id AND n.side = 'right') AS right_code`;
  const BEACH_FROM = `beach b JOIN users u ON u.id = b.owner_id`;
  const jsonMap = (v: Record<string, number> | string | null): Record<string, number> =>
    !v ? {} : typeof v === 'string' ? (JSON.parse(v) as Record<string, number>) : v;
  const appUrl = (cfg.appUrl ?? '').replace(/\/$/, '');
  const beachJson = (r: BeachRow) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    home: r.home,
    onShore: r.on_shore,
    location: r.location,
    nx: r.nx === null ? null : Number(r.nx),
    ny: r.ny === null ? null : Number(r.ny),
    version: Number(r.version),
    epoch: Number(r.epoch),
    updatedAt: r.updated_at === null ? null : Number(r.updated_at),
    createdAt: Number(r.created_at),
    bytes: r.bytes === null ? null : Number(r.bytes),
    items: jsonMap(r.items),
    owner: { id: r.owner_id, name: r.owner_name, email: r.owner_email, provider: r.owner_provider },
    left: r.left_code,
    right: r.right_code,
    visitUrl: appUrl ? `${appUrl}/?visit=${r.code}` : null,
  });
  const beachById = async (id: string): Promise<BeachRow> => {
    if (!UUID.test(id)) fail(404, 'no such beach');
    const row = (await db.query<BeachRow>(`SELECT ${BEACH_COLS} FROM ${BEACH_FROM} WHERE b.id = $1`, [id]))[0];
    if (!row) fail(404, 'no such beach');
    return row!;
  };

  api.get('/beaches', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 80);
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) | 0));
    const offset = Math.min(100000, Math.max(0, Number(c.req.query('offset') ?? 0) | 0));
    const filter = c.req.query('filter') ?? '';
    const where: string[] = [];
    const args: unknown[] = [];
    if (q) {
      const code = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
      args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      const like = `$${args.length}`;
      const parts = [`b.name ILIKE ${like}`, `u.name ILIKE ${like}`, `u.email ILIKE ${like}`];
      if (code.length === 6) {
        args.push(code);
        parts.push(`b.code = $${args.length}`);
      }
      if (UUID.test(q)) {
        args.push(q);
        parts.push(`b.id = $${args.length}::uuid OR b.owner_id = $${args.length}::uuid`);
      }
      where.push(`(${parts.join(' OR ')})`);
    }
    if (filter === 'hidden') where.push('NOT b.on_shore');
    if (filter === 'built') where.push('b.sand IS NOT NULL');
    args.push(limit + 1, offset);
    const rows = await db.query<BeachRow>(
      `SELECT ${BEACH_COLS} FROM ${BEACH_FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY b.updated_at DESC NULLS LAST, b.created_at DESC, b.id LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    return c.json({ beaches: rows.slice(0, limit).map(beachJson), more: rows.length > limit });
  });

  api.get('/beaches/:id', async (c) => {
    const b = await beachById(c.req.param('id'));
    const [others, requests, checkpoints, favorites] = await Promise.all([
      db.query<{ id: string; code: string; name: string; home: boolean }>(
        'SELECT id, code, name, home FROM beach WHERE owner_id = $1 AND id <> $2 ORDER BY home DESC, created_at',
        [b.owner_id, b.id],
      ),
      db.query<{ dir: string; side: string; code: string; created_at: string }>(
        `SELECT 'out' AS dir, r.side, t.code, r.created_at FROM neighbor_requests r JOIN beach t ON t.id = r.to_beach WHERE r.from_beach = $1
         UNION ALL
         SELECT 'in' AS dir, r.side, f.code, r.created_at FROM neighbor_requests r JOIN beach f ON f.id = r.from_beach WHERE r.to_beach = $1
         ORDER BY created_at DESC`,
        [b.id],
      ),
      db.query<{ id: string; name: string; kind: string; created_at: string }>(
        'SELECT id, name, kind, created_at FROM checkpoints WHERE from_beach = $1 ORDER BY created_at DESC LIMIT 20',
        [b.id],
      ),
      db.query<{ n: string }>('SELECT COUNT(*) AS n FROM favorites WHERE beach_id = $1', [b.id]),
    ]);
    return c.json({
      beach: beachJson(b),
      ownerBeaches: others.map((o) => ({ id: o.id, code: o.code, name: o.name, home: o.home })),
      requests: requests.map((r) => ({ dir: r.dir, side: r.side, code: r.code, createdAt: Number(r.created_at) })),
      checkpoints: checkpoints.map((k) => ({ id: k.id, name: k.name, kind: k.kind, createdAt: Number(k.created_at) })),
      favoritedBy: Number(favorites[0]?.n ?? 0),
    });
  });

  // rename (an unkind name) and/or take off / put back on the shore
  api.patch('/beaches/:id', async (c) => {
    const b = await beachById(c.req.param('id'));
    const p = await body<{ name?: unknown; onShore?: unknown }>(c);
    const changes: Record<string, unknown> = {};
    if (p.name !== undefined) {
      const name = String(p.name).trim().slice(0, 30);
      await db.query('UPDATE beach SET name = $1 WHERE id = $2', [name, b.id]);
      changes.name = { from: b.name, to: name };
    }
    if (p.onShore !== undefined) {
      if (typeof p.onShore !== 'boolean') fail(400, 'onShore must be true or false');
      await db.query('UPDATE beach SET on_shore = $1 WHERE id = $2', [p.onShore, b.id]);
      changes.onShore = p.onShore;
    }
    if (!Object.keys(changes).length) fail(400, 'nothing to change');
    await audit(c.get('actor'), 'beach.update', 'beach', b.id, changes);
    return c.json({ beach: beachJson(await beachById(b.id)) });
  });

  // a new code: the old one stops working (a code shared somewhere it shouldn't be)
  api.post('/beaches/:id/new-code', async (c) => {
    const b = await beachById(c.req.param('id'));
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newBeachCode();
      try {
        await db.query('UPDATE beach SET code = $1 WHERE id = $2', [code, b.id]);
        if (b.home && b.id === b.owner_id) await db.query('UPDATE users SET neighbor_code = $1 WHERE id = $2', [code, b.owner_id]).catch(() => {});
        await audit(c.get('actor'), 'beach.new_code', 'beach', b.id, { from: b.code, to: code });
        return c.json({ beach: beachJson(await beachById(b.id)) });
      } catch (e) {
        if ((e as { code?: string }).code !== '23505') throw e; // a collision: try another
      }
    }
    return fail(500, 'could not make a new code');
  });

  // part two neighbors (both ends of the link go)
  api.post('/beaches/:id/unlink', async (c) => {
    const b = await beachById(c.req.param('id'));
    const { side } = await body<{ side?: Side }>(c);
    if (!side || !SIDES.includes(side)) fail(400, 'side must be left or right');
    const other = side === 'left' ? 'right' : 'left';
    const rows = await db.query<{ neighbor_beach_id: string }>(
      'DELETE FROM neighbors WHERE (beach_id = $1 AND side = $2) OR (neighbor_beach_id = $1 AND side = $3) RETURNING neighbor_beach_id',
      [b.id, side, other],
    );
    if (!rows.length) fail(404, `no neighbor on the ${side}`);
    await audit(c.get('actor'), 'beach.unlink', 'beach', b.id, { side, code: side === 'left' ? b.left_code : b.right_code });
    return c.json({ beach: beachJson(await beachById(b.id)) });
  });

  // Wipe the sand (the owner's app starts it fresh). What was there becomes
  // the beach's "before" checkpoint, so the owner can put it back. The
  // epoch goes up, so a device still showing the old sand can't save it back.
  api.post('/beaches/:id/clear', async (c) => {
    const b = await beachById(c.req.param('id'));
    if (b.bytes === null) fail(409, 'that beach has no sand yet');
    const current = (await db.query<{ sand: unknown }>('SELECT sand FROM beach WHERE id = $1', [b.id]))[0];
    let before: { items: Record<string, number>; objects: number } = { items: {}, objects: 0 };
    try {
      before = inspectBlob(toBytes(current.sand));
    } catch (e) {
      if (!(e instanceof BadBlob)) throw e; // an unreadable save: keep it, uncounted
    }
    const now = clock();
    const rows = await db.query<{ undo: string | null }>(
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
       UPDATE beach SET sand = NULL, items = '{}', version = version + 1, updated_at = $5, epoch = epoch + 1
        WHERE id = $6
       RETURNING (SELECT id FROM snap) AS undo`,
      [crypto.randomUUID(), 'Before it was cleared', JSON.stringify(before.items), before.objects, now, b.id],
    );
    await audit(c.get('actor'), 'beach.clear', 'beach', b.id, { checkpoint: rows[0]?.undo ?? null, bytes: b.bytes });
    return c.json({ beach: beachJson(await beachById(b.id)), checkpoint: rows[0]?.undo ?? null });
  });

  // Remove a beach that isn't someone's home (a home beach goes only with its account).
  api.delete('/beaches/:id', async (c) => {
    const b = await beachById(c.req.param('id'));
    if (b.home) fail(409, "a home beach can't be removed");
    // links, requests and favorites go with it (ON DELETE CASCADE)
    const rows = await db.query('DELETE FROM beach WHERE id = $1 AND NOT home RETURNING id', [b.id]);
    if (!rows.length) fail(409, "a home beach can't be removed");
    await audit(c.get('actor'), 'beach.delete', 'beach', b.id, { code: b.code, name: b.name, owner: b.owner_id });
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- users, ledger corrections, refunds
  api.get('/users', async (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 80);
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) | 0));
    const offset = Math.min(100000, Math.max(0, Number(c.req.query('offset') ?? 0) | 0));
    const where: string[] = [];
    const args: unknown[] = [];
    if (q) {
      const code = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
      args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      const like = `$${args.length}`;
      const parts = [`u.name ILIKE ${like}`, `u.email ILIKE ${like}`];
      if (code.length === 6) {
        args.push(code);
        parts.push(`EXISTS (SELECT 1 FROM beach b WHERE b.owner_id = u.id AND b.code = $${args.length})`);
      }
      if (UUID.test(q)) {
        args.push(q);
        parts.push(`u.id = $${args.length}::uuid`);
      }
      where.push(`(${parts.join(' OR ')})`);
    }
    args.push(limit + 1, offset);
    const rows = await db.query<{
      id: string;
      name: string;
      email: string | null;
      provider: string;
      credit_cents: number;
      creator_credit_debt_cents: number;
      created_at: string;
      beaches: string;
      purchases: string;
    }>(
      `SELECT u.id, u.name, u.email, u.provider, u.credit_cents, u.creator_credit_debt_cents, u.created_at,
              (SELECT COUNT(*) FROM beach b WHERE b.owner_id = u.id) AS beaches,
              (SELECT COUNT(*) FROM purchases p WHERE p.user_id = u.id) AS purchases
         FROM users u
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY u.created_at DESC, u.id
        LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    return c.json({
      users: rows.slice(0, limit).map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        provider: u.provider,
        bucks: centsToBucks(Number(u.credit_cents)),
        debt: centsToBucks(Number(u.creator_credit_debt_cents)),
        beaches: Number(u.beaches),
        purchases: Number(u.purchases),
        createdAt: Number(u.created_at),
      })),
      more: rows.length > limit,
    });
  });

  api.get('/users/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) fail(404, 'no such user');
    const [u] = await db.query<{
      id: string;
      name: string;
      email: string | null;
      provider: string;
      credit_cents: number;
      creator_credit_debt_cents: number;
      created_at: string;
    }>('SELECT id, name, email, provider, credit_cents, creator_credit_debt_cents, created_at FROM users WHERE id = $1', [id]);
    if (!u) fail(404, 'no such user');
    const [beaches, ledgerRows, purchases, promos] = await Promise.all([
      db.query<{ id: string; code: string; name: string; home: boolean; on_shore: boolean }>(
        'SELECT id, code, name, home, on_shore FROM beach WHERE owner_id = $1 ORDER BY home DESC, created_at',
        [id],
      ),
      db.query<{
        id: string;
        kind: string;
        amount_cents: number;
        ref: string;
        created_at: string;
        product_id: string | null;
        traded: string | null;
        who: string | null;
      }>(
        `SELECT l.id, l.kind, l.amount_cents, l.ref, l.created_at,
                p.product_id,
                (SELECT SUM(t.quantity) FROM trade_ins t
                  WHERE l.kind = 'trade_in' AND t.user_id = l.user_id AND t.item_id = l.ref AND t.created_at = l.created_at) AS traded,
                u2.name AS who
           FROM credit_ledger l
           LEFT JOIN purchases p ON l.kind IN ('pack', 'pack_refund') AND l.ref = 'purchase:' || p.id::text
           LEFT JOIN users u2 ON l.kind = 'invite_bonus'
                             AND u2.id::text = substring(l.ref FROM '^invited(?:_by)?:(.*)$')
          WHERE l.user_id = $1
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT 200`,
        [id],
      ),
      db.query<{
        id: string;
        store: string;
        transaction_id: string;
        product_id: string;
        environment: string;
        purchased_at: string;
        granted_at: string;
        refunded_at: string | null;
        promo_code: string | null;
        bonus_bucks: number | null;
      }>(
        `SELECT p.id, p.store, p.transaction_id, p.product_id, p.environment, p.purchased_at, p.granted_at, p.refunded_at,
                a.code AS promo_code, a.bonus_bucks
           FROM purchases p
           LEFT JOIN account_promo_codes a ON a.purchase_id = p.id
          WHERE p.user_id = $1
          ORDER BY p.granted_at DESC, p.id DESC
          LIMIT 100`,
        [id],
      ),
      accountPromos(db, id, clock()),
    ]);
    return c.json({
      user: {
        id: u!.id,
        name: u!.name,
        email: u!.email,
        provider: u!.provider,
        bucks: centsToBucks(Number(u!.credit_cents)),
        debt: centsToBucks(Number(u!.creator_credit_debt_cents)),
        createdAt: Number(u!.created_at),
      },
      beaches: beaches.map((b) => ({ id: b.id, code: b.code, name: b.name, home: b.home, onShore: b.on_shore })),
      ledger: ledgerRows.map((r) => ({
        id: Number(r.id),
        kind: r.kind,
        bucks: Math.sign(Number(r.amount_cents)) * centsToBucks(Math.abs(Number(r.amount_cents))),
        what: ledgerLabel(r),
        ref: r.ref,
        at: Number(r.created_at),
      })),
      purchases: purchases.map((p) => {
        const prod = storeProductById(p.product_id);
        return {
          id: String(p.id),
          store: p.store,
          transactionId: p.transaction_id,
          productId: p.product_id,
          productName: prod?.name ?? p.product_id,
          bucks: prod ? bucksIn(prod) : 0,
          promoCode: p.promo_code,
          bonusBucks: Number(p.bonus_bucks ?? 0),
          environment: p.environment,
          purchasedAt: Number(p.purchased_at),
          grantedAt: Number(p.granted_at),
          refundedAt: p.refunded_at === null ? null : Number(p.refunded_at),
        };
      }),
      promos,
    });
  });

  // Make a correction to a user's ledger (+bb adds credit paying off debt
  // first; -bb debits balance with any remainder becoming debt) or issue a
  // bb refund.
  api.post('/users/:id/ledger', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) fail(404, 'no such user');
    const p = await body<{ bucks?: number; kind?: string; reason?: string }>(c);
    const bucks = Math.trunc(Number(p.bucks ?? NaN));
    if (!Number.isInteger(bucks) || bucks === 0 || Math.abs(bucks) > 100000) {
      fail(400, 'bucks must be a non-zero whole number between -100000 and 100000');
    }
    const kind = p.kind === undefined ? 'admin_adjustment' : p.kind;
    if (kind !== 'admin_adjustment' && kind !== 'admin_refund') fail(400, 'kind must be admin_adjustment or admin_refund');
    if (kind === 'admin_refund' && bucks < 0) fail(400, 'a bb refund must be a positive amount');
    const reason = String(p.reason ?? '').trim().slice(0, 200);
    if (!reason) fail(400, 'reason is required');

    const now = clock();
    const actor = c.get('actor');
    const result = await db.withTransaction(async (tx) => {
      const [before] = await tx.query<{ credit_cents: number; creator_credit_debt_cents: number }>(
        'SELECT credit_cents, creator_credit_debt_cents FROM users WHERE id = $1 FOR NO KEY UPDATE',
        [id],
      );
      if (!before) fail(404, 'no such user');
      if (bucks > 0) await creditBalance(tx, id, bucks * BUCK, kind, reason, now);
      else await clawBack(tx, id, Math.abs(bucks) * BUCK, kind, reason, now);
      const [after] = await tx.query<{ credit_cents: number; creator_credit_debt_cents: number }>(
        'SELECT credit_cents, creator_credit_debt_cents FROM users WHERE id = $1',
        [id],
      );
      const out = {
        before: { bucks: centsToBucks(Number(before!.credit_cents)), debt: centsToBucks(Number(before!.creator_credit_debt_cents)) },
        after: { bucks: centsToBucks(Number(after.credit_cents)), debt: centsToBucks(Number(after.creator_credit_debt_cents)) },
      };
      await audit(actor, kind === 'admin_refund' ? 'user.bb_refund' : 'user.ledger_adjustment', 'user', id, { bucks, kind, reason, ...out }, tx);
      return out;
    });
    return c.json({ user: { id, ...result.after }, bucks, kind, reason });
  });

  // Forgive some or all of a user's refund debt without minting extra balance.
  api.post('/users/:id/forgive-debt', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) fail(404, 'no such user');
    const p = await body<{ bucks?: number | null; reason?: string }>(c);
    const reason = String(p.reason ?? '').trim().slice(0, 200);
    if (!reason) fail(400, 'reason is required');
    const requested = p.bucks == null ? null : Math.trunc(Number(p.bucks));
    if (requested !== null && (!Number.isInteger(requested) || requested <= 0 || requested > 100000)) {
      fail(400, 'bucks must be a positive whole number');
    }
    const actor = c.get('actor');
    const result = await db.withTransaction(async (tx) => {
      const [before] = await tx.query<{ credit_cents: number; creator_credit_debt_cents: number }>(
        'SELECT credit_cents, creator_credit_debt_cents FROM users WHERE id = $1 FOR NO KEY UPDATE',
        [id],
      );
      if (!before) fail(404, 'no such user');
      const debtCents = Number(before!.creator_credit_debt_cents);
      if (debtCents <= 0) fail(409, 'user has no debt');
      const forgiveCents = requested === null ? debtCents : Math.min(debtCents, requested * BUCK);
      await tx.query('UPDATE users SET creator_credit_debt_cents = creator_credit_debt_cents - $2 WHERE id = $1', [id, forgiveCents]);
      const [after] = await tx.query<{ credit_cents: number; creator_credit_debt_cents: number }>(
        'SELECT credit_cents, creator_credit_debt_cents FROM users WHERE id = $1',
        [id],
      );
      const forgiven = centsToBucks(forgiveCents);
      const out = {
        forgiven,
        before: { bucks: centsToBucks(Number(before!.credit_cents)), debt: centsToBucks(debtCents) },
        after: { bucks: centsToBucks(Number(after.credit_cents)), debt: centsToBucks(Number(after.creator_credit_debt_cents)) },
      };
      await audit(actor, 'user.forgive_debt', 'user', id, { reason, ...out }, tx);
      return out;
    });
    return c.json({ user: { id, ...result.after }, forgiven: result.forgiven, reason });
  });

  // Issue a refund on a recorded real-money purchase: marks it refunded,
  // expires any granted items, reverses creator credit, and claws back the
  // pack's bb plus any promo bonus bb.
  api.post('/purchases/:id/refund', async (c) => {
    const id = c.req.param('id');
    if (!/^\d+$/.test(id)) fail(404, 'no such purchase');
    const p = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const reason = String(p.reason ?? '').trim().slice(0, 200);
    const now = clock();
    const actor = c.get('actor');
    const result = await db.withTransaction(async (tx) => {
      const [existing] = await tx.query<{ id: string; refunded_at: string | null }>(
        'SELECT id, refunded_at FROM purchases WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!existing) fail(404, 'no such purchase');
      if (existing!.refunded_at !== null) fail(409, 'that purchase is already refunded');
      const revoked = await revokePurchaseById(tx, id, now);
      if (!revoked) fail(409, 'that purchase is already refunded');
      const [u] = await tx.query<{ credit_cents: number; creator_credit_debt_cents: number }>(
        'SELECT credit_cents, creator_credit_debt_cents FROM users WHERE id = $1',
        [revoked!.user_id],
      );
      const user = {
        id: revoked!.user_id,
        bucks: centsToBucks(Number(u?.credit_cents ?? 0)),
        debt: centsToBucks(Number(u?.creator_credit_debt_cents ?? 0)),
      };
      await audit(
        actor,
        'purchase.refund',
        'purchase',
        String(revoked!.id),
        {
          userId: revoked!.user_id,
          store: revoked!.store,
          transactionId: revoked!.transaction_id,
          productId: revoked!.product_id,
          reason: reason || undefined,
          after: { bucks: user.bucks, debt: user.debt },
        },
        tx,
      );
      return { purchaseId: String(revoked!.id), refundedAt: now, user };
    });
    return c.json(result);
  });

  // ---- reports: notes players reported (docs/INBOX_NOTIFICATIONS.md, "Safety")
  api.get('/reports', async (c) => {
    const open = c.req.query('all') !== '1';
    const rows = await db.query<{
      id: string; note_id: string; body: string; hidden_at: string | null; reason: string; created_at: string;
      resolved_at: string | null; resolution: string | null; resolved_by: string | null;
      from_name: string | null; from_email: string | null; from_code: string | null; to_name: string; to_code: string | null;
      sender_reports: string;
    }>(
      `SELECT r.id, r.note_id, n.body, n.hidden_at, r.reason, r.created_at, r.resolved_at, r.resolution, r.resolved_by,
              f.name AS from_name, f.email AS from_email, fh.code AS from_code, t.name AS to_name, th.code AS to_code,
              (SELECT COUNT(*) FROM reports r2 JOIN notes n2 ON n2.id = r2.note_id WHERE n2.from_id = n.from_id) AS sender_reports
         FROM reports r
         JOIN notes n ON n.id = r.note_id
         LEFT JOIN users f ON f.id = n.from_id
         LEFT JOIN beach fh ON fh.id = n.from_id
         JOIN users t ON t.id = n.to_id
         LEFT JOIN beach th ON th.id = n.to_id
        WHERE ($1::boolean = false OR r.resolved_at IS NULL)
        ORDER BY r.created_at DESC LIMIT 200`,
      [open],
    );
    return c.json({
      reports: rows.map((r) => ({
        id: Number(r.id),
        noteId: Number(r.note_id),
        note: r.body,
        hidden: r.hidden_at !== null,
        reason: r.reason,
        at: Number(r.created_at),
        resolvedAt: r.resolved_at === null ? null : Number(r.resolved_at),
        resolution: r.resolution,
        resolvedBy: r.resolved_by,
        from: r.from_name === null ? null : { name: r.from_name, email: r.from_email, code: r.from_code },
        to: { name: r.to_name, code: r.to_code },
        senderReports: Number(r.sender_reports),
      })),
    });
  });

  // hide the note (the recipient's inbox then says it was removed) or dismiss
  // the report; either way every open report on that note is closed
  api.post('/reports/:id/resolve', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id)) fail(404, 'no such report');
    const { action } = (await c.req.json().catch(() => ({}))) as { action?: string };
    if (action !== 'hide' && action !== 'dismiss') fail(400, 'action is hide or dismiss');
    const rep = (await db.query<{ note_id: string }>('SELECT note_id FROM reports WHERE id = $1', [id]))[0];
    if (!rep) fail(404, 'no such report');
    const now = Date.now();
    const actor = c.get('actor');
    if (action === 'hide') await db.query('UPDATE notes SET hidden_at = $2 WHERE id = $1 AND hidden_at IS NULL', [rep!.note_id, now]);
    await db.query(
      `UPDATE reports SET resolved_at = $2, resolution = $3, resolved_by = $4 WHERE note_id = $1 AND resolved_at IS NULL`,
      [rep!.note_id, now, action === 'hide' ? 'hidden' : 'dismissed', actor],
    );
    await audit(actor, `report.${action}`, 'note', String(rep!.note_id), { report: id });
    return c.json({ id, resolution: action === 'hide' ? 'hidden' : 'dismissed' });
  });

  api.get('/audit', async (c) => {
    const rows = await db.query<{ actor: string; action: string; target_type: string; target_id: string; detail: unknown; created_at: string }>(
      'SELECT actor, action, target_type, target_id, detail, created_at FROM admin_audit ORDER BY created_at DESC, id DESC LIMIT 100',
    );
    return c.json({
      audit: rows.map((r) => ({
        actor: r.actor,
        action: r.action,
        target: `${r.target_type}:${r.target_id}`,
        detail: typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail,
        at: Number(r.created_at),
      })),
    });
  });

  app.route('/api', api);
  return app;
}
