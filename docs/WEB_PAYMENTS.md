# Web payments: buy store items on the web with Xsolla

Status: **built, switched off until the Xsolla account exists.** The server
code, the web shop and the tests are in; web checkout turns on by itself
when the three Xsolla settings are present (see "Turning it on"). Until
then the web shop behaves exactly as before and points people at the apps.

The shop sells through Apple and Google in the apps. This adds real web
checkout for the same products, through a merchant of record, so a player
on play.beech.games can pay by card and get the item in their bag on
every device — no app install, and no card details ever reach us.

**Provider: Xsolla Pay Station** (In-Game Store API). The comparison with
FastSpring is below; the short version is that beech's items cost
$0.99–$9.99 and FastSpring's reported $0.95 fixed fee per transaction eats
most of the catalog, while Xsolla charges a percentage only.

## What it does

- In the browser (never in the apps), the shop's price button opens
  Xsolla's secure checkout. The player pays there, comes back to the beach,
  and the item lands in their bag — the same grant an App Store or Play
  purchase gives, through the same `purchases` + `inventory` rows.
- A web purchase **grants the item directly**. It does not add account
  credit; credit stays gift-card-only (docs/GIFT_CARDS_PROMOS.md).
- The price comes from `server/src/products.ts`, mirrored as SKUs in the
  Xsolla catalog. The client never supplies a price, and the server checks
  what Xsolla charged against its own list before granting.
- **Promo codes don't discount card payments yet** (see "Promo codes").
  They keep working with "Buy with credit".
- The native apps are unchanged: StoreKit / Play Billing only, and they
  never link or steer to web checkout (App Store anti-steering, Play
  payments policy). `shopMode()` is `'web'` only in a browser production
  build; development builds keep the pretend store.

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

## How it works (as built)

### Purchase flow

1. **Buy** (`src/ui/shop.ts` → `ShopApi.startWebCheckout`): in web mode, when
   `GET /api/store/products` says `webCheckout: true`, the price button
   calls `POST /api/store/web-checkout { productId }`.
2. **Checkout** (`server/src/app.ts`): the server prices the product, writes a
   `web_orders` row (`created`), and asks Xsolla for a payment token —
   `POST https://store.xsolla.com/api/v3/project/{project_id}/admin/payment/token`,
   Basic auth `project_id:api_key`, body: our user id as `user.id.value`, one
   item `{ sku: productId, quantity: 1 }`, `settings.external_id` and
   `custom_parameters.web_order` = our order id, `settings.return_url`,
   `sandbox` (`server/src/xsolla.ts`). The player's IPv4 goes in `X-User-Ip`
   (Xsolla needs a country or an IP). Xsolla answers `{ token, order_id }`;
   the order id is stored on the row. The client is sent to
   `https://secure.xsolla.com/paystation4/?token=…` (sandbox:
   `sandbox-secure.xsolla.com`). If the token call fails, the row is deleted
   and the player sees "try again in a minute".
3. **Webhook** (`POST /api/store/xsolla/webhook`): Xsolla calls it when the
   order is paid. The server checks the signature, finds the order, checks
   it, and grants in one statement (below).
4. **Return**: Pay Station sends the player to
   `https://play.beech.games/?web_order=<id>` (Xsolla adds `user_id`,
   `foreignInvoice`, `invoice_id`, `status`). `main.ts` strips those, and
   once signed in polls `GET /api/store/web-orders/:id` for up to a minute
   ("Checking your payment…" → "Paid: it's in your bag" and a bag refresh).
   Order ids are also kept in localStorage and re-checked when the shop
   opens, so a lost return link still refreshes the bag.

### Webhooks handled

Xsolla accounts registered after 22 Jan 2025 get everything in
`order_paid` / `order_canceled`; those are what we act on.

| `notification_type` | What we do |
|---|---|
| `user_validation` | 204 if `user.id` is a beech account, else 400 `INVALID_USER`. (Optional for the server-token flow; harmless if Xsolla sends it.) |
| `order_paid` | Find the order by `order.id` (= stored `provider_order_id`). Check: `user.external_id` is the order's player; `items` is exactly one of the order's SKU; if `order.currency` is USD, `order.amount` equals our price; and a sandbox payment (`order.mode: sandbox` or `dry_run: 1`) is refused unless we are in sandbox mode. Then grant. Any check failing → 400 with Xsolla's code (`INCORRECT_INVOICE`, `INVALID_USER`, `INCORRECT_AMOUNT`, `INVALID_PARAMETER`) and an ERROR log line; nothing granted. |
| `order_canceled`, `refund` | `refund('xsolla', order id)` — the same path as App Store / Play refunds: the purchase is marked and every item it granted expires, including any the player gifted on. The order becomes `refunded` (was paid) or `canceled` (wasn't). An unknown order is acknowledged (204) so Xsolla doesn't retry for 12 hours. |
| anything else | 204, logged as ignored. |

A verified, handled webhook always answers 204, including repeats, so
Xsolla's retries are harmless. A paid order in another currency (Xsolla
converts at checkout) is granted after the SKU and player checks, and the
currency is logged.

### Data (migration 15)

```sql
ALTER TABLE purchases DROP CONSTRAINT purchases_store_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_store_check CHECK (store IN ('apple', 'google', 'dev', 'xsolla'));

CREATE TABLE web_orders (
  id UUID PRIMARY KEY,                 -- ours; Xsolla's settings.external_id
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  provider TEXT NOT NULL DEFAULT 'xsolla',
  provider_order_id TEXT UNIQUE,       -- Xsolla's order id
  sandbox BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'refunded', 'canceled')),
  created_at BIGINT NOT NULL,
  paid_at BIGINT
);
```

The grant is one statement: insert into `purchases` (`store = 'xsolla'`,
`transaction_id` = Xsolla's order id, `ON CONFLICT DO NOTHING`), mark the
order `paid`, insert the items into `inventory` with `purchase_id`. The
`UNIQUE (store, transaction_id)` key makes a retried or concurrent webhook
grant nothing. An order already canceled isn't revived by a late payment.
An unpaid order older than 24 hours (a token's life) reads as `expired`
— computed on read, no sweeper; a payment that still arrives for it is
granted, because the player paid.

### Endpoints

| Endpoint | Auth | |
|---|---|---|
| `POST /api/store/web-checkout { productId }` | session; 10/min per player | → `{ order, url }`. 404 unknown product or checkout off; 400 with a promo code; 502 if Xsolla refuses. |
| `GET /api/store/web-orders/:id` | session, owner only | → `{ order: { id, productId, amountCents, status, createdAt, paidAt, grants } }`; 404 otherwise. |
| `POST /api/store/xsolla/webhook` | Xsolla signature | See "Webhooks handled". 404 while checkout is off. |
| `GET /api/store/products` | none | now also `webCheckout: boolean`. |

### Security

- **Signature first.** `Authorization: Signature <sha1(raw body + webhook
  secret)>`, lower-case hex; verified over the raw request bytes before any
  parsing, constant-time (`verifyWebhookSignature`). Missing or wrong →
  400 `INVALID_SIGNATURE`. The webhook secret is separate from the API key.
- **Never trust the webhook's product, amount or player**: all three are
  checked against our `web_orders` row, which only our server writes.
- **Sandbox can't grant on live.** Xsolla's sandbox uses the same project
  and webhook secret, so a test-card payment arrives correctly signed;
  production refuses `order.mode: sandbox` / `dry_run: 1`.
- **Every payment is tied to a signed-in account**: no anonymous checkout,
  and the grant goes to `web_orders.user_id` only.
- **No card data** touches our servers (PCI SAQ A); logs carry the event
  type, outcome and Xsolla order id only, never payer details or keys.
- Optional hardening for later: Xsolla publishes its webhook sender IP
  ranges; Cloud Run can't filter by IP without a load balancer, so the
  signature is the control.

### Promo codes

Xsolla charges its catalog price for a SKU; the In-Game Store token has no
price override (the older merchant `/token` call that accepts a custom
amount opens Pay Station for subscriptions only). So a beech promo can't
discount a card payment without also existing in Xsolla. v1 refuses a
promo at web checkout with a clear message, and promos keep working with
credit. To add them: create the same codes in Xsolla's promo campaigns,
pass `promo_code` on the token call, and on `order_paid` accept
`order.promocodes[].code` plus the discounted amount, counting the use in
`promo_uses` in the grant statement.

## Turning it on

1. **Xsolla account (Mark).** Publisher Account, licensing agreement, tax
   forms, payout details. Get the all-in fee in writing.
2. **Catalog.** Create one virtual item per product in
   `server/src/products.ts`, using the product ID as the SKU and `usd`
   for the USD price. Keep the catalog in step when products change.
3. **Webhooks.** Project → Webhooks: URL
   `https://play.beech.games/api/store/xsolla/webhook`; copy the secret key.
   Set exactly this URL in the Xsolla dashboard — the webhook must match
   the dashboard setting.
4. **Secrets** (Secret Manager, never the repo):
   ```sh
   printf %s "$KEY"    | gcloud secrets create beech-xsolla-api-key --data-file=-
   printf %s "$SECRET" | gcloud secrets create beech-xsolla-webhook-secret --data-file=-
   ```
   Grant the runtime service account `secretAccessor` on both, then add to
   `.github/workflows/deploy-gcp.yml` — `--set-secrets`:
   `XSOLLA_API_KEY=beech-xsolla-api-key:latest,XSOLLA_WEBHOOK_SECRET=beech-xsolla-webhook-secret:latest`;
   `--set-env-vars`: `XSOLLA_PROJECT_ID=<id>` and, for the first round,
   `XSOLLA_SANDBOX=1`. (Not in the workflow yet: `--set-secrets` with a
   secret that doesn't exist fails the deploy.)
5. **Sandbox end to end** with `XSOLLA_SANDBOX=1`: buy with Xsolla's test
   cards, cancel in Pay Station, refund from Publisher Account; check the
   bag, the `web_orders` row and the `xsolla_webhook` log lines.
6. **Live**: drop `XSOLLA_SANDBOX`, buy the $0.99 parasol with a real card,
   refund it, and check it leaves the bag. Re-check the effective fee after
   the first month before promoting web checkout anywhere.

The server logs `web_checkout_config { enabled, sandbox }` at start, and a
warning if only some of the three settings are present. Each checkout logs
`web_checkout`; each webhook logs `xsolla_webhook { type, outcome }` (ERROR
for refused payments — worth a log-based alert).

## Tests

- `server/test/webCheckout.test.ts`: signature (good, wrong secret,
  tampered body, missing, upper-case hex); token body; config gating;
  checkout (auth, unknown product, promo refused, token failure leaves no
  order); `user_validation`; grant once under retries and concurrent
  repeats; a multi-item pack; refused wrong amount / items / quantity /
  player / order / sandbox-on-live; local-currency payment; refund and
  cancel revoke; late payment after cancel grants nothing; expiry on read;
  switched-off server.
- `tests/webCheckout.test.ts`: the return-link helpers.
- Before going live: the sandbox run in "Turning it on".

## Review of the first draft (PR 21)

What changed from the plan in PR 21, and why:

- **The Store API token, not a custom amount.** The plan priced each
  checkout itself and validated promos into it. Xsolla's server-side item
  token charges the catalog price by SKU, and the custom-amount token only
  opens Pay Station for subscriptions, so web prices live in the Xsolla
  catalog (mirroring `products.ts`) and the webhook checks them.
- **Promos deferred** for the same reason (see "Promo codes"); the
  reservation scheme in the draft isn't needed yet.
- **Schema fixes.** `users.id` is a UUID, not TEXT (the draft's foreign
  key wouldn't have applied); `purchases.store` has a CHECK that rejected
  `'xsolla'`, so migration 15 widens it.
- **`order.id` is the transaction id** — it's in both `order_paid` and
  `order_canceled`, where the billing transaction id isn't always.
- **Sandbox payments are refused on live** (missing from the draft: they
  arrive with a valid signature).
- **Webhook replies follow Xsolla's contract**: 204 on success, 400 with
  `{ error: { code } }` on refusal — not "always 200".
- **Return URL is `/?web_order=`**, not `/shop?…`; the app has no `/shop`
  route and Xsolla adds its own parameters, which are stripped.
- **Secrets stay out of the deploy workflow until they exist**, so merging
  this can't break a deploy.

## What this deliberately does not do

- No subscriptions, no paid random draws, no gift-card sales on the web
  (a later phase: issue a gift card at payment time), no web checkout
  inside the native apps, no change to store prices or credit.

## Open questions for Mark

1. **Web prices:** same USD list converted by Xsolla (built this way), or
   per-country prices in the Xsolla catalog?
2. **Promos on card payments:** worth mirroring codes into Xsolla, or keep
   promos for credit only?
3. **Refunds:** who answers a refund request — Mark, or Xsolla support?
   (Either way the item leaves the bag automatically.)
4. **Gift cards on the web** (later phase), or admin-issued only?
5. **Soft launch:** all products at once, or one product first? Today it's
   all or nothing; a per-product allowlist is a small change if wanted.

## Sources

- Xsolla developer docs: In-Game Store API "create payment token for
  purchase" (`/v3/project/{project_id}/admin/payment/token`, server
  `https://store.xsolla.com/api`), Pay Station "create token", webhooks
  guide (signature generation, response codes, error codes, retry
  schedule), and the webhooks OpenAPI bundle (`order_paid` /
  `order_canceled` fields), read 23 Nov 2026.
- Fee benchmarks are third-party, not vendor-published: the 5.9% + $0.95
  FastSpring figure and the 7–10% Xsolla all-in estimate. Get both in
  writing before signing.
