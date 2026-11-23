# Sharing your beach, and gifting items

Status: **built** (2026-11-22, branch `feat/sharing-gifting`).

Two small social features. Both reuse what already exists — the neighbor
code as the beach's public id, the inventory table as the record of what a
person owns — instead of adding new identity or inbox systems.

## Share links

### Format

```
https://play.beech.games/?visit=K7F2QX
```

The beach id in the link is the beach's **code** (6 letters and
numbers, `beach.code`). For a home beach that's the owner's neighbor
code (`users.neighbor_code`), so the code people already share is the
code the link carries. No new ids, no new table: the code is
already the public way to name a beach (visit by code, favorites,
neighbor asks). The link is built from the page the sharer is on, so the
same build works on the production domain and on any other host
(`https://beech.markjen.com/?visit=K7F2QX` — the legacy host still works).

### Landing on the shared beach

- On startup the app reads `?visit=` (`src/net/share.ts`,
  `visitCodeFromUrl`). The code is kept pending until the person is signed
  in, then `NeighborView.visit(code)` runs and the camera moves to that
  beach — the same path as typing a code in the settings sheet, so the
  shore bar reads "Visiting …" and ⌂ goes home.
- The `visit` parameter is consumed once it is applied (removed from the
  URL with `replaceState`), so going home and reloading doesn't drag you
  back. If the code doesn't name a beach, a short note says so.
- If the link opens while signed out, the visit waits for the first
  sign-in and then happens on its own. In the sandbox build (no accounts)
  a visit link does nothing — there is nobody to visit as.

### Web and the phone apps

- **Web:** the link opens the production site, which is the full app with
  the same account. That's the whole of v1.
- **Phone apps:** a link opens in the browser, not in the app. Routing
  links into the native shell needs Universal Links (iOS) / App Links
  (Android) plus the Capacitor App plugin to hand the URL to the web code —
  a follow-up, not part of this change. The account is the same either
  way, so nothing is lost by landing in the browser.

### Privacy

A share link grants **nothing new**. Any signed-in person can already
visit any beach by its code (`GET /api/beaches/:code`,
`GET /api/shore?code=`), and every saved beach is already visible on the
global shore (see BACKEND.md, "Privacy"). The link is only a convenience
— a code you can tap instead of type. The recipient still has to be
signed in. If "keep my beach off the shore" (BACKLOG.md) ever lands, it
should gate link visits too; until then the link and the code behave the
same.

### Link previews (Open Graph)

Crawlers don't run JavaScript, so the preview has to come from the
server. The Cloud Run server injects Open Graph tags into `index.html`
when a page request carries a `?visit=` code that names a beach with a
save (`server/src/shareMeta.ts`, wired in `server/src/server.ts`):

```html
<meta property="og:title" content="Visit Ana's beach on beech">
<meta property="og:description" content="Walk the shore, dig in the sand, and see what Ana built.">
<meta property="og:url" content="https://play.beech.games/?visit=K7F2QX">
```

The owner's first name is HTML-escaped before it goes into the page. A
code that names nobody (or nobody with a saved beach) gets the plain page
— the app then says "no beach has that code". For a beach on the shore, `og:image` is a
1200×630 picture of it drawn by the server (`/shore/img/CODE.png`, see
[SHORE_SITE.md](SHORE_SITE.md)). The app's share buttons now send the
beechshore link (`beechshore.com/CODE`), which anyone can open signed out. A
static `index.html` (the sandbox build on a static host) can't inject
anything, so previews only work for production links.

## Gifting items

### Addressing

The recipient is addressed by the **code of one of their beaches** —
usually their neighbor code, which is their home beach's code. The
gift goes to that beach's owner, so a code for any of their beaches
reaches the same person. No usernames, no contacts, no inbox.

### The flow

1. Pick up an item you own from the bag. While it's in hand, the place
   bar has a gift button.
2. Tap it, type their code, send. The server moves one of that item from
   your inventory to theirs, in a single statement.
3. The bar says "Sent to Ana". Your bag count drops by one; theirs goes
   up by one next time they open the bag.

### Instant, no accept step

The gift lands at once — there is nothing for the recipient to accept.
That is a deliberate simplification: there is no inbox, no notification
channel, and no pending-gift storage to build, expire and clean up. The
giver chose the recipient explicitly by code, and a gift is a small
thing. If unwanted gifts ever become a problem, the fix is a "gifts
received" list with a return/decline, not a second flow now.

### What can be gifted

- **Anything with an inventory row**: anything won from the claw machine,
  bought in the shop, or given at an event, while it is unexpired. The
  row moves, not the object on the sand (see below).
- **Free items can't be gifted**: rocks, driftwood, shells, sea glass and
  flags have no inventory rows — everyone already has as many as they
  want, so there is nothing to send.
- **Extra beaches can be gifted**: an `beach` inventory row transfers
  like any other, and the allowance (see MULTI_BEACH.md) moves with it.
- **Time-limited items keep their expiry**: the recipient's row carries
  the giver's `expires_at`.
- **Bought items stay tied to their purchase**: the recipient's row
  carries the giver's `purchase_id`, so if the store refunds that
  purchase, the gifted copy expires too. Without this, someone could buy
  an item, gift it to a second account, get a refund and keep it.
- **Unique items** (none in the catalog yet): gifting transfers the only
  copy. "One owner only" still holds — the owner is just someone else now.

### What happens to things already on the sand

Nothing. Gifting moves the *count you own*, not the objects placed on a
beach. If you owned one starfish and it is on your sand, you can still
gift your one starfish; the placed one stays where it is, and you can't
put down another until you own one again. That's the same rule as a
refund (MULTI_BEACH.md, "Items across beaches"): nothing disappears, you
just can't place more than you own.

### The endpoint

```
POST /api/gifts { "code": "K7F2QX", "item": "starfish" }
-> 200 { "item": "starfish", "to": { "name": "Ana", "code": "K7F2QX" } }
```

Errors: `400` bad code, missing item, or that's your own code · `404` no beach has that code ·
`409` you don't have one of those to give · `429` more than 20 gifts in an hour.

### Atomicity and abuse

- **One statement, all or nothing.** The transfer is a single SQL
  statement: an `UPDATE` that takes one unexpired row of yours (oldest
  first, `quantity > 0`), an `INSERT` that gives the recipient one row
  with `source = 'gift'`, and an `INSERT` into the `gifts` log, all in
  one CTE chain. Two gifts of the same last item race on the same row:
  the second one's `UPDATE` finds `quantity = 0` and moves nothing, so
  the API answers 409 instead of going negative (the `quantity >= 0`
  check is a backstop). There is no read-then-write anywhere on this path.
- **Only your own rows move.** The `UPDATE` is keyed to your user id; a
  request can never move someone else's items, and the recipient is
  resolved server-side from the code you sent.
- **Rate limit.** 20 gifts an hour per giver, counted from the `gifts`
  log. A soft guard against scripted giveaways, not a correctness
  invariant — a race can slip one past it.
- **The log.** `gifts (from_id, to_id, item_id, created_at)` — migration
  9, after the store purchases' migration 8 — exists so a dispute ("who gave
  what to whom") can be answered from the database.
  Nothing about gifts is shown to other players.

### What this doesn't do (follow-ups)

(Invite links with rewards for both sides are built on top of share links:
see [INVITES_GUIDE.md](INVITES_GUIDE.md).)

- A "gifts received" list, or a way to return/decline a gift.
- Sharing a beach you're *visiting* (the copy-link button is on your own
  code; the shore bar has no share button yet).
- Universal Links / App Links so a shared link opens in the phone apps.
- A 1200×630 `og:image` for previews.
- Gifting a whole beach as a place (as opposed to the `beach` inventory
  row that buys the allowance for one) — that's part of multi-beach,
  MULTI_BEACH.md.

## Tests

- `server/test/gifts.test.ts`: a gift moves the row (giver loses one,
  recipient gains one, source `'gift'`); unknown code 404; your own code
  400; an item you don't own 409; a free item 409; a second gift of the
  same last item 409 (and two concurrent gifts: exactly one succeeds);
  the 21st gift in an hour is 429.
- `server/test/shareMeta.test.ts`: the meta tags escape a hostile name;
  the page handler injects tags for a real code and serves the plain page
  for an unknown one.
- `tests/share.test.ts`: the link builder, the `?visit=` parser
  (forgiving about case, spaces and dashes), and stripping the parameter
  after use.
- The full suites still pass (`npm test` at the root, `npm test` in
  `server/`).

## Decisions for the owner

- **Instant gifts** (no accept step) — see above. Say the word if you'd
  rather have an inbox for them.
- **Anyone with the link can visit** — same as anyone with the code today.
  The "keep my beach off the shore" setting would change this for links
  too.
- **20 gifts an hour** — a guess at "generous but not scriptable". Easy to
  move.
