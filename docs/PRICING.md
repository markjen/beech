# Pricing plan

beech is free to play, forever: digging, the waves, the real tides and sun,
rocks, driftwood, shells, sea glass, flags, neighbors, the shore and the
claw machine. The shop sells **space** (more beaches) and **centrepieces**
(things that make a beach yours). Everything is a one-off purchase that's
yours on every device. There are no subscriptions, no timers to pay past, no
ads and no paid random draws.

## Sand bucks (2026-11-26)

Everything below is now sold for **sand bucks** at **10¢ a buck**, the same
prices rounded to the buck ($2.99 → 30). Real money only buys sand-buck
packs: 10 for $0.99, 33 for $2.99, 60 for $4.99, 130 for $9.99, 280 for
$19.99 (`bucks_10` … `bucks_200` in `server/src/products.ts`) — the bigger
packs carry a bonus (+10% / +20% / +30% / +40%), so the price per buck falls
as the pack grows. Anything in the
bag can be traded back in at what it cost, so trying things is free. This
replaces "no in-app currency" (owner decision); the design, the trade-in
rules and the store tasks are in [SAND_BUCKS.md](SAND_BUCKS.md). The table
below keeps the US prices the old app versions still sell at, and the
reasoning for each price.

## The price list

US prices. Each one is a standard App Store / Google Play price point, and
each store converts it per country (`server/src/products.ts` holds the same
list).

| Product id | What you get | US price | Why this price |
|---|---|---|---|
| `pack_founder` | 2 extra beaches, lighthouse, beach hut, parasol, 2 tiki torches | **$9.99** | The best value (about $15.90 if bought separately) and the one to feature. A launch-era bundle for the most engaged players. |
| `beach_1` | 1 extra beach | **$2.99** | The core purchase. It sits at a common "meaningful but impulse" point, a little above a single centrepiece because a beach is a whole new canvas. |
| `beach_3` | 3 extra beaches | **$6.99** | About $2.33 each (save 22%), for people building their own stretch of shore. |
| `item_lighthouse` | Lighthouse | $2.99 | A legendary centrepiece that shines at night. |
| `item_palmtree` | Palm tree | $2.99 | A legendary centrepiece, the tallest of the new set. |
| `item_lifeguardtower` | Lifeguard tower | $2.99 | A legendary centrepiece. |
| `item_beachhut` | Beach hut | $2.99 | A legendary centrepiece. |
| `item_sandcastle` | Sandcastle | $1.99 | Legendary, but smaller. |
| `item_bonfire` | Bonfire | $1.49 | Rare, with a flame that flickers. |
| `item_hammock` | Hammock | $1.49 | Rare. |
| `item_surfboard` | Surfboard | $1.49 | Rare. |
| `item_tikitorch` | 2 tiki torches | $1.49 | Rare, sold as a pair (they frame a path). |
| `item_parasol` | Parasol | $0.99 | Rare, and the entry point. |
| `item_towel` | Beach towel | $0.99 | Rare. |
| `item_deckchair` | Deckchair | $0.99 | Rare. Also everyone's second claw-machine gift, a taste of the shop. |

What you buy counts toward "N of M left": you can put down as many of an
item as you own, across all your beaches. Buying another adds one.

## How the free side feeds the shop

- **Claw machine:** the first go is a rare find. The second is a shop
  item (the deckchair), so everyone owns one paid thing and sees the glow and
  sparkles. A day after the first go comes a free **extra beach**, so people
  try a second beach before ever paying. After that, free goes at a growing
  rest (5 min doubling up to a day) keep people coming back.
- **Rare, legendary and shop things glow on the beach** (blue / gold, with
  sparkles). Neighbors walking past see them, and that is the advertising.
- **Leaderboard:** starred beaches get seen, and beaches with centrepieces
  get starred.

## Gift cards and promo codes

The shop also takes **gift cards and promo codes** (docs/GIFT_CARDS_PROMOS.md).
A gift card is prepaid credit, issued by Mark from the admin console
(the `beech-admin` service) or the CLI (`scripts/beech-admin.mjs`); redeeming it in the shop
adds the credit to your account, and credit buys products in the shop with
an optional promo code. Promo codes discount a credit purchase (percent or
a fixed amount, optionally for one product, with usage limits and expiry).
Nothing here touches Apple or Google: the store prices can't be discounted
from our side, so credit purchases are entirely server-side.

## Things we don't do, on purpose

- **No paid random draws (loot boxes).** The claw machine stays free. Paid
  random items mean showing odds in both stores, and they're restricted or
  banned in some countries (Belgium, the Netherlands at times; age rules
  elsewhere). If we ever add paid mystery boxes, they need odds shown before
  buying, a pity limit, and a country check.
- **No subscriptions** for now. A later "Beach club" ($2.99/month: a monthly
  legendary item, a gold name tag, an extra claw go a day) is possible once
  there's enough to give each month.
- **No selling advantages over other people.** Stars, neighbors and the shore
  can't be bought.
- **Web payments through a merchant of record only.** In the apps,
  purchases go through Apple and Google. On the web they go through Xsolla
  (docs/WEB_PAYMENTS.md), which handles payment, tax, refunds and receipts;
  we never see card details. Same USD prices, converted at checkout. Until
  the Xsolla account is set up, the web shop sends people to the app.

## Store costs

Apple and Google take 15% (Small Business Program / the first $1M a year on
Google Play) or 30%. On a $2.99 beach that's about $2.54 to us at 15%.
Prices include sales tax / VAT in most countries, so the take-home varies a
little by country.

## When to revisit

- **After the first month:** if `beach_1` far outsells the bundles, try
  making `beach_3` $5.99. If the founder's pack sells well, keep it as the
  featured bundle and rotate its contents seasonally.
- **Time-limited items** (the catalog supports `available.from/until`): a
  summer item, or a winter "beach bonfire". They should be a little special,
  never needed.
- **Regional pricing:** the stores' automatic conversions are fine to start
  with. Adjust later only if a market clearly under-buys.
