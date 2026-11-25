# Items

The catalog of everything you can put on a beach, organized by how you
get it. The catalog itself is `src/world/items.ts`; this is the map over
it — what each thing is, where it comes from, what it looks like, and how
to add the next one.

The player-facing home of the catalog is the user guide
(beech.games/guide#catalog, `server/src/guide.ts`): it lists every item
by how you get it, with rarity, shop prices, and a line on how each
thing behaves. The guide builds that listing at runtime from the claw
pool, the vending sets, the shop products and the free items — never a
hand-kept copy — so it stays in step with the catalog below. This
document stays the builder's reference: kind, size, variants, mesh,
renders, and the checklist for adding the next item.

Renders of every item are in [`items/renders/`](items/renders/) (see
[Renders](#renders) below). The renders are also what players see: copies
live in `public/items/<item-id>.png` and are served on beechshore.com as
`/items/img/<item-id>.png` (the item catalog at `/items`, one page per
item with votes and comments — `server/src/itemCatalog.ts`). Copy a render
into `public/items/` in the same commit as a new or changed render; a test
in `tests/items.test.ts` checks every catalog item has both copies.

## Free (bag)

Unlimited, yours from the start. Place as many as you like.

| Item | Kind | Rarity | Size (m) | Variants | Behaviour | Mesh |
|---|---|---|---|---|---|---|
| Rock | `rock` | common | 0.12–1.3 | 8 | rock (raises the floor) | `src/render/objects.ts` |
| Driftwood | `driftwood` | common | 0.5–3.2 | 6 | float | `src/render/objects.ts` |
| Shell | `shell` | common | 0.05–0.5 | 8 | tumble | `src/render/objects.ts` |
| Sea glass | `seaglass` | common | 0.05–0.16 | 4 | tumble | `src/render/objects.ts` |
| Trash | `trash` | common | 0.08–0.25 | 3 | tumble | `src/render/objects.ts` |
| Seaweed | `seaweed` | common | 0.15–0.6 | 3 | tumble | `src/render/objects.ts` |
| Cowrie | `shell` | rare | 0.05–0.2 | 3 | tumble | `src/render/objects.ts` |
| Flag | `flag` | common | 0.4 fixed | 4 | fixed | `src/render/objects.ts` |
| Footprints | `footprints` | common | 0.5–2.0 | 3 | fixed | `src/render/objects.ts` |

Footprints are a trail of prints pressed into the sand — darker than
the dry sand around them, so they read as dips. Tap to set down one
trail, or drag with footprints in hand to leave a trail along the path
you draw: one trail per stride, each running in the direction you are
walking, its prints alternating left and right across the joins, up to
100 trails per drag. Undo takes a whole drag back at once. The little figure
walking the waterline from the same backlog line did not ship with
them: there is no character mesh, walk animation, or fading-decal
system in the app, so it would need a new render subsystem rather
than an item — it stays a backlog to-do (`docs/BACKLOG.md`).

## Wash-ashore finds

Things the sea brings in on its own (`washIn` in `src/sim/objects.ts`,
at most 6 wild things at a time). Pick one up and put it down to keep it.
The bag's "Found" section lists how many of each item you've kept from the sea.

| Item | Kind | Rarity | Size (m) | Variants | Behaviour | Mesh |
|---|---|---|---|---|---|---|
| Driftwood | `driftwood` | common | 0.7–1.8 | 6 | float | `src/render/objects.ts` |
| Shell | `shell` | common | 0.07–0.13 | 6 | tumble | `src/render/objects.ts` |
| Sea glass | `seaglass` | common | 0.07–0.11 | 4 | tumble | `src/render/objects.ts` |
| Trash | `trash` | common | 0.08–0.25 | 3 | tumble | `src/render/objects.ts` |
| Seaweed | `seaweed` | common | 0.15–0.6 | 3 | tumble | `src/render/objects.ts` |
| Cowrie | `shell` | rare | 0.05–0.2 | 3 | tumble | `src/render/objects.ts` (shell mesh with spots) |

Wash-in weights (of each thing the sea brings in): driftwood 35%,
shell 22%, sea glass 15%, seaweed 12%, cowrie 8%, trash 8%.

## Claw pool

The free claw machine (`server/src/pulls.ts`, pool `daily`): one go, then
it rests a random 5 minutes to 3 hours. Odds: common 70%, rare 25%,
legendary 5%. The claw doesn't always hold on — common 80%, rare 65%,
legendary 40% — and a ball that slips spends the go.

| Item | Kind | Rarity | Size (m) | Variants | Behaviour | Mesh |
|---|---|---|---|---|---|---|
| Conch | `conch` | common | 0.1–0.35 | 3 | tumble | `src/render/objects.ts` |
| Sand dollar | `sanddollar` | common | 0.06–0.16 | 2 | tumble | `src/render/objects.ts` |
| Coconut | `coconut` | common | 0.15–0.35 | 2 | float | `src/render/objects.ts` |
| Starfish | `starfish` | rare | 0.08–0.26 | 3 | tumble | `src/render/objects.ts` |
| Coral | `coral` | rare | 0.08–0.3 | 3 | tumble | `src/render/objects.ts` |
| Message in a bottle | `bottle` | legendary | 0.22–0.45 | 2 | float | `src/render/objects.ts` |

The coral tumbles in the swash like a shell; the coconut floats like a
bottle, riding high in the water. Each is the only item of its kind, so
the kind palette is its look — no `ITEM_LOOKS` entry — and the coral is
brick red, darker and redder than the starfish's orange and never the
sunset starfish's magenta.

## Vending sets

One free ball a day from the week's set (`server/src/vending.ts`,
`docs/VENDING_MACHINE.md`). Odds: common 60%, uncommon 25%, rare 12%,
unique 3%. A set's items stay in the catalog after their week ends, so
what you won stays yours.

### Week 1 — "First light" (from Mon 2026-11-23)

| Tier | Items |
|---|---|
| Common | Pink shell, Blue sea glass, Pebble |
| Uncommon | Spiral conch, Golden sand dollar |
| Rare | Sunset starfish, Green bottle |
| Unique | Nautilus |

| Item | Kind | Rarity | Size (m) | Variants | Behaviour | Mesh |
|---|---|---|---|---|---|---|
| Pink shell | `shell` | common | 0.05–0.5 | 8 | tumble | `src/render/objects.ts` |
| Blue sea glass | `seaglass` | common | 0.05–0.16 | 4 | tumble | `src/render/objects.ts` |
| Pebble | `rock` | common | 0.05–0.25 | 8 | rock | `src/render/objects.ts` |
| Spiral conch | `conch` | uncommon | 0.1–0.35 | 3 | tumble | `src/render/objects.ts` |
| Golden sand dollar | `sanddollar` | uncommon | 0.32–0.85 | 2 | tumble | `src/render/objects.ts` |
| Sunset starfish | `starfish` | rare | 0.08–0.26 | 3 | tumble | `src/render/objects.ts` |
| Green bottle | `bottle` | rare | 0.22–0.45 | 2 | float | `src/render/objects.ts` |
| Nautilus | `nautilus` | unique | 0.12–0.3 | 3 | tumble | `src/render/objects.ts` |

The Golden sand dollar is giant: it starts at twice the largest regular
sand dollar (0.32 m) and scales up from there.

### Week 2 — "Beach day" (from Mon 2026-11-30)

A mixed set: three new items can't fill all four tiers, so Week 1 items
fill the gaps — the 3/2/2/1 shape is the same as Week 1 (see
[docs/VENDING_MACHINE.md](VENDING_MACHINE.md)). Sunset starfish sits
this week out.

| Tier | Items |
|---|---|
| Common | Beach ball, Blue sea glass, Pebble |
| Uncommon | Sandals, Spiral conch |
| Rare | Bucket, Green bottle |
| Unique | Nautilus |

| Item | Kind | Rarity | Size (m) | Variants | Behaviour | Mesh |
|---|---|---|---|---|---|---|
| Beach ball | `beachball` | common | 0.25–0.6 | 3 | float | `src/render/objects.ts` |
| Sandals | `sandals` | uncommon | 0.15–0.35 | 2 | tumble | `src/render/objects.ts` |
| Bucket | `bucket` | rare | 0.2–0.4 | 2 | fixed | `src/render/objects.ts` |

The beach ball floats like driftwood (its draft is about a third of its
radius); the sandals tumble in the swash like shells; the bucket stands
upright where you put it. Each is the only item of its kind, so the kind
palette is its look — no `ITEM_LOOKS` entry — and the ball's stripes
alternate a bright colour (red, blue or yellow by variant) with white.

## Shop

Centrepieces sold individually (`server/src/products.ts`, prices in
`docs/PRICING.md`). All fixed size, behaviour `fixed`, and one variant
except the deckchair, which has three. Meshes are in `src/render/storeMeshes.ts`.

| Item | Kind | Rarity | Product | US price |
|---|---|---|---|---|
| Deckchair | `deckchair` | rare | `item_deckchair` | $0.99 |
| Parasol | `parasol` | rare | `item_parasol` | $0.99 |
| Surfboard | `surfboard` | rare | `item_surfboard` | $1.49 |
| Tiki torch | `tikitorch` | rare | `item_tikitorch` | $1.49 (a pair) |
| Sandcastle | `sandcastle` | legendary | `item_sandcastle` | $1.99 |
| Beach hut | `beachhut` | legendary | `item_beachhut` | $2.99 |
| Lighthouse | `lighthouse` | legendary | `item_lighthouse` | $2.99 |
| Palm tree | `palmtree` | legendary | `item_palmtree` | $2.99 |
| Lifeguard tower | `lifeguardtower` | legendary | `item_lifeguardtower` | $2.99 |
| Bonfire | `bonfire` | rare | `item_bonfire` | $1.49 |
| Hammock | `hammock` | rare | `item_hammock` | $1.49 |
| Beach towel | `towel` | rare | `item_towel` | $0.99 |

The palm tree is the tallest of the five new centrepieces; the
bonfire's flame glows at night like the tiki torch's. Each is the only
item of its kind, so the kind palette is its look — no `ITEM_LOOKS`
entry.

## Extras

Things you own that aren't placed on the sand: **Extra beach**
(`EXTRAS` in `src/world/items.ts`) — a whole second beach of your own.

Not here: the sandcastle mini-game stays a backlog to-do
(`docs/BACKLOG.md`) — it is not an item.

## Renders

Sample renders for QA, made with `scripts/render-items.mjs` (headless
Chromium, day light, seed 1; the script places every catalog item on dry
sand, pauses the sea, and shoots the whole beach plus a close-up each):

- [Full beach](items/renders/full-beach.png) — every item in rows.
- [Contact sheet](items/renders/contact-sheet.png) — every item, labelled.
- Per item: `items/renders/<item-id>.png` (e.g.
  [pink-shell](items/renders/pink-shell.png)).

Regenerate individual renders when an item's look changes with
`node scripts/render-items.mjs --only <id,...>`. Run without `--only` to
refresh the full beach and contact sheet after adding items.

## Adding an item

For community assets, see [Community item submissions](ITEM_SUBMISSIONS.md).

`tests/items.test.ts` checks the catalog, pools and products.
`tests/specialItems.test.ts` checks distinct item finishes and matching
shore-picture colours.

1. **Catalog** — a row in `ITEMS` (`src/world/items.ts`): id, name,
   kind, rarity, source (`free` / `shop` / `pull`), `unlimited`,
   size range, variants, `fixedSize` for fixed-size pieces, `product`
   for shop items.
2. **Kind** (only for a genuinely new object) — `ObjectKind` +
   `OBJECT_KINDS` + `BEHAVIOUR` in `src/sim/objects.ts`, with a comment
   saying how the sea treats it (`rock` | `float` | `tumble` |
   `fixed`). A new id on a familiar kind needs none of this.
3. **Mesh** — small items in `src/render/objects.ts` (helpers in
   `src/render/meshKit.ts`); big shop pieces in
   `src/render/storeMeshes.ts` (`STORE_BUILDERS` + `STORE_REACH`).
4. **Colours** — `PROP_COLORS` in `src/palette.ts`, one entry per kind;
   a prize that shares a kind gets its own `ITEM_LOOKS` (colours,
   `gloss`, optional `glow`).
5. **Icon** — `ICONS` in `src/ui/hud.ts`, plus a tint in
   `ITEM_ICON_TINT` for prize items.
6. **Shore pictures** — `server/src/beachImage.ts` (`ITEM_COLORS` /
   `SHELLS`) so the item draws distinctly there too.
7. **Where it comes from** — pool in `server/src/pulls.ts`, set in
   `server/src/vending.ts`, product in `server/src/products.ts`, or
   wash-in in `src/sim/objects.ts` (`washIn`). Prize display names in
   `server/src/prizeNames.ts`.
8. **Guide mirrors** — the guide (`server/src/guide.ts`) can't import
   the catalog (the production image only copies `server/src`), so the
   per-item facts it can't derive live mirrored in
   `server/src/prizeNames.ts`. Only add what's missing, and only where
   the guide can't derive it: a name in `PRIZE_NAMES` unless the id
   already reads as the name (single-word ids do); a rarity in
   `ITEM_RARITY` unless the item is drawn from a pool or set or is a
   common free item; a kind in `KIND_OVERRIDES` unless the kind is the
   id; a glow in `GLOW_ITEMS` only if `ITEM_LOOKS` gives it one; a
   behaviour in `KIND_BEHAVIOUR` only for a genuinely new kind; a
   wash-in in `WASH_ASHORE_ITEMS` (`server/src/guide.ts`) only if the
   sea brings it in. `tests/items.test.ts` keeps every mirror in step
   with the catalog — a missing mirror fails the tests — and
   `server/test/guide.test.ts` renders the guide and checks every item
   is listed in its group.
9. **Docs** — the tables above, `docs/BACKLOG.md` (move the line to
   Done with the PR number), `docs/STATUS.md`, the guide in
   `server/src/guide.ts` where behaviour changes, and a plain-words
   line in `server/src/releaseNotes.ts` for anything a player can
   notice.
10. **Renders** — `node scripts/render-items.mjs --only <id,...>`,
   checked by eye before committing: recognizable, correctly
   coloured, right-side up, distinct from its same-kind neighbours.

## Design rules

- **Special items look different — and better — than the free items
  they share a kind with.** A prize sharing a kind with a free (or
  cheaper) item gets its own colours and finish in `ITEM_LOOKS`, never
  just the kind palette. Items sharing a kind resolve to disjoint
  colours, and all but one per kind carries its own look
  (`tests/specialItems.test.ts` enforces both).
- **Free shells are never pink.** Pink is reserved for the pink shell.
- **Free sand dollars are never gold.** Gold is reserved for the
  golden sand dollar (gloss 1, gold glow).
- **Every `ITEM_LOOKS` entry needs `gloss > 0` and at least 2
  colours**, and its colours must match `server/src/beachImage.ts`
  exactly.
- **Pool and set items must be `source: 'pull'` with the matching
  rarity**, and every shop item must have a product that grants it
  (`tests/items.test.ts`).
- **Prices** follow `docs/PRICING.md`: rare $0.99–1.49, legendary
  $1.99–2.99, standard store price points.
