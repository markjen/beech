# Web payments: buy store items on the web with Xsolla

The shop sells through Apple and Google today, and the web shop just
points people at the apps (docs/PRICING.md: "No web payments"). This plan
adds real web checkout for the same store items, through a merchant of
record, so a player on beech.markjen.com can pay with a card and get the
item in their bag — no app install, no card details ever reaching us.

**Recommendation: Xsolla Pay Station.** The comparison and the numbers
are in "Xsolla vs FastSpring" below. The short version: beech's items cost
$0.99–$9.99, and FastSpring's $0.95 fixed fee per transaction eats the
whole price on most of the catalog; Xsolla charges a percentage only.
Xsolla is also the game-native option (a virtual-items catalog that maps
1:1 onto our product list), while FastSpring is built for software
licenses and subscriptions, which beech doesn't have.

## How the shop works today

- **Products** (`server/src/products.ts`): 10 consumables, $0.99–$9.99
  US. The server prices from this list; the stores set their own
  per-country prices. Each product grants items (`grants`) to the bag.
- **Native purchase** (`POST /store/purchase`): the app pays through
  StoreKit 2 or Google Play Billing, then hands the proof to the server.
  The server verifies it (Apple JWS certificate chain in
  `server/src/store.ts`; Google Play Developer API lookup), then — in one
  SQL statement — records the transaction in `purchases` and grants the
  items in `inventory`. `purchases` is `UNIQUE (store, transaction_id)`,
  so a receipt can't grant twice. Refunds arrive as signed store
  notifications and expire the granted inventory (`refund()` in
  `server/src/app.ts`).
- **Web today** (`src/ui/shop.ts`, `src/net/shop.ts`): the shop shows the
  same products, but the buy button opens the App Store / Play link
  ("Get these in the beech app"). The only thing a web player can
  actually buy is with account credit (`POST /api/store/credit-purchase`,
  docs/GIFT_CARDS_PROMOS.md) — credit that only comes from gift cards,
  which only Mark can issue. There is no way to pay on the web.
- **Apple and Google take 15%** (Small Business Program / the first $1M
  a year on Google Play) or 30%. On a $2.99 beach that's about $2.54 to
  us at 15%.

## What web checkout changes

One new way to pay, for the web client only:

- A web player taps Buy in the shop, pays by card (or a local payment
  method) in Xsolla's checkout, and the item lands in their bag on every
  device — the same grant the stores give, through the same `purchases`
  + `inventory` rows.
- A web purchase **grants the item directly**, like a store purchase. It
  does **not** add account credit. Credit stays gift-card-only, which
  keeps one fulfillment path and keeps the gift-card rules
  (docs/GIFT_CARDS_PROMOS.md) untouched. Selling gift cards on the web
  is phase 2 (below), not this change.
- Promo codes work on web checkout, validated and priced server-side
  exactly as they are for credit purchases. The price always comes from
  `server/src/products.ts`; the client never supplies a price.
- The native apps don't change at all: they keep StoreKit / Play
  Billing, and they must not link or steer players to web checkout
  (App Store anti-steering). Web checkout lives only in the browser
  client. The US link-out rules were in flux in late 2026 — re-check the
  current App Store guidelines when this is implemented, and keep the
  native buy flow exactly as it is regardless.

## Xsolla vs FastSpring

Both are merchants of record: they are the legal seller, take the
payment, handle tax/VAT/GST and fraud, and pay us out. Neither needs us
to touch card details (PCI SAQ A scope for us either way). The difference
is fit and fees.

| | Xsolla Pay Station | FastSpring |
|---|---|---|
| Built for | Games: virtual items, game keys, player accounts | Software, SaaS, digital goods: licenses, subscriptions, B2B invoicing |
| Merchant of record | Yes, 200+ geographies | Yes, 200+ jurisdictions |
| Payment methods | 1,000+ in 130+ currencies | Cards, PayPal, Apple Pay, Google Pay; local methods vary |
| Fee (headline) | **5% of transactions** + "cost of channel" (see below) | No published rate; custom quote |
| Fee (reported benchmark) | All-in estimated 7–10% by independent reviewers (reported, not Xsolla-published) | **~5.9% + $0.95 per transaction** (consistent third-party benchmark; not FastSpring-published) |
| Monthly fee / minimum | None, per Xsolla's SDK page (as reported Oct 2026) | None (revenue-share only) |
| Chargebacks | $7–15 per card chargeback, $10 PayPal (third-party report, unverified) | FastSpring handles disputes; fee kept on refunds (see below) |
| Tax / VAT | Xsolla calculates, collects, remits | FastSpring calculates, collects, remits |
| Virtual items | Native catalog (Store API): SKUs with prices, promo redemption, inventory reservation | No game catalog; products are generic dashboard items |
| Checkout | Hosted Pay Station page, or embedded Headless Checkout SDK | Store Builder Library (popup / embedded) or hosted checkout session |
| Webhooks | SHA-1 of (raw JSON body + secret key) vs `Authorization` header | HMAC-SHA256 of raw body, base64, `X-FS-Signature` header |
| Sandbox | Sandbox mode on the token request (`mode: "sandbox"`), test cards in Xsolla docs | Separate test store (`app.test.fastspring.com`), test cards |
| Refunds | Refund webhook; our side revokes the grant (same as store refunds) | Return/refund webhooks; **FastSpring keeps its fee on refunds** |
| Payouts | Monthly, on contract terms; minimum per agreement (verify at signup) | Per contract; FX markup 2.5% on currency conversion (per FastSpring docs as cited by a third party — verify) |

Sources: Xsolla's own pages (xsolla.com, developers.xsolla.com) for the
5% headline, the 1,000+ methods and the MoR model; FastSpring's
developer docs (developer.fastspring.com) for the webhook signature
scheme; the 5.9% + $0.95 figure and the Xsolla all-in estimates are
third-party benchmarks, not vendor-published rates — treat them as
estimates until Mark has a written quote. **Get the all-in rate in
writing from Xsolla before signing**: their product pages say "5% +
cost of channel" and nowhere on their site defines what a channel
costs, so the true rate isn't knowable from public pages.

### Why the fixed fee decides it

Beech's prices are $0.99–$9.99, so a per-transaction fixed fee is the
whole ballgame. Using the reported benchmarks:

| Product | Price | Xsolla at 5% | Xsolla at 10% all-in | FastSpring 5.9% + $0.95 | Apple/Google at 15% |
|---|---|---|---|---|---|
| Parasol / deckchair | $0.99 | $0.05 (keep $0.94) | $0.10 (keep $0.89) | **$1.01 (more than the price)** | $0.15 (keep $0.84) |
| Extra beach | $2.99 | $0.15 (keep $2.84) | $0.30 (keep $2.69) | $1.13 (keep $1.86) | $0.45 (keep $2.54) |
| Founder's pack | $9.99 | $0.50 (keep $9.49) | $1.00 (keep $8.99) | $1.54 (keep $8.45) | $1.50 (keep $8.49) |

FastSpring loses money on the $0.99 items and takes 38% of a $2.99
beach. Xsolla beats even Apple's 15% tier at every price point, at
both the 5% headline and the 10% all-in estimate. FastSpring's
strengths — subscriptions, B2B invoicing, license delivery — are
things beech doesn't sell (docs/PRICING.md: no subscriptions).

### What switching to the runner-up would cost later

Not much, by design. The grant and refund plumbing (`purchases`,
`inventory`, `refund()`) is provider-agnostic: a purchase is a
`(store, transaction_id)` row and a grant, whoever took the money.
Switching from Xsolla to FastSpring later means a new token/session
endpoint, a new webhook handler, a new dashboard catalog, and a
re-run of the test matrix — roughly a day of focused work, no data
migration (past purchases stay valid; their `store` value just says
`xsolla`). The one thing that doesn't transfer is the Xsolla catalog
and any player payment methods saved with Xsolla.

Stripe was considered and not recommended: with Stripe we are the
merchant of record, so tax/VAT filings, PCI scope and chargeback
liability all land on us — the whole point of this change is to
offload exactly that. Revisit only if web volume ever justifies
running our own tax operation.

## Architecture

### Purchase flow

1. Web player taps Buy on a product in the shop (`src/ui/shop.ts`).
   Web only — `shopMode()` is `'web'`.
2. Client calls `POST /api/store/web-checkout { productId, promoCode? }`
   with the session. The server prices from `products.ts`, validates
   the promo the same way `POST /api/store/quote` does, and creates a
   `web_orders` row (status `created`, 24 h expiry). It then calls
   Xsolla to create a payment token for that order: amount, currency,
   the product SKU, and our user id + web order id in custom
   parameters. The server returns the Pay Station URL (v1: hosted
   redirect; embedded SDK later if the redirect feels clunky).
3. The player pays in Pay Station and is returned to
   `https://beech.markjen.com/shop?web_order=<id>`. The client polls
   `GET /api/store/web-orders/:id` until the order is `paid`, then
   shows "added to your bag" and refreshes the bag and beaches — the
   same `bought()` refresh the native flow uses. Pending orders are
   re-checked when the shop opens, mirroring `retryPending()`.
4. Xsolla calls our webhook. On `payment` / `order_paid` the server
   verifies the signature, looks up the web order, checks the paid
   amount against the server-computed price, and grants atomically
   (below). On `refund` / `order_canceled` it calls the existing
   `refund()` — the granted items expire, exactly as a store refund
   does today.
5. Xsolla also calls `user_validation` before taking payment: the
   server confirms the account in the token's custom parameters exists
   and matches the web order, and answers 200. An unknown user gets a
   4xx and the payment never starts.

### Data model (migration 13)

New table `web_orders` — one row per checkout attempt, so a payment
can always be traced back to a player, a product and a price:

```sql
CREATE TABLE web_orders (
  id TEXT PRIMARY KEY,              -- our order id (UUID), sent to Xsolla as the external id
  user_id TEXT NOT NULL REFERENCES users (id),
  product_id TEXT NOT NULL,
  promo_code TEXT,                  -- NULL when no promo was used
  amount_cents INTEGER NOT NULL,    -- what we charged: server price after promo
  currency TEXT NOT NULL DEFAULT 'USD',
  provider TEXT NOT NULL DEFAULT 'xsolla',
  provider_order_id TEXT UNIQUE,    -- Xsolla's order id, filled in on payment
  status TEXT NOT NULL CHECK (status IN ('created', 'paid', 'refunded', 'canceled', 'expired')),
  created_at BIGINT NOT NULL,
  paid_at BIGINT
);
CREATE INDEX web_orders_user ON web_orders (user_id, created_at DESC);
```

Fulfillment reuses the existing tables — no new grant path:

- The grant writes a row to `purchases` with `store = 'xsolla'` and
  `transaction_id` = Xsolla's transaction id, and the items to
  `inventory` with `source = 'shop'` and `purchase_id` pointing at it.
  The `UNIQUE (store, transaction_id)` constraint is the idempotency
  guard: Xsolla retries webhooks, and a retried `payment` event
  inserts nothing the second time (the `ON CONFLICT DO NOTHING`
  pattern already in `POST /store/purchase`).
- The web order is marked `paid` in the same statement as the grant,
  so an order can't be paid without granting, or granted without
  being marked paid.

### New endpoints

| Endpoint | Auth | What it does |
|---|---|---|
| `POST /api/store/web-checkout { productId, promoCode? }` | session, rate-limited (same 30/min limiter as credit purchases) | Prices the product server-side, validates the promo, creates the `web_orders` row, creates the Xsolla payment token, returns the Pay Station URL. 402 if the promo is invalid for this product; 404 for an unknown product. |
| `POST /api/store/xsolla/webhook` | signature, not session (below) | Dispatches on the event: `user_validation` → confirm the account; `payment` / `order_paid` → verify amount, grant atomically, mark paid; `refund` / `order_canceled` → `refund()`. Always answers 200 on a verified event, even a duplicate (idempotent). |
| `GET /api/store/web-orders/:id` | session (owner only) | Status of one of your orders, for the return-page poll. 404 for someone else's order. |

### The promo wrinkle (decide at implementation)

Credit purchases claim the promo atomically with the payment, because
payment and grant happen in one statement. Web checkout splits them:
the player may pay minutes or hours after the token is created, and
the promo could be exhausted or expired in between. Recommended
approach: **reserve at checkout creation, claim at grant.** Creating
the web order inserts a `promo_uses` row marked pending against that
web order id (with the same expiry as the token); the webhook grant
finalizes it in the same statement as the grant, and a
refund/cancel/expiry releases it. If that turns out to be too much
machinery for v1, the fallback is to validate at creation and
re-validate at grant, and grant anyway if the promo died in between
(the player already paid the discounted amount) with an admin-audit
row — but do not silently charge full price for a discounted checkout.

### Security considerations

- **Webhook signature, always.** Xsolla signs each webhook with
  SHA-1 over the raw JSON body plus the webhook secret key, sent in
  the `Authorization` header. Verify over the **raw body bytes**
  before parsing (re-serializing parsed JSON changes the hash), with
  a constant-time compare — reuse the `hashesEqual` pattern from
  `server/src/giftCards.ts`. Missing or bad signature → 400, no
  further processing. The webhook secret is distinct from the API
  key; mixing them up is the classic setup bug, so name the env vars
  differently and fail boot if the webhook secret is unset in
  production (same pattern as `ADMIN_API_TOKEN`).
- **Never trust the webhook's amount or product.** The grant checks
  the paid amount against the price the server computed for the
  `web_orders` row (product + promo). A mismatch logs an alert and
  grants nothing.
- **Tie every payment to a signed-in account.** The token carries
  our user id in custom parameters; `user_validation` confirms it;
  the grant goes to `web_orders.user_id` only. There is no
  anonymous checkout and no way to redirect a payment to another
  account.
- **Idempotency and replays.** The `purchases` unique constraint is
  the backstop (above). Webhook retries are expected — answer 200
  fast and make the handler safe to run twice. Keep a short log of
  processed webhook deliveries for debugging (event type + Xsolla
  order id + outcome, never card data).
- **Secrets in Secret Manager, never in the repo** (same pattern as
  `beech-admin-token` / `beech-gift-code-pepper` in
  docs/GIFT_CARDS_PROMOS.md): `XSOLLA_MERCHANT_ID`,
  `XSOLLA_API_KEY`, `XSOLLA_PROJECT_ID`,
  `XSOLLA_WEBHOOK_SECRET_KEY`, passed to Cloud Run with
  `--set-secrets` next to `DB_PASSWORD`. The API key creates payment
  tokens; the webhook secret verifies incoming calls; neither is
  ever logged.
- **No card data touches our servers.** The player pays on Xsolla's
  page. Our PCI scope stays SAQ A. Do not add card fields to our own
  pages, and do not log webhook bodies that could contain payer
  details beyond what fulfillment needs.
- **Rate limits.** Checkout creation is rate-limited per user (same
  limiter as credit purchases). The webhook endpoint is not
  session-authenticated, so it relies on the signature alone — that
  is the intended design, and it must reject unsigned calls fast.

### Client changes

- `src/net/shop.ts`: a `buyOnWeb(productId, promoCode?)` that calls
  the new checkout endpoint and returns the Pay Station URL; a
  `webOrderStatus(id)` poll; web-mode pending orders re-checked on
  shop open (same shape as `retryPending()`).
- `src/ui/shop.ts`: in web mode the Buy button becomes a real buy
  (today it opens the app-store link). The button shows the USD
  price with a "converted at checkout" note — Xsolla converts to the
  player's local currency inside Pay Station. After the return, the
  shop shows the paid state from the poll. The "Buy with credit"
  button is unchanged.
- No changes to the native buy flow, the native shop UI, or the
  store verification code.

## Testing plan

- **Unit:** token creation (amount/SKU/user mapping, promo pricing),
  webhook signature verification (good, bad, missing), grant
  idempotency (same `payment` event twice grants once), amount
  mismatch (grants nothing), refund (expires inventory), expired
  token / canceled order (no grant).
- **Sandbox end to end:** a sandbox Xsolla project and catalog
  mirroring `products.ts`; Xsolla's sandbox test cards; a full
  purchase in the local dev server with the webhook delivered through
  a tunnel (ngrok / cloudflared) or replayed from a saved fixture;
  then the same flow against staging Cloud Run with the real webhook
  URL.
- **Webhook replay:** save one signed fixture per event type
  (`user_validation`, `payment`, `refund`, `order_canceled`) and
  replay them in tests, exactly as the store tests do for Apple and
  Google notifications.
- **Failure matrix:** player cancels in Pay Station (order stays
  `created`, expires, no grant); payment succeeds but the webhook is
  delayed (return-page poll waits, then the webhook grants — the
  player must never be told a paid order failed); webhook arrives
  before the return page polls (grant first, poll sees `paid`);
  promo exhausted between checkout and payment (see the wrinkle
  above); Xsolla returns an error creating the token (surface it,
  no order left `paid`).
- **Production smoke:** after the first production deploy, buy the
  cheapest item ($0.99 parasol) with a real card in production, then
  refund it through Xsolla and confirm the item expires — the same
  shape as the store refund tests.

## Rollout phases

0. **Accounts (Mark, no code).** Xsolla Publisher Account, licensing
   agreement, tax forms, payout details. Sandbox project + catalog
   mirroring `server/src/products.ts` (same 10 SKUs, same USD prices).
   Get the all-in fee in writing.
1. **Server.** Migration 13 (`web_orders`), token endpoint, webhook
   endpoint, `GET /api/store/web-orders/:id`, secrets in Secret
   Manager, deploy-workflow `--set-secrets` wiring. Server tests
   green, including the webhook fixtures.
2. **Client.** Web Buy button, Pay Station redirect, return-page
   poll, pending-order re-check. Typecheck + client suite green.
3. **Sandbox end to end.** Full purchase, refund, duplicate
   webhook, cancel — all against the sandbox project.
4. **Soft launch.** Production keys, one product only (`beach_1`,
   $2.99) with the rest still app-only, for a week. Watch the
   observability dashboard (HTTP errors, webhook failures) and the
   payout report. If the all-in fee comes back materially above the
   10% estimate, stop here and re-evaluate before going wider.
5. **All products + promos on web.** The whole catalog, promo codes
   at checkout, then update docs/PRICING.md (the "No web payments"
   line goes away) and the shop note.
6. **Phase 2 (separate plan).** Sell gift cards on the web: a web
   checkout that issues a gift-card code (or credits the buyer's own
   account). Needs the issuance path from the admin console reused at
   payment time; do not fold it into this change.

## Cost estimate

At today's store volumes the absolute numbers are small; the
comparison is what matters (table in "Why the fixed fee decides
it"). At the 5% headline, a $2.99 beach keeps $2.84 on the web vs
$2.54 through Apple/Google at 15% — about 30¢ more per beach, and
about $0.60 more than the 30% tier. The web also reaches players who
never install the app, which the stores can't do at any fee. Fixed
costs: none known — no monthly fee, no setup fee (verify at signup);
the only fixed cost is the chargeback fee ($7–15 per card
chargeback, reported) and whatever the "cost of channel" turns out
to be. Re-check the effective rate after the first month of real
volume, per payment method, before expanding the catalog on the web.

## What this deliberately does not do

- **No subscriptions.** Beech sells one-off items; the "Beach club"
  idea in docs/PRICING.md is a separate decision, and FastSpring's
  subscription strength is not a reason to pick it.
- **No paid random draws on the web.** The claw machine stays free;
  paid mystery boxes need odds, a pity limit and a country check
  (docs/PRICING.md) — out of scope here.
- **No web checkout inside the native apps.** The apps keep
  StoreKit / Play Billing and never link out to web checkout.
- **No selling gift cards on the web yet.** That's phase 2.
- **No changing store prices or the credit system.** Web checkout
  adds a payment path; it doesn't reprice anything or touch how
  credit works.

## Open questions for Mark

1. **Confirm Xsolla** (recommended) — or FastSpring, knowing the
   $0.95-per-transaction fee makes the $0.99–$2.99 items nearly
   worthless on the web?
2. **Web prices:** same USD list as the stores, converted by Xsolla
   at checkout — or localized prices per country set in the Xsolla
   catalog?
3. **Refund policy for web purchases:** mirror the stores (refund
   revokes the item, as `refund()` does) — and who handles a refund
   request, Mark or Xsolla support?
4. **Promo reservation:** reserve the promo use at checkout creation
   (recommended) or accept the rare oversell and grant anyway? (See
   "The promo wrinkle".)
5. **Sell gift cards on the web** (phase 2) — or keep gift cards
   admin-issued only?
6. **Payout and tax setup:** bank details and tax forms for the
   Xsolla licensing agreement — Mark to complete in Publisher
   Account (no code).
7. **Soft-launch scope:** one product (`beach_1`) for a week, or the
   whole catalog at once?

## Sources

- Xsolla: xsolla.com (5% headline, 1,000+ payment methods, MoR
  model), developers.xsolla.com (Pay Station token flow, Headless
  Checkout SDK, webhook setup and signature scheme).
- FastSpring: fastspring.com, developer.fastspring.com (webhook
  HMAC-SHA256 scheme, Store Builder Library), docs.fastspring.com
  (product catalog, embedded checkout).
- Fee benchmarks (third-party, not vendor-published): the 5.9% +
  $0.95 FastSpring figure and the 7–10% Xsolla all-in estimate.
  Verify both in writing before signing anything.
