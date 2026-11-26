# Piers

Status is **designed**. Target the account-enabled game.

Link three beaches you own side by side to unlock a pier on the middle
beach. Buy it in the shop, preview it from the beach, then choose **Place
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
  and can still be removed. Put the unlock rule in the player guide.
- The shop uses a one-time purchase that adds one pier to the bag. Proposed
  US price is **$2.99**. Checkout remembers the
  beach to return to and leaves the pier in the bag until the player
  confirms placement. If the player cancels the preview, they can come
  back later. Each additional placement needs another copy.
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
| A link changes during checkout | A confirmed payment still grants the pier. Placement checks the current links and can wait until a site qualifies. |
| A purchase is refunded | Revoke the specific pier from that purchase and clear its attachment if it has one. Other copies stay available. |

## State machine

[Piers.tla](../specs/tla/Piers.tla) models the link graph, two independent
orders and the attachments. An attachment refers to one paid entitlement
and one beach. The server derives visibility from the attachment, current
entitlement and current shore links. A dormant attachment still occupies
its beach's pier slot. Store attachments alongside beach metadata so the
account owns the pier independently of the beach's sand and checkpoints.

Check eligibility and write the checkout authorization or placement under
the same account lock that protects changes to eligible links. Fulfill each
verified purchase once using the existing receipt or order identity.
Serialize refunds and placement against that identity. Include a boolean
for active pier visibility in owner and visitor shore data. Invalidate
cached shore metadata and any public images
that draw the pier when its visibility changes. See the proposed route
mapping in [State machines](STATE_MACHINES.md#piers-pierstla).

## Release checks

- Test isolated and two-beach accounts, an eligible trio, a trio with a
  foreign neighbor and two eligible centers on a longer stretch.
- Test payment confirmation after unlink, concurrent placement requests,
  a stale placement request after unlink, duplicate payment
  notifications, refund, and removal or deletion of the middle beach.
- Check the land-to-water silhouette from both cameras at high and low
  tide. Verify that the same pier appears on a second device and to a
  visitor, and disappears from both when the link breaks.
