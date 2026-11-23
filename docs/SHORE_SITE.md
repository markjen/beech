# beechshore.com: the public shore

Status: **built** (2026-11-23).

A public, read-only website of every beach on the shore. No account, no
JavaScript needed to read it, and every page previews well when its link is
pasted into a text, WhatsApp, X, Slack or iMessage. It is the place people
land from a shared link, and it sends them on into the game.

## What's on it

| URL | What |
|---|---|
| `/` | The best beach's picture, then most loved, rising this week, just built, and beaches by real place. Share buttons for the site. |
| `/top`, `/rising`, `/new` | The lists, 24 a page (`?page=2`). Same scoring as the in-game leaderboard (BACKEND.md, "Leaderboard"). |
| `/at/bondi` (any place id) | Beaches built at one real beach. |
| `/random` | A random beach ("Walk the shore", "Surprise me"). |
| `/K7F2QX` | One beach: its picture, owner, place, stars, neighbors, the stretch of shore either side (← → to walk), **Visit in beech →** (`GAME_URL/?visit=K7F2QX`), and share buttons (share sheet, Text, WhatsApp, X, Facebook, copy). |
| `/img/K7F2QX.png` | The beach's 1200×630 card, used as `og:image` (also by the game's own `?visit=` links). |
| `/img/K7F2QX/thumb.png` | 480×300 thumbnail. |
| `/img/shore.png` | The site card (an untouched beach). |
| `/robots.txt`, `/sitemap.xml` | For search engines (up to 5000 beach pages). |

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

## Cross links

- **Game → shore:** a share button (bottom left, accounts builds) shares the
  beach under the view, or yours, as a beechshore link through the share
  sheet (native apps: `@capacitor/share`; browsers: `navigator.share`; else
  it copies). Settings → your code: **share** (beechshore link), **game
  link** (copies `?visit=`), and "see it on beechshore ↗". The leaderboard
  links to `/top`. Opening a `?visit=` link signed out says to sign in and
  offers "see it now" on beechshore.
- **Shore → game:** "Visit in beech" on every beach, "Build a beach" in the
  header, "Make one of your own" under each beach, "Play beech" in the footer.
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

- An index on `beach (updated_at) WHERE on_shore AND sand IS NOT NULL` once
  there are many thousands of beaches; the lists scan today.
- Stars on the site itself (it has no accounts; starring stays in the game).
- A 3D view in the browser without signing in (the game could open a beach
  read-only for visitors).
- Rate limiting for image drawing (shared with "API rate limiting" in the
  backlog). Pictures are cached, but a crawler walking every code draws each once.
