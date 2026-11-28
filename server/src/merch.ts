// The merch store's orders (docs/MERCH_STORE.md), built from
// specs/tla/MerchOrders.tla. Mounted on the game API at /merch; the store
// site (store.beech.games, merchSite.ts) forwards its /api/* here.
//
// Each step of the model is one SQL statement whose WHERE carries its check:
//   Checkout   one transaction: the order and its lines, each beach print
//              snapshotted from a beach the shopper owns (the Stripe session
//              is made first, keyed by the order id)
//   Completed  UPDATE ... SET status='paid' WHERE status IN ('open','expired')
//              RETURNING: only the handler that gets the row kicks the send
//   Expired    UPDATE ... SET status='expired' WHERE status='open'
//   Refunded   UPDATE ... WHERE status IN (everything but canceled/refunded):
//              before sent → canceled, after → refunded
//   Claim      UPDATE ... SET status='sending', claim WHERE status='paid'
//   Draft      Printful POST /orders (keyed by external_id), print files from
//              the snapshot, never the beach as it is now
//   Mark       UPDATE ... SET status='sent' WHERE status='sending' AND claim
//   Confirm    Printful confirm, then confirmed_at
//   Recover    UPDATE ... SET status='paid' WHERE status='sending' AND stale
//   Ships      UPDATE ... SET status='shipped' WHERE status='sent'
// One case the model leaves out: a worker that dies between Mark and
// Confirm. The sweep confirms orders still 'sent' and unconfirmed (a refund
// meanwhile makes them 'refunded', so they are left alone).
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { timingSafeEqual } from 'node:crypto';

import { hashToken } from './auth.js';
import { toBytes, type Db } from './db.js';
import { MERCH, PRODUCTS, isAvailable, priceCart, priceTable, printItems, productById, type Availability, type Choice } from './merchCatalog.js';
import { beachPrintPng, type PrintCut } from './merchPrint.js';
import {
  createCheckoutSession,
  printfulConfirm,
  printfulDraft,
  retrieveCheckoutSession,
  verifyStripeSignature,
  type MerchConfig,
  type Recipient,
  type StripeSession,
} from './merchProviders.js';
import { logEvent } from './observability.js';
import { PIER_SHOWN, SECTIONS_OF } from './shore.js';
import { verifyGoogleOidc } from './store.js';

export type MerchStatus = 'open' | 'expired' | 'paid' | 'sending' | 'sent' | 'shipped' | 'canceled' | 'refunded';

export interface MerchDeps {
  cfg?: MerchConfig;
  now: () => number;
  /** tests: run the send in line instead of in the background */
  awaitSend?: boolean;
  /**
   * Cloud Scheduler's merch tick (docs/MERCH_STORE.md): who may call
   * POST /merch/tick. Unset: the endpoint 404s and server.ts ticks the
   * sweep itself with its in-process timer.
   */
  tick?: { audience: string; email: string };
}

interface OrderRow {
  id: string;
  status: MerchStatus;
  stripe_session: string;
  payment_intent: string | null;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number | null;
  email: string | null;
  recipient: Recipient | null;
  claim: string | null;
  tracking: { carrier?: string; number?: string; url?: string } | null;
  created_at: string;
}
interface LineRow {
  id: string;
  product: string;
  label: string;
  choice: Choice;
  parts: Record<string, Choice> | null;
  quantity: number;
  unit_cents: number;
  beach_name: string | null;
  print_key: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: 400 | 401 | 403 | 404 | 409 | 503, message: string): never => {
  throw new HTTPException(status, { message });
};
const randomKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The shopper behind a shore token (docs/SHORE_SITE.md, "Signing in on the shore"), or null. */
async function shoreUser(db: Db, c: Context, now: number): Promise<{ id: string; name: string } | null> {
  const m = /^Bearer\s+(\S+)$/.exec(c.req.header('Authorization') ?? '');
  if (!m) return null;
  const [row] = await db.query<{ id: string; name: string }>(
    `SELECT u.id, u.name FROM item_submission_sessions i JOIN sessions s ON s.token_hash = i.session_hash
       JOIN users u ON u.id = s.user_id WHERE i.token_hash = $1 AND i.expires_at > $2 AND s.expires_at > $2`,
    [await hashToken(m[1]), now],
    'merch.shore_user',
  );
  return row ?? null;
}

/** Stripe's shipping details → Printful's recipient (newer API versions nest them under collected_information). */
export function recipientOf(s: StripeSession): Recipient | null {
  const ship = s.collected_information?.shipping_details ?? s.shipping_details;
  const a = ship?.address;
  if (!ship?.name || !a?.line1 || !a.city || !a.country || !a.postal_code) return null;
  return {
    name: ship.name,
    address1: a.line1,
    ...(a.line2 ? { address2: a.line2 } : {}),
    city: a.city,
    ...(a.state ? { state_code: a.state } : {}),
    country_code: a.country,
    zip: a.postal_code,
    ...(s.customer_details?.email ? { email: s.customer_details.email } : {}),
    ...(s.customer_details?.phone ? { phone: s.customer_details.phone } : {}),
  };
}

export function createMerch(db: Db, deps: MerchDeps) {
  const { cfg, now } = deps;
  const avail: Availability = { sunglassesVariant: cfg?.sunglassesVariant ?? null };
  const storeUrl = cfg?.storeUrl ?? 'https://store.beech.games';
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    logEvent('merch_error', { message: err.message }, 'ERROR');
    return c.json({ error: 'something went wrong' }, 500);
  });

  // ------------------------------------------------------------ the catalog
  app.get('/catalog', (c) =>
    c.json({
      open: !!cfg,
      shipping: { cents: MERCH.shippingCents, freeFromCents: MERCH.freeShippingFromCents, countries: MERCH.countries },
      atCostMarginCents: MERCH.atCostMarginCents,
      products: PRODUCTS.map((p) => ({
        id: p.id,
        name: p.name,
        blurb: p.blurb,
        section: p.section,
        kind: p.kind,
        colors: p.colors,
        sizes: p.sizes,
        ...priceTable(p),
        /** with the buyer's beach: which cut of it prints */
        ownCut: p.own ? p.own.prints.map((x) => ('beach' in x.art ? x.art.beach : null)).find(Boolean) ?? null : null,
        parts: p.parts ?? null,
        available: isAvailable(p, avail),
      })),
    }),
  );

  // ---------------------------------------------- your beaches, for a print
  const ownBeaches = (userId: string) =>
    db.query<{ id: string; name: string; code: string; location: string | null; sand: unknown; pier: boolean; sections: string | null; updated_at: string | null }>(
      `SELECT b.id, b.name, b.code, b.location, b.sand, ${PIER_SHOWN} AS pier, ${SECTIONS_OF} AS sections, b.updated_at
         FROM beach b WHERE b.owner_id = $1 AND b.sand IS NOT NULL ORDER BY b.home DESC, b.created_at`,
      [userId],
      'merch.own_beaches',
    );
  app.get('/my-beaches', async (c) => {
    const me = await shoreUser(db, c, now());
    if (!me) fail(401, 'Sign in to print your beach.');
    const rows = await ownBeaches(me!.id);
    return c.json({ user: { name: me!.name }, beaches: rows.map((b) => ({ id: b.id, name: b.name || `${me!.name}’s beach`, code: b.code })) });
  });
  // what a print of one of their beaches looks like (the square or the flat cut, muted, small)
  app.get('/beach-preview/:id', async (c) => {
    const me = await shoreUser(db, c, now());
    if (!me) fail(401, 'Sign in to print your beach.');
    const b = (await ownBeaches(me!.id)).find((r) => r.id === c.req.param('id'));
    if (!b) fail(404, 'not your beach');
    const cut: PrintCut = c.req.query('cut') === 'flat' ? 'flat' : 'square';
    const png = beachPrintPng(toBytes(b!.sand), { location: b!.location, pier: !!b!.pier, sections: b!.sections?.split(',') ?? [] }, cut, cut === 'flat' ? 0.25 : 0.4);
    return c.body(new Uint8Array(png), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' });
  });

  // ------------------------------------------------------------ checkout
  app.post('/checkout', async (c) => {
    if (!cfg) fail(503, 'The store isn’t open yet.');
    const body = (await c.req.json().catch(() => ({}))) as { lines?: unknown; email?: unknown };
    const priced = priceCart(body.lines, avail);
    if (!priced.ok) return fail(400, priced.error);
    const beachIds = [...new Set(priced.lines.flatMap((l) => (l.beachId ? [l.beachId] : [])))];
    let me: { id: string; name: string } | null = null;
    if (beachIds.length) {
      me = await shoreUser(db, c, now());
      if (!me) fail(401, 'Sign in to print your beach.');
      const mine = new Set((await ownBeaches(me!.id)).map((b) => b.id));
      if (beachIds.some((id) => !mine.has(id))) fail(403, 'You can only print your own beaches.');
    } else {
      me = await shoreUser(db, c, now());
    }
    const email = typeof body.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ? body.email : undefined;
    const id = crypto.randomUUID();
    const session = await createCheckoutSession(cfg!, {
      id,
      email,
      shippingCents: priced.shippingCents,
      lines: priced.lines.map((l) => ({ name: l.name, description: [l.label, l.beachId ? 'your beach' : ''].filter(Boolean).join(' · '), unitCents: l.unitCents, quantity: l.quantity })),
    });
    // Checkout (one transaction): the order, its lines, and each beach print's
    // snapshot, read from a beach the shopper still owns
    await db.withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO merch_orders (id, status, user_id, stripe_session, subtotal_cents, shipping_cents, email, created_at)
         VALUES ($1, 'open', $2, $3, $4, $5, $6, $7)`,
        [id, me?.id ?? null, session.id, priced.subtotalCents, priced.shippingCents, email ?? null, now()],
        'merch.checkout',
      );
      for (const l of priced.lines) {
        const args = [id, l.product, l.label, JSON.stringify(l.choice), l.parts ? JSON.stringify(l.parts) : null, l.quantity, l.unitCents];
        if (!l.beachId) {
          await tx.query(
            `INSERT INTO merch_lines (order_id, product, label, choice, parts, quantity, unit_cents) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            args,
            'merch.checkout_line',
          );
          continue;
        }
        const got = await tx.query(
          `INSERT INTO merch_lines (order_id, product, label, choice, parts, quantity, unit_cents, beach_id, beach_name, design, design_location, design_pier, design_sections, print_key)
           SELECT $1, $2, $3, $4, $5, $6, $7, b.id, b.name, b.sand, b.location, ${PIER_SHOWN}, ${SECTIONS_OF}, $10
             FROM beach b WHERE b.id = $8 AND b.owner_id = $9 AND b.sand IS NOT NULL RETURNING id`,
          [...args, l.beachId, me!.id, randomKey()],
          'merch.checkout_beach',
        );
        if (!got.length) fail(409, 'That beach isn’t yours any more.');
      }
    });
    logEvent('merch_checkout', { order: id, lines: priced.lines.length, cents: priced.subtotalCents, beach_prints: beachIds.length });
    return c.json({ id, url: session.url });
  });

  // ---------------------------------------------- Stripe: paid, expired, refunded
  /** Completed (one statement): the handler that gets the row sends the order on. */
  async function markPaid(s: StripeSession, via: 'hook' | 'page'): Promise<boolean> {
    const id = s.metadata?.order_id ?? s.client_reference_id ?? '';
    if (!UUID.test(id) || s.payment_status !== 'paid') return false;
    const rows = await db.query<{ id: string }>(
      `UPDATE merch_orders SET status = 'paid', paid_at = $3, payment_intent = $4, total_cents = $5, tax_cents = $6,
              email = COALESCE($7, email), recipient = $8
        WHERE id = $1 AND stripe_session = $2 AND status IN ('open', 'expired') RETURNING id`,
      [id, s.id, now(), s.payment_intent ?? null, s.amount_total ?? null, s.total_details?.amount_tax ?? null, s.customer_details?.email ?? null, JSON.stringify(recipientOf(s))],
      'merch.paid',
    );
    if (!rows.length) return false;
    logEvent('merch_paid', { order: id, via, cents: s.amount_total ?? null });
    const go = send(id).catch((e) => logEvent('merch_send_error', { order: id, message: (e as Error).message }, 'WARNING'));
    if (deps.awaitSend) await go;
    return true;
  }

  async function markExpired(s: StripeSession) {
    const id = s.metadata?.order_id ?? s.client_reference_id ?? '';
    if (!UUID.test(id)) return;
    await db.query(`UPDATE merch_orders SET status = 'expired' WHERE id = $1 AND stripe_session = $2 AND status = 'open'`, [id, s.id], 'merch.expired');
  }

  /** Refunded (one statement): before it was sent it's canceled and never printed; after, it's a refund after production. */
  async function markRefunded(orderId: string) {
    const [r] = await db.query<{ status: MerchStatus }>(
      `UPDATE merch_orders SET status = CASE WHEN status IN ('sent', 'shipped') THEN 'refunded' ELSE 'canceled' END, refunded_at = $2
        WHERE id = $1 AND status NOT IN ('canceled', 'refunded') RETURNING status`,
      [orderId, now()],
      'merch.refunded',
    );
    if (r) logEvent('merch_refunded', { order: orderId, status: r.status }, r.status === 'refunded' ? 'WARNING' : 'INFO');
  }

  async function orderForPaymentIntent(pi: string): Promise<string | null> {
    const [r] = await db.query<{ id: string }>('SELECT id FROM merch_orders WHERE payment_intent = $1', [pi], 'merch.by_intent');
    if (r) return r.id;
    // the refund came before "completed": the payment intent carries our id
    const f = cfg!.fetch ?? fetch;
    const res = await f(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(pi)}`, { headers: { Authorization: `Bearer ${cfg!.stripeSecretKey}` } });
    const out = (await res.json().catch(() => ({}))) as { metadata?: { order_id?: string } };
    return res.ok && UUID.test(out.metadata?.order_id ?? '') ? out.metadata!.order_id! : null;
  }

  app.post('/stripe-webhook', async (c) => {
    if (!cfg) fail(404, 'not set up');
    const raw = await c.req.text();
    if (!verifyStripeSignature(raw, c.req.header('Stripe-Signature'), cfg!.stripeWebhookSecret, now())) {
      logEvent('merch_stripe_webhook', { outcome: 'bad_signature' }, 'WARNING');
      return c.json({ error: 'bad signature' }, 400);
    }
    const ev = JSON.parse(raw) as { type: string; data: { object: Record<string, unknown> } };
    const obj = ev.data?.object ?? {};
    switch (ev.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await markPaid(obj as unknown as StripeSession, 'hook');
        break;
      case 'checkout.session.expired':
        await markExpired(obj as unknown as StripeSession);
        break;
      case 'charge.refunded': {
        // a partial refund (one item, or a goodwill credit) leaves the order alone
        if (obj.refunded !== true || typeof obj.payment_intent !== 'string') break;
        const id = await orderForPaymentIntent(obj.payment_intent);
        if (id) await markRefunded(id);
        else logEvent('merch_stripe_webhook', { type: ev.type, outcome: 'no_order' }, 'WARNING');
        break;
      }
    }
    logEvent('merch_stripe_webhook', { type: ev.type });
    return c.json({ received: true });
  });

  // ---------------------------------------------- the order page (and the return from Stripe)
  app.get('/orders/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) fail(404, 'no such order');
    let [o] = await db.query<OrderRow>('SELECT * FROM merch_orders WHERE id = $1', [id], 'merch.order');
    if (!o) fail(404, 'no such order');
    // back from Stripe before its webhook: ask Stripe (Completed, h = page)
    if (cfg && (o.status === 'open' || o.status === 'expired')) {
      const s = await retrieveCheckoutSession(cfg, o.stripe_session).catch(() => null);
      if (s && (await markPaid(s, 'page'))) [o] = await db.query<OrderRow>('SELECT * FROM merch_orders WHERE id = $1', [id], 'merch.order');
    }
    const lines = await db.query<LineRow>('SELECT * FROM merch_lines WHERE order_id = $1 ORDER BY id', [id], 'merch.order_lines');
    return c.json({
      id: o.id,
      status: o.status,
      createdAt: Number(o.created_at),
      subtotalCents: o.subtotal_cents,
      shippingCents: o.shipping_cents,
      totalCents: o.total_cents,
      shipTo: o.recipient ? { name: o.recipient.name, city: o.recipient.city, country: o.recipient.country_code } : null,
      tracking: o.tracking,
      lines: lines.map((l) => ({
        product: l.product,
        name: productById(l.product)?.name ?? l.product,
        beach: l.print_key ? l.beach_name || 'your beach' : null,
        label: l.label,
        quantity: l.quantity,
        unitCents: l.unit_cents,
      })),
    });
  });

  // ---------------------------------------------- print files (Printful fetches these)
  const printCache = new Map<string, Buffer>();
  app.get('/print/:key', async (c) => {
    const key = c.req.param('key').replace(/\.png$/, '');
    if (!/^[0-9a-f]{32}$/.test(key)) fail(404, 'not found');
    let png = printCache.get(key);
    if (!png) {
      const [l] = await db.query<{ product: string; design: unknown; design_location: string | null; design_pier: boolean | null; design_sections: string | null }>(
        'SELECT product, design, design_location, design_pier, design_sections FROM merch_lines WHERE print_key = $1 AND design IS NOT NULL',
        [key],
        'merch.print',
      );
      if (!l) fail(404, 'not found');
      const own = productById(l!.product)?.own?.prints.find((x) => 'beach' in x.art)?.art;
      const cut: PrintCut = own && 'beach' in own ? own.beach : 'flat';
      png = beachPrintPng(toBytes(l!.design), { location: l!.design_location, pier: !!l!.design_pier, sections: l!.design_sections?.split(',') ?? [] }, cut);
      if (printCache.size > 50) printCache.delete(printCache.keys().next().value!);
      printCache.set(key, png);
    }
    return c.body(new Uint8Array(png), 200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, immutable' });
  });

  // ---------------------------------------------- the send to Printful
  /** Claim → Draft → Mark → Confirm for one paid order. Returns what happened. */
  async function send(id: string): Promise<'sent' | 'not_paid' | 'lost_claim'> {
    if (!cfg) return 'not_paid';
    const token = crypto.randomUUID();
    const [o] = await db.query<OrderRow>(
      `UPDATE merch_orders SET status = 'sending', claim = $2, claimed_at = $3 WHERE id = $1 AND status = 'paid' RETURNING *`,
      [id, token, now()],
      'merch.claim',
    );
    if (!o) return 'not_paid';
    if (!o.recipient) {
      // Stripe always collects the address for these sessions; this is a bug, not a retry
      logEvent('merch_send_error', { order: id, message: 'no shipping address' }, 'ERROR');
      return 'lost_claim';
    }
    const lines = await db.query<LineRow>('SELECT * FROM merch_lines WHERE order_id = $1 ORDER BY id', [id], 'merch.send_lines');
    const art = (file: string) => `${storeUrl}/merch-art/${file}`;
    const items = lines.flatMap((l) => printItems({ product: l.product, quantity: l.quantity, unitCents: l.unit_cents, choice: l.choice, parts: l.parts }, avail, art, l.print_key ? `${storeUrl}/api/print/${l.print_key}.png` : undefined));
    const pf = await printfulDraft(cfg, id, o.recipient, items, o.shipping_cents);
    // Mark: only while this claim still holds (a refund or the sweep may have taken it)
    const marked = await db.query(
      `UPDATE merch_orders SET status = 'sent', sent_at = $3, printful_id = $4 WHERE id = $1 AND status = 'sending' AND claim = $2 RETURNING id`,
      [id, token, now(), pf.id],
      'merch.mark',
    );
    if (!marked.length) {
      logEvent('merch_send', { order: id, outcome: 'lost_claim' }, 'WARNING');
      return 'lost_claim';
    }
    await confirm(id);
    return 'sent';
  }

  async function confirm(id: string) {
    if (cfg!.printfulDraftsOnly) {
      logEvent('merch_send', { order: id, outcome: 'draft_only' });
      return;
    }
    await printfulConfirm(cfg!, id);
    await db.query(`UPDATE merch_orders SET confirmed_at = $2 WHERE id = $1 AND status IN ('sent', 'shipped')`, [id, now()], 'merch.confirmed');
    logEvent('merch_send', { order: id, outcome: 'confirmed' });
  }

  /** The sweep (a timer in server.ts): stale claims back, unconfirmed sends confirmed, paid orders sent. */
  async function tick(): Promise<{ recovered: number; confirmed: number; sent: number }> {
    if (!cfg) return { recovered: 0, confirmed: 0, sent: 0 };
    const t = now();
    const recovered = await db.query(
      `UPDATE merch_orders SET status = 'paid', claim = NULL WHERE status = 'sending' AND claimed_at < $1 RETURNING id`,
      [t - MERCH.staleClaimMs],
      'merch.recover',
    );
    let confirmed = 0;
    if (!cfg.printfulDraftsOnly) {
      const stuck = await db.query<{ id: string }>(
        `SELECT id FROM merch_orders WHERE status = 'sent' AND confirmed_at IS NULL AND sent_at < $1 LIMIT 20`,
        [t - MERCH.staleClaimMs],
        'merch.unconfirmed',
      );
      for (const r of stuck) {
        try {
          await confirm(r.id);
          confirmed++;
        } catch (e) {
          logEvent('merch_send_error', { order: r.id, message: (e as Error).message }, 'WARNING');
        }
      }
    }
    let sent = 0;
    const paid = await db.query<{ id: string }>(`SELECT id FROM merch_orders WHERE status = 'paid' ORDER BY paid_at LIMIT 20`, [], 'merch.paid_queue');
    for (const r of paid) {
      try {
        if ((await send(r.id)) === 'sent') sent++;
      } catch (e) {
        logEvent('merch_send_error', { order: r.id, message: (e as Error).message }, 'WARNING');
      }
    }
    return { recovered: recovered.length, confirmed, sent };
  }

  // POST /tick: Cloud Scheduler, once a minute, with an OIDC token
  app.post('/tick', async (c) => {
    if (!deps.tick) fail(404, 'not set up');
    try {
      await verifyGoogleOidc(c.req.header('Authorization'), deps.tick!);
    } catch {
      fail(401, 'not allowed');
    }
    let r: Awaited<ReturnType<typeof tick>>;
    try {
      r = await tick();
    } catch (e) {
      // the same event the server's own timer logs
      logEvent('merch_tick_error', { message: (e as Error).message }, 'WARNING');
      throw e;
    }
    if (r.recovered || r.confirmed || r.sent) logEvent('merch_tick', { ...r });
    return c.json(r);
  });

  // ---------------------------------------------- Printful: shipped
  app.post('/printful-webhook', async (c) => {
    if (!cfg) fail(404, 'not set up');
    const given = Buffer.from(c.req.query('s') ?? '');
    const want = Buffer.from(cfg!.printfulWebhookSecret);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return c.json({ error: 'not found' }, 404);
    const ev = (await c.req.json().catch(() => ({}))) as {
      type?: string;
      data?: { order?: { external_id?: string }; shipment?: { carrier?: string; tracking_number?: string; tracking_url?: string }; reason?: string };
    };
    const ext = ev.data?.order?.external_id ?? '';
    if (!/^[0-9a-f]{32}$/.test(ext)) return c.json({ received: true });
    const id = `${ext.slice(0, 8)}-${ext.slice(8, 12)}-${ext.slice(12, 16)}-${ext.slice(16, 20)}-${ext.slice(20)}`;
    if (ev.type === 'package_shipped') {
      const s = ev.data?.shipment ?? {};
      await db.query(
        `UPDATE merch_orders SET status = 'shipped', shipped_at = $2, tracking = $3 WHERE id = $1 AND status = 'sent'`,
        [id, now(), JSON.stringify({ carrier: s.carrier ?? null, number: s.tracking_number ?? null, url: s.tracking_url ?? null })],
        'merch.shipped',
      );
    } else if (ev.type === 'order_failed' || ev.type === 'order_canceled' || ev.type === 'order_put_hold') {
      // a person sorts these out in Printful's dashboard (docs/MERCH_STORE.md, "When something goes wrong")
      logEvent('merch_printful_problem', { order: id, type: ev.type, reason: ev.data?.reason ?? null }, 'ERROR');
    }
    logEvent('merch_printful_webhook', { type: ev.type ?? null });
    return c.json({ received: true });
  });

  return { app, tick, send, markPaid, markRefunded };
}

export type Merch = ReturnType<typeof createMerch>;
