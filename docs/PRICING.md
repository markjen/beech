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

## Paid extra tries on the machines (2026-11-26)

When the free go is gone, one more try costs sand bucks: an extra ball
from the vending machine is **10 sand bucks**, an extra go on the claw
machine is **10**. Both prices sit above the expected value of one try —
so a try can never be farmed for trade-ins: the price is above what a try
is worth on average, so buying tries to trade the prizes back in loses
sand bucks. (Mark's call, Nov 26, 2026: 10 on both, a thinner edge on the
vending machine than the 1.5× EV the code first proposed.) A won item is
valued at its trade-in value (`RARITY_BUCKS` in `server/src/bucks.ts`), except the
vending machine's unique item — a one-of-a-kind item with no trade-in
value — where the EV assumes 40, one step above legendary's 30. The
derivation lives in `server/src/paidPulls.ts` and is covered by tests, so
the numbers below can't drift from the code.

| Machine | Expected value of one try | Price | House edge |
|---|---|---|---|
| Vending machine | **8.5** — 60% common (5) + 25% uncommon (10) + 12% rare (15) + 3% unique (40) | **10** | ~18% |
| Claw machine | **5.84** — 70% common × 80% held (5) + 25% rare × 65% held (15) + 5% legendary × 40% held (30); about 1 go in 4 comes up empty | **10** | ~71% |

A paid try is exactly one draw, same as a free one: the vending ball never
slips, the claw can still drop the ball (the go is spent), and a paid try
never takes a starter gift and never touches the free go — the free cadence
and the first-go gifts are for free play. The price is deducted server-side
in one statement with the grant (`claimPaidPull` in
`server/src/paidPulls.ts`); a player without enough sand bucks gets a 402
and nothing is deducted or granted. The odds are shown in the machine and
in the guide before the player buys.

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
| `pet_crab` … `pet_dolphin` | A pet: crab 20, sandpiper 28, octopus 40, seal 48, turtle 60, dolphin 80 bucks | sand bucks only (crab: $1.99 in old apps) | Befriending one in snacks costs a quarter; bigger, rarer animals that do more cost more. No store items: [PETS.md](PETS.md). |

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

- **No paid random draws (loot boxes) — with one exception.** The claw
  machine stays free, and the paid *extra* tries on the claw and vending
  machines are the exception: they are priced from expected value (see
  above), the odds are shown in the machine and in the guide before buying,
  and a paid try never takes a starter gift. Paid random items are
  restricted or banned in some countries (Belgium, the Netherlands at
  times; age rules elsewhere) — a country check before selling extra tries
  in those markets is still open, as is a review of the current
  Apple/Google paid-random-item policies. If we ever add paid mystery
  boxes, they need odds shown before buying, a pity limit, and a country
  check.
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
