# Vending machine

One free ball a day, from a set of items that changes every week. The ball
is drawn on the server, with the odds shown under the machine before every
ball — the same shape as the claw machine, a different cadence and a
different pool.

## How it works

- **The machine.** A tile in the bag tray (next to the claw machine) opens
  the dialog: the machine, its balls behind the glass, a "Get a ball"
  button, and the odds for this week's set. Press the button and a ball
  drops into the tray, then opens to show what's inside. "Put it on the
  beach" picks the item up in hand; "Keep it" just adds it to the bag.
- **The ball.** One free ball a day, resetting at UTC midnight. No currency,
  nothing to buy: the app has no in-app currency, the claw is free on a
  rest, and the shop is real-money purchases, so the machine mirrors the
  claw's free economy on a daily cadence instead. A daily ball means seven
  chances at each week's set.
- **The draw.** Server-side, in `server/src/vending.ts`, from this week's
  set. The client never rolls. A draw claims the day in `pull_state` and
  grants the item to `inventory` in one SQL statement, so two taps at once
  give exactly one ball (the second gets a 409). Unlike the claw, a ball
  never slips: the machine dispenses, it doesn't grab, so there is no
  miss roll and `GET /pulls` publishes no `grab` chances for it.
- **The odds.** Common 60%, uncommon 25%, rare 12%, unique 3%. Within a
  tier every item is equally likely. The machine prints the odds and the
  items in each tier before every ball.

## Rarities

The claw's tiers are common, rare, legendary. The machine adds
**uncommon** between common and rare, and draws **unique** instead of
legendary — so its four tiers are common / uncommon / rare / unique.
Unique items glow violet on the beach (rare glows blue, legendary gold).
`src/world/items.ts` holds the shared `Rarity` type; the claw never draws
uncommon or unique (odds 0).

## Sets

A set is data in `server/src/vending.ts` (`VENDING_SETS`): week number,
name, the date it starts (a Monday, UTC), the odds, and the items in each
tier. The machine always shows the latest set whose start has passed. If
a week is missed, the last set keeps running instead of the machine sitting
empty; before the first set starts, the first set shows.

Items in a set must exist in the app's catalog (`src/world/items.ts`,
`source: 'pull'`, matching rarity) — `tests/items.test.ts` checks this for
every set. A set's items stay in the catalog after their week ends, so what
someone won stays theirs and stays placeable.

Most new items reuse an existing kind (a Pink shell is a `shell` with a new
id, name and size range): it renders and behaves like that kind, and needs
only a catalog row and an icon. A genuinely new object — Week 1's Nautilus
— needs a kind: `ObjectKind` + behaviour in `src/sim/objects.ts`, colours
in `src/palette.ts`, a mesh in `src/render/objects.ts`, and an icon in
`src/ui/hud.ts`.

### Week 1 — "First light" (from Mon 2026-11-23)

| Tier | Chance | Items |
|---|---|---|
| Common | 60% | Pink shell, Blue sea glass, Pebble |
| Uncommon | 25% | Spiral conch, Golden sand dollar |
| Rare | 12% | Sunset starfish, Green bottle |
| Unique | 3% | Nautilus |

### Week 2 — "Beach day" (from Mon 2026-11-30)

A **mixed set**: three new items can't fill all four tiers on their
own, and every tier must be non-empty or the draw breaks — so Week 1
items fill the gaps, and the set keeps Week 1's 3/2/2/1 shape exactly.
The new items are the beach ball (common), sandals (uncommon) and
bucket (rare); the unique is the nautilus again, and sunset starfish
sits this week out. A later week can swap the borrowed items for
pure-new ones as they land — nothing in the machine assumes a set is
all new.

| Tier | Chance | Items |
|---|---|---|
| Common | 60% | Beach ball, Blue sea glass, Pebble |
| Uncommon | 25% | Sandals, Spiral conch |
| Rare | 12% | Bucket, Green bottle |
| Unique | 3% | Nautilus |

## Adding next week's set

1. Pick the theme and the items (one unique, two rare, two uncommon, three
   common is the Week 1 shape; the odds stay 60/25/12/3 unless a set says
   otherwise).
2. Add the new items to `src/world/items.ts` (a row each: id, name, kind,
   rarity, `source: 'pull'`, size range, variants) and their icons to
   `src/ui/hud.ts` (`ICONS`; a variant can reuse its kind's drawing). A new
   kind needs the checklist above.
3. Add one entry to `VENDING_SETS` in `server/src/vending.ts`: the next
   week number, the name, `starts` as next Monday's date, the odds, and the
   item ids per tier.
4. Run the tests: `cd server && npm test` and `npm test`. The items test
   fails if a set names an item that isn't in the catalog (or has the wrong
   rarity), and the vending tests check the odds sum to 1 and the draw
   follows them.
5. Merge and deploy. The new set goes live on its start date on its own —
   no migration, no flag, nothing to switch on.

## Follow-ups

- **Paid balls.** Needs a consumable store product and the purchase check
  in `server/src/store.ts`. Paid random items carry extra store rules: the
  odds are already shown, but check the paid-random-item policies (and
  country restrictions) before adding one — see the note in
  `server/src/pulls.ts`.
- **A ball a day is the only cadence.** More balls (a streak, a second ball
  for visiting a neighbor) would be a `pull_state` change, not a new
  machine.
- **Past sets.** A way to see (and re-win) last week's set is not built;
  the items stay in the catalog, but the machine only ever shows the
  current set.
