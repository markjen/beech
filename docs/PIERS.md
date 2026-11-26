# Piers

Status is **built** (2026-11-26) in the account-enabled game.

Link three beaches you own side by side to unlock a pier on the middle
beach. Buy it for sand bucks, preview it from the beach, then choose **Place
pier** to run a wooden deck straight from the sand out over the water.

```text
             Left beach          Middle beach         Right beach
           ┌──────────────┬────────────────────┬──────────────┐
     Sand  │              │       ║ ramp       │              │
Shoreline  ├──────────────┼───────╫────────────┼──────────────┤
    Water  │              │       ║ deck       │              │
           │              │      ╚╩╝ end       │              │
           └──────────────┴────────────────────┴──────────────┘
                                     ↓ seaward
```

## Unlock and placement

- The server checks for two distinct beaches directly linked to the target,
  one on each side, all owned by the same player. The order is the in-game
  shore order. Only established links to your other beaches count.
- Every interior beach of a longer owned stretch qualifies independently.
  With A–B–C–D, B and C qualify and each can hold one pier.
- In **Your beaches on the shore**, the eligible beach offers **Buy pier**
  or **Place pier** when the player already has a spare. An attached pier
  offers **Remove pier**. A dormant pier has the status **Pier paused**
  and can still be removed. With a pier in the bag but no eligible beach
  (e.g. only two beaches, which can never form a trio), the section shows
  the pier in the bag and the unlock rule instead of hiding it. Put the
  unlock rule in the player guide.
- The pier is a shop offer (`item_pier`, **30 sand bucks**, the $2.99
  tier; see [SAND_BUCKS.md](SAND_BUCKS.md)) that adds one `pier` to the
  bag. It's bought like any other offer (`POST /store/buy`, one statement),
  so there is no pending checkout to track: real money only ever buys
  packs. **Buy pier** in the beach list buys it and opens the preview;
  short of sand bucks, the shop opens at the packs. The pier stays in the
  bag until the player confirms placement. If the player cancels the
  preview, they can come back later. Each additional placement needs
  another copy. It can also be bought from the shop itself, and traded in
  or given away while it's in the bag (not while it's on a beach).
- The preview frames the middle beach and shows the whole deck. The pier
  has one fixed position and orientation. Show **Place pier** and **Cancel**
  together so a player can inspect it before changing their beach.

## What the pier looks like

- Start with an 18 m by 2.5 m weathered-timber deck, centered at local
  alongshore X = 0. It runs from 21 m to 3 m from the offshore edge
  (world Z = +5 to −13 on a centered 32 m beach). A short ramp starts
  on dry sand and roughly 13 m of deck extends beyond the still-water
  shoreline. Tune the ramp and deck heights against the rest profile,
  high tide and the strongest waves.
- Use paired pilings, simple rails and a slightly wider end platform.
  Waves and foam pass between the pilings. The pier stays fixed during
  tides and digging. Players can pick up and move any decorations
  that overlap the ramp.
- Show the same structure in the diorama, chair view and visitor view.
  Version one is decorative.

## When the stretch changes

| Event | Result |
| --- | --- |
| One supporting link is removed or an outer beach is deleted | The attached pier goes dormant and disappears from owner and visitor views. The player can leave it attached or return it to the bag. |
| The same middle beach qualifies again | Its attached pier reappears, including if a different owned beach fills the missing side. |
| The player removes the pier or deletes its middle beach | That pier returns to the bag and can be placed at another eligible site. |
| A link changes between buying and placing | The pier stays in the bag. Placement checks the current links and can wait until a site qualifies. |
| The pier is traded in or given away | Only a pier in the bag (owned minus placed) can go. A placed one has to be removed first. |
| A sand-buck pack is refunded | The sand bucks are clawed back ([SAND_BUCKS.md](SAND_BUCKS.md)); the pier stays, like any other thing bought with them. |

## State machine

[Piers.tla](../specs/tla/Piers.tla) models the link graph, the number of
piers the player owns and the attachments. Attachments are counted against
what's owned (the bag shows owned minus placed), not tied to one purchase:
with sand bucks, a pier is one bag unit like any other. The server derives
visibility from the attachment and the current shore links; a dormant
attachment still occupies its beach's pier slot. Attachments live in
`beach_piers (beach_id PK, owner_id, placed_at)`, apart from the beach's
sand and checkpoints, so a restore or a copy never touches them.

Placement checks eligibility, the beach's vacancy and the bag, and inserts
the row, in one transaction holding the player's lock (`asEditor`), the
beach row, and its two neighbor links and the beaches on them (`FOR
SHARE`), so an unlink or a deletion of a supporting beach waits for it
(`PlacementWasEligible`). Trade-ins and gifts count placed piers under the
same player lock (`PaidAttachment`). The `pier` flag in owner and visitor
shore data is derived in SQL (`PIER_SHOWN` in `server/src/shore.ts`), so
there's nothing stored to invalidate. The beechshore.com pictures draw the
pier (top-down and both 3D views, `server/src/beachImage.ts`), and their
cached-for-good URLs carry it in `?v=` (`imageVersion`), so placing,
removing or pausing one gives new pictures ([SHORE_SITE.md](SHORE_SITE.md#the-pictures)). The route mapping is in
[State machines](STATE_MACHINES.md#piers-pierstla).

## Code

- Server: `server/src/app.ts` (`PUT`/`DELETE /beaches/mine/:id/pier`,
  `pierCounts`, the pier lines in `itemsElsewhere` and `giveOne`),
  `server/src/shore.ts` (`PIER_SITE`, `PIER_SHOWN`), migration 34.
- Tests: `server/test/stateMachines/piers.test.ts` (transitions, both TLC
  replays, a random walk against `piersModel.ts`), `tests/pier.test.ts`
  (the shape against the beach profile), `npm run e2e:piers`.
- App: `src/render/pier.ts` (the mesh, `PIER` in `src/config.ts`, colours in
  `src/palette.ts`), drawn for every beach in view by `NeighborView`;
  `src/ui/accountPanel.ts` (the rows under your stretches),
  `src/ui/pierPreview.ts` (place pier / cancel).

## Release checks

All of these are covered by the state-machine tests and `e2e:piers`,
except the high/low tide silhouette, which was checked by eye at the
default tide only.

- Test isolated and two-beach accounts, an eligible trio, a trio with a
  foreign neighbor and two eligible centers on a longer stretch.
- Test payment confirmation after unlink, concurrent placement requests,
  a stale placement request after unlink, duplicate payment
  notifications, refund, and removal or deletion of the middle beach.
- Check the land-to-water silhouette from both cameras at high and low
  tide. Verify that the same pier appears on a second device and to a
  visitor, and disappears from both when the link breaks.
