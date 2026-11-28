# The merch store (store.beech.games)

Status: **built, switched off until the secrets and Printful are set up**
(2026-11-27). The Stripe account and test-mode catalog are done (see
"Turning it on"); the Printful token and the four secrets are still open.
The store page is live at `/merch-store` on any host (and at
store.beech.games once the domain is mapped): it shows the catalog and says
it opens soon. Orders turn on by themselves when the four secrets are set
(see "Turning it on").

## What it sells (2026-11-28 lineup)

Reviewed with Mark over seven rounds (the review page was a claude.ai
artifact). The rules that came out of it:

- **Pictures are straight on**: the beach seen from above, or from the side.
  Never slanted (diagonals look rumpled once worn).
- **The picture sits in a shape** (a square or a circle), never across the
  whole garment.
- **Soft, neutral bases** (white, ash, light heather gray, pale blue, dust),
  and muted colours in the prints.
- **Minimal**: one-colour line drawings over full pictures.

| Section | Products (Printful product) | With your beach |
| --- | --- | --- |
| Designs | Top view tee (71, word front + 10″ square back), Side view tee (71, side-view square front + line badge back), Top view hoodie (146), Beech sweatpants (895, word by one pocket, crab outline by the other), Layers bottle (382), Layers tumbler (909) | top view tee/hoodie: their beach as the back square |
| The launch five | Beech tee (71), hoodie (146), dad hat (206, embroidered), flip flops (359), beach towel (259); **the whole beach set** of those five | towel |
| More to wear | Oversized heavyweight hoodie (892), boxy tee (1592), tank (248) | — |
| Beach day | Cuffed beanie (266, embroidered), bucket hat (1688, DTF), tote (84), socks (882), sticker (358) | tote, sticker |
| Home and wall | Layers mug (19), poster (1), framed poster (172), framed canvas (614), puzzle (534), sherpa blanket (711), outdoor pillow (1742) | all of them |

**Pricing (Mark, 2026-11-28).** Anything that shows off beech (the line
mark, the wordmark, or the sample beach) is sold **at cost**:
- Printful's price for that colour and size, plus each extra placement;
- plus Stripe's 2.9% + 30¢ and about $1 (`MERCH.atCostMarginCents`);
- rounded up to the dollar.

Per size, so a 3XL costs what Printful charges for it. With the buyer's own
beach, an item keeps a normal margin: its own price at the cheapest size
(`own.cents`) plus what a bigger size costs Printful more. The set is at
cost as one line: one Stripe fee and one $1, not five. Shipping is a flat
$8, free from $100.

**Where the numbers come from.** `scripts/merch-catalog.mjs` reads
Printful's catalog with this store's own pricing and writes
`server/src/generated/merchCatalogData.ts`. It records:
- every colour/size's variant id and cost;
- what each extra placement costs (a back print on the tee is $6.75);
- each placement's print-area size.

Rerun it when Printful's prices change:
`PRINTFUL_TOKEN=… PRINTFUL_STORE_ID=19138894 node scripts/merch-catalog.mjs`
(in a cloud session, `NODE_USE_ENV_PROXY=1` and the token placeholder
`proxy-injected`). The products, their colours, prints and own-beach prices
are in `merchCatalog.ts`.

**Print files.**
- **The brand files** in `public/merch/` are drawn by
  `scripts/merch-art.mjs`: the line mark, the wordmark, the crab, the wide
  mark for hats, the muted side view, the line badge, the wrap, and the sea
  and sand for the towel, flip flops, tote and socks.
- **The sample beach's top-view prints** (`sample-square.png`,
  `sample-flat.png`) come from `scripts/merch-sample.mts`, which renders
  `docs/examples/sunny-cove.beach.json`.
- **A buyer's beach** is drawn the same way per order
  (`server/src/merchPrint.ts`): the top-down picture, muted, cut to a square
  or the whole width.

Each print names its placement and a spot (chest, wearer's left, back
square, …). `positionFor` turns that into Printful's file `position` inside
that placement's print area.

**Not sold yet:**
- **The sunglasses:** stocked goods, `MERCH_SUNGLASSES_VARIANT`; see below.
- **All-over-print panel items** (board shorts, swim trunks, the reversible
  bucket hat, the fanny pack): they need art drawn to each panel template.
- **Tapstitch's heavyweight line:** Tapstitch has no order API, so each
  order would have to be placed by hand.
- **A buyer's own beach from the side** (side view tee, bottle, tumbler):
  needs a side-view renderer.
- **The phone case.**

**Sunglasses, for later.** The sunglasses were in the first catalog and
are out for now (2026-11-27). Printful (and Printify, Gooten) don't print
sunglasses on demand, and the few who do (Contrado, Bags of Love) have no
order API that fits. The plan:
1. Order them once in bulk with the beech logo on the arm (any promo
   supplier; 50–100 units, a few dollars each).
2. Send them to Printful's warehouse (Printful Warehousing), which picks
   them into the same box as the printed things.
3. Set the Actions variable `MERCH_SUNGLASSES_VARIANT` to their warehouse
   variant id.

The sunglasses then come back as their own product.

## One-off prints of your beach

Printful's order API takes a print file URL per order item, so every order
can carry its own picture: there's no product to set up per beach.

- The shopper signs in on the store with Google or Apple (the same shore
  token as beechshore.com's account page, docs/SHORE_SITE.md), picks one of
  their saved beaches, then chooses "My beach" on a product marked "Your
  beach".
- At checkout the server copies that beach onto the order line, in the same
  transaction that checks the shopper still owns it: its saved sand, its
  place, its pier and its inland rows. Building on afterwards doesn't change
  the print.
- The print file is drawn from that copy by `merchPrint.ts`: the square
  (1500 px, a 10″ square on a shirt's back) or the flat cut (2400 × 1260
  plus any rows), muted.
- It is served at `store.beech.games/api/print/<key>.png`. The key is random
  per line, so only Printful (and the order) know it.
- Only your own beaches: printing someone else's beach is refused (403).

## How an order goes

```
store page ── POST /api/checkout ──► server prices the cart, makes a Stripe Checkout
                                     session (idempotency key = order id), then saves
                                     the order (status open) + lines + beach copies
shopper pays on Stripe's page ─────► webhook checkout.session.completed ─┐
shopper comes back to /order/<id> ─► GET /api/orders/<id> asks Stripe ───┴► paid (once)
                                     │ send: claim → Printful draft (external_id = order id)
                                     │       → mark sent → Printful confirm
Printful makes it, webhook ────────► package_shipped → shipped (+ tracking on the order page)
```

- The **store page** (`server/src/merchSite.ts`) is one page that draws
  itself from `GET /api/catalog`: the set, the collection, and "your beach,
  printed". The bag is kept in the browser (localStorage). Each product is
  drawn as an SVG in the chosen colour with its real print file on it.
- **Payments: Stripe Checkout** (hosted by Stripe: card, Apple Pay, Google
  Pay; no card data reaches us). It collects the shipping address and
  phone, adds the flat shipping, and adds Stripe Tax
  (`MERCH_STRIPE_TAX=1`; Tax is active for CA). Stripe sends its own
  receipt email. Sessions are made with inline `price_data` from
  `merchCatalog.ts`, not by referencing Stripe Price IDs — the Stripe
  catalog (see "Turning it on") is the record/receipt side and must be
  kept in sync with the catalog's prices by hand.
- **Fulfilment: Printful's API** (`server/src/merchProviders.ts`, plain
  fetch). Orders are made as drafts, then confirmed. The brand art is in
  `public/merch/` (drawn by `scripts/merch-art.mjs` from the app icon; dark
  garments get the light-ink version) and Printful fetches it from
  `store.beech.games/merch-art/<file>`. The hat is embroidered, not printed:
  Printful's Orders API refuses an embroidered item without an item-level
  `thread_colors` option, so the hat's order item carries one
  (`HAT_THREAD_COLORS` in `merchCatalog.ts`: white, sky blue, black, old
  gold — the logo-hat art's palette matched to Printful's allowed threads).
- A **sweep** runs once a minute: stale claims go back, orders left
  unconfirmed are confirmed, paid orders that couldn't reach Printful are
  retried. Cloud Scheduler calls `POST /api/merch/tick` — the server only
  ticks itself when Scheduler isn't configured (local dev), because on
  Cloud Run an idle instance's CPU is throttled and its timer's query
  looked slow, ~1 s wall-clock, tripping the slow-database-queries alert
  (the same reason the push tick moved to Scheduler).

## State machine

No model change for the 2026-11-28 lineup: it changed what is sold, its
prices and its print files, not how an order moves.

`specs/tla/MerchOrders.tla`; the action-to-route table is in
[STATE_MACHINES.md](STATE_MACHINES.md), "Merch store orders". The rules:
one receipt per order however many times Stripe tells us; nothing printed
unpaid; a refund before the order was sent stops the print; the print is
the beach as it was at checkout; a paid, unrefunded order never ends up
expired; a refunded order never looks live. What the model decided:

- marking paid is one `UPDATE … WHERE status IN ('open','expired')`, and
  only the request that gets the row sends the order on (the webhook and
  the return page race);
- we never expire an order ourselves: Stripe does, and a late "completed"
  still wins over "expired";
- the worker marks the order sent *before* confirming at Printful, under its
  claim, so a refund that lands first stops it;
- a refund cancels an order in every state before sent, including open
  (its "completed" may come after the refund).

## When something goes wrong

- **Refunds** are made in the Stripe dashboard. A full refund before the
  order went to Printful cancels it there and then; after, the order is
  marked refunded and it's already being made (cancel it in Printful's
  dashboard if it's still in its first hour). Partial refunds leave the
  order alone.
- **Printful problems** (`order_failed`, `order_canceled`,
  `order_put_hold`) are logged as `merch_printful_problem` (ERROR): sort
  them out in Printful's dashboard.
- **Logs**: `merch_checkout`, `merch_paid`, `merch_send`, `merch_refunded`,
  `merch_send_error`, `merch_tick`, `merch_stripe_webhook`,
  `merch_printful_webhook`.
- **Returns policy** (the guide, `server/src/guide.ts` "Merch store"):
  misprinted, damaged or wrong things are replaced or refunded within 30
  days; things made to order can't be returned for a change of mind.

## Turning it on (owner)

1. **Printful**: make an account, a "Manual order platform / API" store,
   and a private token with orders + webhooks scopes. Add billing (Printful
   charges you per order). Put the token in Secret Manager as
   `beech-printful-token`. (An account-level token also needs the Actions
   variable `PRINTFUL_STORE_ID`.)
2. **Stripe**: ✅ the account is set up — Jenerator Labs
   (`acct_14FIlH4IbcjUfc8t`), charges and payouts on, daily payouts to Bank
   of America ending 8659. Stripe Tax is active with a US–CA registration,
   so set the Actions variable `MERCH_STRIPE_TAX=1` (prices below are
   tax-exclusive; Stripe adds tax on top at checkout). The secret key goes
   in Secret Manager as `beech-stripe-secret-key` — the same key the game's
   web checkout uses (PR #191), so one secret serves both. Add a webhook
   endpoint `https://store.beech.games/api/stripe-webhook` with events
   `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.expired`
   and `charge.refunded`; its signing secret → **`beech-stripe-merch-webhook-secret`**
   (its own secret — the game's endpoint
   `/api/store/stripe/webhook` has a different signing secret in
   `beech-stripe-webhook-secret`, and one Stripe signing secret verifies
   only its own endpoint). Turn on "Successful payments" customer emails
   for receipts.
   - **Catalog (test mode, done 2026-11-27)** — every product exists with a
     default price matching `merchCatalog.ts` exactly. The checkout code
     sends inline `price_data`, not these Price IDs, so this catalog is the
     record/receipt side: if a price changes in `merchCatalog.ts`, change
     the matching Price here too, by hand.

     | Product | Price | Test-mode price id |
     | --- | --- | --- |
     | Beech T-Shirt (`prod_Vhp2DyHw5C6IG7`) | $30.00 | `price_1UgQGK4IbcjUfc8tSBqA6gYk` |
     | Beech Hoodie (`prod_Vhp2OiUR1wLtsv`) | $55.00 | `price_1UgQGM4IbcjUfc8tdEcxp6BI` |
     | Beech Hat (`prod_Vhp2JZnhpjs0Rx`) | $28.00 | `price_1UgQGN4IbcjUfc8tKWNztsXL` |
     | Beech Flip Flops (`prod_Vhp2mhGLOqLJh1`) | $30.00 | `price_1UgQGP4IbcjUfc8tB47117yz` |
     | Beech Beach Towel (`prod_Vhp2nbZ5Ky0sGs`) | $45.00 | `price_1UgQGR4IbcjUfc8tzLnosN8E` |
     | Beech Sunglasses (`prod_Vhp2nKNk8Ha8za`) | $22.00 | `price_1UgQGU4IbcjUfc8tSHsBsldI` — dormant: out of the store for now (see "Sunglasses, for later"), not deleted |
     | Beech Merch Set (`prod_Vhp2rlrkX6n0p2`) | $160.00 | `price_1UgRKK4IbcjUfc8tAzGYhxrx` (default since 2026-11-27; the old $179 price `price_1UgQGW4IbcjUfc8t1RRXfCxQ` still exists on the product but is no longer the default) |
     | Your Beach Tee (`prod_VhpwfdcKos7z6l`) | $36.00 | `price_1UgQGX4IbcjUfc8tvcXlVpiu` |
     | Your Beach Hoodie (`prod_Vhpw6RneSazepM`) | $62.00 | `price_1UgQGZ4IbcjUfc8t7B6QQ11B` |

     All shippable, tax code `txcd_10000000`. **Still open:** create the
     two secrets (`beech-stripe-secret-key`, `beech-stripe-merch-webhook-secret`,
     TEST keys) and grant the game service's account access; register the
     webhook endpoint above in the Stripe dashboard (test mode); at launch,
     create the same eight store products + prices in **live** mode (not the
     dormant sunglasses) and swap the secrets for live keys.
3. **Printful webhook**: make up a long random secret →
   `beech-printful-webhook-secret`, then register
   `https://store.beech.games/api/printful-webhook?s=<that secret>` for
   `package_shipped`, `order_failed`, `order_canceled`, `order_put_hold`
   (`POST https://api.printful.com/webhooks`, or the dashboard).
4. Give the game service's account access to the four secrets, set the
   Actions variable `MERCH_ENABLED=1`, and deploy.
5. **Domain**: `terraform apply -var store_custom_domain=store.beech.games`,
   then add the CNAME it prints in Squarespace (`beech.games` zone).
6. **Sign-in**: add `https://store.beech.games` to the web OAuth client's
   Authorized JavaScript origins, and the domain + return URL
   `https://store.beech.games/` to the Sign in with Apple Services ID.
7. **Test first**: set `PRINTFUL_DRAFTS_ONLY=1` and use Stripe test keys:
   orders reach Printful as drafts you can inspect (check each placement
   and the hat's embroidery in Printful's preview) and are never made.
   Order one of each for real before telling anyone.
8. Then a line in the release notes (`server/src/releaseNotes.ts`).
9. **The sweep, on Cloud Scheduler** (same account as the push tick —
   `beech-scheduler@beech-prod.iam.gserviceaccount.com`, which already has
   `roles/run.invoker` on the game service):
   ```bash
   SCHED_SA=beech-scheduler@$PROJECT.iam.gserviceaccount.com
   URL=$(gcloud run services describe beech --region=$REGION --format='value(status.url)')
   gcloud scheduler jobs create http beech-merch-tick --location=$REGION \
     --schedule='* * * * *' --http-method=POST --uri="$URL/api/merch/tick" \
     --oidc-service-account-email=$SCHED_SA --oidc-token-audience="$URL/api/merch/tick"
   ```
   Then the variables `MERCH_TICK_SERVICE_ACCOUNT` = `$SCHED_SA` and
   `MERCH_TICK_AUDIENCE` = `$URL/api/merch/tick`. Until the next deploy
   the job gets 404s; that's fine. Without these variables the server
   ticks the sweep itself with its in-process timer (local dev).

**Later: sunglasses.** Not a launch step. Order logo sunglasses in bulk,
send them to Printful Warehousing, and set the Actions variable
`MERCH_SUNGLASSES_VARIANT` to their warehouse variant id — the sunglasses
then come back as their own product in the store. The set stays five.

## Not built (ideas)

- Mockups from Printful's mockup generator instead of the drawn pictures.
- Your beach on the towel (sublimation, a tall crop of the beach) and the
  isometric view as a print choice.
- A "store" link in the game's settings and on beechshore.com.
