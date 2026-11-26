# beechshore.com: the public shore

Status: **built** (2026-11-23).

A public website of every beach on the shore. Browse beaches without an
account or JavaScript. Shared beach links preview in text messages,
WhatsApp, X, Slack and iMessage. Beech players can also submit items for
review from the shore.

## What's on it

| URL | What |
|---|---|
| `/` | The best beach's picture, then most loved, rising this week, just built, and beaches by real place. Share buttons for the site. |
| `/top`, `/rising`, `/new` | The lists, 24 a page (`?page=2`). Same scoring as the in-game leaderboard (BACKEND.md, "Leaderboard"). |
| `/at/bondi` (any place id) | Beaches built at one real beach. |
| `/find?q=...` | Jump straight to a 6-letter beach code, or search public beaches by beach or owner name. |
| `/random` | A random beach ("Walk the shore", "Surprise me"). |
| `/K7F2QX` | One beach: its picture (with a Flat / 3D / From the sea switch — see below), owner, place, stars, neighbors, **Visit in beech →** (`GAME_URL/?visit=K7F2QX`), a **Share & Snapshot Studio** (`#share`: live Postcard, Square, Story, and Clean PNG snapshots with Web Share file attachment, clipboard image copy, PNG download, editable caption, and direct buttons for X, Bluesky, Threads, Reddit, WhatsApp, Facebook, and Text), and the stretch of shore either side (← → to walk). |
| `/img/K7F2QX.png` | The beach's 1200×630 card, used as `og:image` (also by the game's own `?visit=` links). |
| `/img/K7F2QX/thumb.png` | 480×300 thumbnail. |
| `/img/K7F2QX/iso.png` | The beach in 3D, 1200×630: an isometric view from the land, looking out toward the sea — the real heightfield, water below sea level, things standing on the sand — with one public beach either side (linked flush at 32 m, unlinked keeping the 1.6 m gap; no public neighbor on a side means no shore there at all). Only public beaches ever appear. |
| `/img/K7F2QX/iso-ocean.png` | The same beach in 3D from the other direction, 1200×630: camera offshore and elevated, looking landward — sea in the foreground, beach rising away. The walk-left/right neighbours mirror: a neighbour on the picture's left here is on the right in the land view. Only public beaches ever appear. |
| `/img/shore.png` | The site card (an untouched beach). |
| `/submit` | Connect a Beech account, upload an item with a proposed price and frequency, and see your review status and creator credits. |
| `/submit/spec` | Asset requirements, prompt example, JSON Schema and example file for creators and AI agents. |
| `/items` | Every item in the game, grouped by how you get it, with vote counts. |
| `/items/<id>` | One item: its picture, rarity, size, how to get it, price, votes and comments. Sign in (the same Beech account connection as `/submit`) to vote or comment. |
| `/account` | Your account: connect your Beech account, then your sand dollars (S$) and their history, top up by card, redeem a gift card, gift a thing from your bag, and your invite link. Not cached, not indexed. See [SAND_BUCKS.md](SAND_BUCKS.md), "Your account on beechshore". |
| `/items/img/<id>.png` | The item's 400×400 render, copied from `docs/items/renders/` into `public/items/` (see `docs/ITEMS.md`). |
| `/robots.txt`, `/sitemap.xml` | For search engines (up to 5000 beach pages, plus the item pages). |

Beach links are the shortest thing that works: `beechshore.com/K7F2QX`, the
beach's code. Lower case redirects to upper case.

## Who and what is public

Only beaches that are **on the shore and saved** (`on_shore AND sand IS NOT
NULL`, `isPublic` in `server/src/shore.ts`) appear: in lists, pictures,
the walk along the shore, the sitemap. The page shows the owner's first name,
the beach's name, its real place, stars and the picture. This is what every
signed-in player could already see on the global shore; the site makes it
visible to anyone. The store privacy forms and the privacy policy must say
the first name and beach are **public**, not only "visible to other users".

A beach kept off the shore (by its owner, or hidden by an admin) has no
picture and no page here. Its link (`/CODE`) redirects to the game's
`?visit=CODE` link, so a link its owner shared on purpose still works; the
game asks for sign-in, as visiting by code always has. Only a code that names
no beach at all is a 404 ("Washed away").

## How it's served

The game's own server (`beech` on Cloud Run) serves it; no new service.
`server/src/rootApp.ts` checks the `Host` header:

- `SHORE_HOSTS` (default `beechshore.com,www.beechshore.com`): the whole
  host is the shore site. `www` and any other alias 301 to `SHORE_URL`. The
  game API is not served there.
- Every other host: the site lives under `/shore` (for example
  `https://play.beech.games/shore/K7F2QX`). This works before the domain
  does, and locally: `npm run server:dev`, then http://localhost:8787/shore.

Environment (server.ts): `SHORE_URL` (default `https://beechshore.com`),
`SHORE_HOSTS`, `GAME_URL` (default `https://play.beech.games`). The web
build reads `VITE_SHORE_URL` (default `https://beechshore.com`) for the
links it shares.

Pages are cached for 60 s (`Cache-Control: public`). Image URLs carry the
beach's save time (`?v=`), so they're cached for a year and change when the
beach does; the server keeps the 64 most recent pictures in memory.

See [Community item submissions](ITEM_SUBMISSIONS.md) for the review, catalog release, and credit workflow.

## The pictures

`server/src/beachImage.ts` draws a saved beach top-down with no canvas or
fonts: the untouched beach shape plus the saved sand, water below sea level,
swell lines, waterline lace, relief shading, and each thing on the beach as a
small shape with a shadow. The sea is at the top, as you'd see it standing on
the sand, so a left neighbor is on the left. The shore carries on, faded,
past the beach's edges. Colours follow the beach's real place. It encodes PNG
with `node:zlib` (about 300 KB a card, 90 KB a thumbnail; a few tens of ms).

The beach shape, day palette and place tints are copies of the app's;
`tests/beachImage.test.ts` fails if they drift.

**The 3D views** (`renderIsoBeach`/`beachIsoPng`, same file) draw the same
saved beach as an isometric diorama from either side: the real heightfield
(rest profile + saved sand deltas), water as a flat surface below sea
level with swell lines and waterline lace, sand with a slow grain so even
a dark sand reads as sand, and things as vertical billboards (tall kinds)
or flat ground marks, so a lighthouse or parasol stands up instead of
lying flat. Billboards are drawn at the ground scale, so a sandcastle
reads at the same size relative to the beach whatever the frame fits.
`iso.png` is the land-side view, camera on the land looking out toward
the sea; `iso-ocean.png` is the reverse, camera offshore and elevated,
looking landward — sea in the foreground, beach rising away — and is the
fancy hero angle. From the sea the picture is mirrored alongshore so the
walk-left neighbor (+x) is on the picture's left, matching the top-down
card and the beach-page strip; from the land the neighbours appear on the
opposite sides, because you are looking from the other direction. One
public beach shows on each side — linked flush at 32 m, unlinked keeping
the 1.6 m gap of untouched shore — and the frame fits the centre beach
plus a 4 m sliver of each neighbour, so the beach being shared is the
subject instead of a thin strip in a void; a side with no public neighbor shows no shore
at all, with no faded empty-shore filler. A non-public neighbor never
appears: the route only ever fetches neighbours through `shoreGraph.walk`
with `keep=isPublic`, and the cache key carries the neighbours' save
times. The beach page has three small buttons on the hero picture — Flat,
3D, From the sea — that swap the image in place (no reload); they change
no URL, og tag, or share link, and `og:image` stays the top-down card.
First render is around 100 ms (1200×630, ~15k terrain quads) and cached
like the card; samples in `docs/shore-iso-sample.png` (ocean) and
`docs/shore-iso-land-sample.png` (land), re-rendered from a constructed
player-like beach by `server/scripts/render-iso-samples.ts`.

**Piers** ([PIERS.md](PIERS.md)): a beach whose pier shows (the derived
`pier` flag, so a paused pier doesn't) gets it in every picture. From
above (`drawPierTop`): the deck, the wider end platform and the ramp with
its planks and rails, and the deck's shadow. In the 3D views
(`pierPieces`/`drawPierPiece`): the same boxes as the app's pier
(`pierBoxes`: pilings, deck, ramp, rails), cut into the terrain's 0.5 m
cells so they paint back to front with everything else; each piece draws
only the faces turned toward the camera, and pilings stop at the water or
the sand. A neighbour's pier shows on the neighbour. `PIER` and the
colours are copies of the app's; `tests/beachImage.test.ts` keeps them in
step. Placing, removing or pausing a pier changes the pictures without a
save, so every picture URL's `?v=` is `imageVersion(save time, pier)`
(`server/src/shore.ts`): a `p` on the end when it shows, for the beach and
for each neighbour in the 3D views' key.

The top-down card is exactly the beach edge to edge: the 32 m beach is
stretched alongshore to fill the 1200 px width (37.5 px/m alongshore,
30.7 px/m cross-shore), so there are no pale bands of empty shore
flanking it. Things keep their size and shape, but terrain features
stretch 1.22× horizontally — a dug moat reads as an ellipse rather than a
circle — so nothing at the back of the beach is cropped out of the card.
Before/after in `docs/shore-card-before.png` and `docs/shore-card-after.png`.

## Cross links

- **Game → shore:** a share button (bottom left, accounts builds) shares the
  beach under the view, or yours, as a beechshore link through the share
  sheet (native apps: `@capacitor/share`; browsers: `navigator.share`; else
  it copies). Settings → your code: **share** (beechshore link), **game
  link** (copies `?visit=`), and "see it on beechshore ↗". The leaderboard
  links to `/top`. Opening a `?visit=` link signed out opens that public beach
  in the game right away, in read-only 3D.
- **Shore → game:** "Visit in beech" and "Copy to my beach" (`?visit=CODE&copy=1`, docs/COPY_BEACH.md; the page also shows "copied N times" and "Copied from …") on every beach, "Build a beach" in the
  header, "Make one of your own" under each beach, "Play beech" in the footer.
  The footer also links the Discord server for feedback, bug reports and
  ideas (invite URL in `server/src/community.ts` — the server's permanent
  invite).
- **Game links preview too:** `?visit=` pages now carry the beach's card as
  `og:image` when it's on the shore (`server/src/shareMeta.ts`).

## Turning on the domain (owner)

1. Deploy (the code is in the `beech` service already; `/shore` works now).
2. Map the domain to the `beech` service:
   `terraform apply -var shore_custom_domain=beechshore.com` (or
   `gcloud beta run domain-mappings create --service beech --domain beechshore.com --region $REGION`),
   which creates both the apex and the `www.beechshore.com` mappings
   (`google_cloud_run_domain_mapping.shore` and `.shore_www`).
3. Add the DNS records the mappings print at the registrar.

Nothing else changes: the server already answers to those hosts.

## Not done yet

- PR #40 (Discord links) is a draft until the invite is confirmed: it now
  carries the server's permanent invite
  (`https://discord.gg/y7EGw2yg2d`) in `server/src/community.ts`.
- Stars on the site itself (it has no accounts; starring stays in the game).

## Follow-ups built (2026-11-24)

- **Read-only 3D visit without signing in:** opening `?visit=CODE` signed out
  opens a public beach directly in 3D via `/api/public/shore`,
  `/api/public/shore/more` and `/api/public/beaches/:code` (strictly
  `isPublic`; off-shore beaches still return 404 and wait for sign-in).
- **Signed-out shore at home:** without signing in, the game loads public
  sections of the shore around your local-only beach — `GET /api/public/shore`
  with no code anchors on the top public beach and walks both directions — so
  the beaches either side show in 3D, the whole public world is a scroll away,
  and the settings sheet lists the beaches along it to visit. Signing in there
  saves your beach.
- **Indexes at scale:** migration 17 adds partial indexes on
  `beach (updated_at DESC, id)` and `beach (location, updated_at DESC, id)`
  `WHERE on_shore AND sand IS NOT NULL`.
- **Image drawing rate limits:** uncached PNG draws on `/img/:CODE.png`,
  `/img/:CODE/thumb.png`, `/img/:CODE/iso.png`, and `/img/:CODE/iso-ocean.png` are limited to 60 per
  minute per client IP (`429` with `Retry-After: 60`); cache hits are not
  limited. The 3D view's cache key carries the neighbours' save times too, so
  a neighbour rebuilding changes the picture. Every key also carries
  whether each beach's pier shows (`imageVersion`).
