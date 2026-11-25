# More than one beach (design)

Status: **built** (server: migration 7, `/api/beaches/mine…`; app: "your beaches" in settings; the client keeps every beach's state by id and the waves follow the view, docs/BEACH_STORE.md). Buying extra beaches: see PRICING.md / the shop. The extra-beach prize from the claw machine
already exists (inventory item `beach`), so people will own beaches before
they can lay them out. This doc is the plan for using them.

## What people get

- **Several beaches of their own.** Everyone starts with one, the *home
  beach*. Each extra beach is a whole 32 × 32 m beach. It can be at a
  different real-world place (Bondi sun and tides on one, Brighton on
  another). It has its own name, its own sand and things, and its own code.
- **Connected or separate, per beach.**
  - *Connected*: your beaches sit side by side as one stretch of shore. You
    walk from one into the next, and neighbors join at the two ends. Linking
    two of your own beaches needs no request, because you're both sides.
  - *Separate*: a beach stands on its own anywhere on the global shore, with
    its own left and right neighbors (the usual ask and accept).
  - You can change your mind any time: "connect to my Bondi beach", "move
    this one away".
- **Any of your beaches can be live, at the same time, on different
  devices.** Each device runs the simulation for the beach it's showing
  (chosen per device), so a phone can watch Bondi while a tablet or TV
  watches Brighton. Each beach saves on its own. On one device, your other
  beaches show as snapshots like neighbors do, until you open one there.
- **Several places on the beachfront.** Each beach has its own neighbors, so
  you can be in more than one beachfront, or at more than one spot in the
  same one (home - Gus - your second beach).
- **The bag is shared.** Items belong to the person, not the beach. A
  prize you own once can be on one of your beaches at a time (see "Items
  across beaches").

## How people get beaches

| Source | Notes |
|---|---|
| Claw machine starter gift | One extra beach on the first go a day after your first go. Already live: an `inventory` row with `item_id = 'beach'`, `source = 'pull'`. |
| Shop | The main way. A store in-app purchase on iOS and Android, Stripe on the web. Apple and Google require their own billing for digital goods in the apps. |
| Events, gifts | Later. A free beach for an anniversary, or a beach given to a friend. |

**Allowance** = 1 + the extra-beach items you own (summed `quantity` of
unexpired `beach` rows). Making a beach doesn't use one up. You can't have
more beaches than your allowance. If the allowance drops (a refund), the
newest beaches go read-only and off the shore until it's back. Nothing is
deleted.

**Suggested cap:** 8 beaches per person at first. That bounds storage
(saves are a few KB to ~100 KB each) and keeps the shore varied.

## Data model

Today a beach *is* a user: `beaches.user_id` is the primary key, and
neighbor links, requests, favorites and codes are all per user. The change
makes the beach the unit and the user the owner.

```sql
-- migration N (append-only, like the others)
CREATE TABLE beach (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,            -- what neighbors and visitors use
  name TEXT NOT NULL DEFAULT '',        -- "Home", "Bondi", …
  home BOOLEAN NOT NULL DEFAULT false,  -- exactly one per owner
  on_shore BOOLEAN NOT NULL DEFAULT true, -- false: only by code (privacy)
  location TEXT NOT NULL,
  nx INTEGER, ny INTEGER, version INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT, sand BYTEA,        -- null until first save
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX beach_one_home ON beach (owner_id) WHERE home;
```

- **Existing data:** each user's row in `beaches` becomes their home
  `beach`, keeping `users.neighbor_code` as its code. Users with no save
  get a home beach with no sand.
- **Links, requests, favorites** move from user ids to beach ids:
  `neighbors(beach_id, side, neighbor_beach_id)` (unique on
  `(neighbor_beach_id, side)` as now), `neighbor_requests(from_beach,
  to_beach, side)`, `favorites(user_id, beach_id)`. The migration maps
  each user id to that user's home beach.
- **Same owner, no request:** linking two beaches with the same `owner_id`
  writes both rows straight away (the same single statement as accepting).
- **The global shore** walks beaches, not users. A stretch's place in the
  ring is ordered by its right-hand end beach's `created_at`, as today.
- **Keep `beaches` for one release** as a read-only copy (the old app
  versions in the stores still call `/api/beach`). Drop it in a later
  migration.

## API

Backwards compatible: the current endpoints act on your **home** beach, so
older app versions keep working.

| | |
|---|---|
| `GET /api/beaches/mine` | `{ allowance, beaches: [{ id, code, name, home, onShore, location, updatedAt, links: { left, right } }] }` |
| `POST /api/beaches/mine { name, location }` | make a beach (409 at the allowance) |
| `PATCH /api/beaches/mine/:id { name?, location?, onShore?, home? }` | rename, move to another real place, hide from the shore, make it home |
| `DELETE /api/beaches/mine/:id` | remove it (not the home beach). The allowance comes back, so making another is free |
| `GET`/`PUT /api/beaches/mine/:id/sand` | load and save that beach (same bytes and headers as `/api/beach`) |
| `PUT /api/beaches/mine/:id/link/:side { code }` | connect: your own beach links at once; anyone else's becomes a request, as today |
| `/api/neighbors…` | gains an optional `?beach=<id>` (default: home) |

## App

- **Beaches list** in settings, under the account section: each beach with
  its name, place and links. Actions: "go there", rename, place, "on the
  shore" toggle, connect, remove. Plus "+ new beach" when you're under your
  allowance (or a shop link when you're not).
- **Going to a beach** saves the live beach (`BeachSync.flush`), then loads
  the other into the worker (`setSand` with its objects). The shore view
  moves so that beach is in the middle (as `visit()` does today, but
  editable). The shore bar shows its name. "⌂ my beach" goes to the home
  beach.
- **Walking across connected beaches** (chair view or panning): when the
  view settles on one of your other beaches for about a second, it becomes
  the live one, with a small "Now on Bondi" toast. Your beaches show a
  little "yours" mark on their name tags.
- **BeachSync** keys everything by beach id (it saves the live beach). The
  worker still runs one simulation.
- **Sandbox build (Pages):** unchanged, one local beach and no accounts.

## Items across beaches

Today the bag limits a prize to "as many on the sand as you own", counted
from the live sim. With several beaches the count has to span them all:

- The server counts how many of each non-free item are on a beach from
  each save's objects and keeps it on `beach.items` (JSONB). (The app still
  sends `X-Beach-Items`; the server ignores it since 2026-11-25.)
- The bag's "N of M left" uses the server's totals for your other beaches
  plus the live beach's own count.
- If you're over (an item was refunded, say), nothing disappears. You just
  can't put down more until you're under.

## Buying (with Muse)

- **One product, consumable:** `extra_beach`. Each purchase adds one
  `inventory` row (`item_id = 'beach'`, `source = 'shop'`). The server
  checks the receipt before writing it: App Store Server API, Google Play
  Developer API, or a Stripe webhook. Store a transaction id per row so a
  receipt can't be used twice.
- **Refunds:** App Store Server Notifications, Play real-time developer
  notifications and Stripe events set `expires_at = now` on the row. That
  lowers the allowance (see above).
- **Store forms:** in-app purchases now exist. That's a Data safety and App
  Privacy update, plus a price tier in each store.
- **Odds rules don't apply to this product.** A beach bought outright isn't
  a random item.

## Privacy

Each beach has `on_shore`. Off-shore beaches are reachable only by code or
as someone's linked neighbor. This also covers the existing backlog item
"keep my beach off the shore" for the home beach.

## Phases

1. **Data model and API.** Migration, compatibility (`/api/beach` = home),
   server tests, and e2e still passing with one beach each. No visible
   change.
2. **Beaches list, make and go to a beach.** Separate beaches only.
   Allowance from the claw prize. E2e: win a beach (with the test clock),
   make it, dig on it, go home, come back.
3. **Connected beaches.** Link your own without a request. Walking across
   makes the next one live. Item counts across beaches.
4. **Shop.** Receipts, refunds, store listings (Muse).

## Decisions for the owner

- **Price** of an extra beach, and whether to sell bundles (2 or 5).
- **Cap** per person (8 suggested).
- Does **removing** a beach give the allowance back? (Suggested: yes. It's
  space, not a consumable.)
- **Gifting** a beach to someone else: now, later, or never?
- Should a **connected stretch of your own beaches** count as one entry for
  neighbor requests? Today people link to one specific beach. Suggested: keep
  it per beach; it's simpler and clearer.
