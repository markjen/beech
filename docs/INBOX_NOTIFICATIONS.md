# Visitors, the inbox and notifications

Status: **designed, not built** (2026-11-23). Owner decisions at the end.

When someone visits your beach they should be able to **sign in**, **rate
it**, **leave a note** and **give you something from their bag**. You
should find out: an **inbox** that keeps everything that happened to you,
and **notifications** that tell you something is waiting.

This builds on what exists:

- visiting by code, share links and invite links (SHARING_GIFTING.md,
  INVITES_GUIDE.md);
- stars (`favorites`, the leaderboard);
- gifts (`POST /api/gifts`: instant, one atomic statement, owned items
  only, 20 an hour);
- neighbor requests and invite rewards, which today you only see when the
  app polls (30 s) or you sign in.

The inbox becomes the one place all of these land, so later features (push,
digests, an admin message) have a single thing to hang off.

## 1. The visitor's side

### Signing in from someone's beach

Today a visit link does nothing until you're signed in. A new visitor sees
the start screen, then nothing of the beach they were sent to.

- **Read-only visits while signed out.** A visit (or invite) link shows the
  beach straight away: the sand, the things on it, the shore bar reading
  "Visiting Ana". Everything a visitor can *do* (rate, note, gift, star) is
  in the visitor card (below), and tapping any of it while signed out opens
  sign-in with the line "Sign in to leave Ana a note". After sign-in the
  card reopens where they were.
- This needs a public, rate-limited `GET /api/public/beaches/:code`
  (sand bytes and the owner's first name; no neighbors, no inventory). It
  answers only for beaches that are **on the shore** (`beach.on_shore`).
  Beaches kept off the shore still need a signed-in visitor with the code,
  as today.
- A new account made from a visit link counts as an **invite** of that
  beach's owner (the same claim as `?invite=`), so the people whose beaches
  get shared are rewarded for it. (Owner decision 4.)

### The visitor card

While visiting, the shore bar gets a **"leave something"** button (a small
shell). It opens one card for everything a visitor can leave:

```
 Leave something for Ana
 ─────────────────────────────
 How do you like it?   ◌ ◌ ◌ ◌ ◌     (five shells, tap to rate)
 A note                [ What a lovely moat!          ] 0/280
                       quick: "Lovely beach" "Great castle" "Thanks!"
 A gift from your bag  [ starfish ×2 ] [ parasol ×1 ] [ … ]   (owned only)
                                              [ Leave it ]
```

- Any mix: a rating alone, a note alone, a gift with a note. One tap sends
  them all, and they arrive as **one inbox entry** ("Ben visited: 4 shells,
  a note and a starfish").
- **Ratings** are 1–5 **shells**, one per visitor per beach. They can be
  changed (the latest counts, at most once a day). They're kept apart from
  **stars**: a star is a bookmark ("I want to come back", and it drives the
  leaderboard), a rating is an opinion. The beach's name tag shows the
  average and count once it has 3 or more ("4.6 · 12").
- **Notes** are up to 280 characters of plain text, with **quick notes**
  (preset phrases) one tap away. They're private: only the owner sees
  them. A public guestbook is a follow-up, once moderation has proven itself.
- **Gifts** use the existing rules (owned, unexpired, non-free items only;
  the row moves; a gift keeps its purchase, so a refund still takes it
  back). The picker lists only what you can give: free items (rocks,
  driftwood, shells, sea glass, flags) aren't listed, because everyone
  already has as many as they like. The existing gift button on an item in
  hand stays; it now also writes an inbox entry.
- You can't rate, note or gift your own beaches, and you can't do any of it
  to someone who has blocked you (you're told only "that didn't go through").

## 2. The inbox

### What lands in it

| Kind | Made when | Says |
|---|---|---|
| `visit` | the visitor card is sent | "Ben visited Moat Beach: ★4, a note, a starfish" (note text shown in full when opened) |
| `gift` | a gift from the bag (no card) | "Ben gave you a starfish" |
| `neighbor_request` | someone asks for a side | "Ben wants to be your neighbor on the left" with Accept / Decline |
| `neighbor_linked` | your request is accepted | "You and Ben are neighbors" |
| `star` | someone stars your beach (batched, below) | "3 people starred Moat Beach today" |
| `rating` | ratings with no note (batched) | "Moat Beach got 4 new ratings: 4.5 average" |
| `invite_joined`, `invite_settled` | invites | "Fran joined through your link", "Fran settled in: a parasol is in your bag" |
| `system` | the admin console | "Welcome to week 2's vending set" (rare, audited) |

### Rules

- **Written with the action, in one statement.** The gift CTE, the
  neighbor-request insert, the referral settle and so on each gain one more
  `INSERT INTO inbox …` in the same statement. An inbox row exists exactly
  when the thing happened: no outbox worker, no "sent but not recorded".
- **Batching.** Stars and note-less ratings fold into one row per beach per
  UTC day (`UPDATE … SET count = count + 1` on a key of
  `(user, kind, beach, day)`), so a popular beach doesn't flood anyone.
- **Read state.** Each row has `read_at`. Opening the inbox marks what was
  shown as read. The unread count is the badge.
- **Actions in place.** Neighbor requests can be accepted or declined from
  the inbox (the existing endpoints), and a gift has **Say thanks**, which
  sends a quick note back.
- **Retention.** The newest 500 rows per person; read rows older than 180
  days go. Deleting an account deletes its rows (`ON DELETE CASCADE`), and
  rows where it was the sender keep the text but read "a former visitor".

### Where it lives in the app

The bottom-left row is full on phones (five buttons would run into undo).
The inbox gets the **top-right corner**: a mailbox button with an unread
badge. When you're away from home, the shore bar sits to its left. The
inbox opens as a dialog in the same style as the leaderboard and the guide:
a list, newest first, unread in bold, with the actions on each row.

## 3. Notifications

How you learn there's something in the inbox, from cheapest to most work.
Each one is a phase.

1. **In the app, open:** the badge, plus a short note for the important
   kinds (a gift, a note, a neighbor request): "Ben left you a note ·
   Open". The app already polls `/api/neighbors` every 30 s; that answer
   gains `inbox: { unread, latest }`, so there's no second poll.
2. **Web push (PWA):** the service worker already exists. Add VAPID keys
   (secrets in Secret Manager) and a `push_subscriptions` table; ask for
   permission **only after the first inbox entry arrives** ("Want to know
   when someone leaves you something?"), never at start-up.
3. **Native push (iOS / Android):** `@capacitor/push-notifications`, APNs
   (an Apple key) and FCM (a Firebase project). The same
   `push_subscriptions` table with a `platform` column. Owner setup is
   needed (Apple and Google consoles).

### What gets pushed, and how often

- **Pushed:** gifts, notes, neighbor requests and accepts, invite
  settled. **Never pushed:** stars, ratings, visits without a note. Those
  stay in the inbox.
- **At most one push per hour per person**; anything more in that hour is
  folded into the next push ("Ben and 2 others left you something").
- **Quiet hours:** no push between 22:00 and 08:00 in the person's time
  zone (taken from the device when they subscribe); waiting pushes go at
  08:00.
- **Per-kind settings** in the settings sheet (gifts and notes / neighbors
  / invites), stored server-side (`notify_prefs`), all on by default once
  push is allowed.
- Sending is a small job on the server: when an inbox row of a pushed kind
  is written, a row goes into `push_queue` in the same statement. A Cloud
  Scheduler tick each minute (or Cloud Tasks) sends what's due and applies
  the hourly limit and quiet hours. Failed endpoints (410 Gone) are
  removed.

## 4. Safety (user-generated content)

Free-text notes from strangers are user-generated content. Both stores
require, before the update ships (App Store 1.2; Play UGC policy):

- **Filtering:** notes go through a word filter (a maintained list,
  server-side) and are refused with a gentle message. Links and long digit
  runs (phone numbers) are refused outright.
- **Report:** every note has "Report". Reports go to a `reports` table and
  a new **Reports** tab in the admin console (`beech-admin`), where the
  admin can hide the note, warn, or suspend the sender's notes.
- **Block:** every inbox row from a person has "Block Ben". Blocked people
  can't rate, note or gift you, can't send you neighbor requests, and their
  earlier rows disappear from your inbox. Blocks are silent. A settings
  list lets you unblock.
- **Rate limits:** notes 10 an hour per sender, and at most 3 a day to the
  same beach; ratings once a day per beach; gifts keep 20 an hour.
- **New accounts:** notes from accounts younger than a day go to the owner
  as quick notes only (preset phrases). That blunts throwaway-account abuse
  without blocking real new players.
- **Younger players:** if the age rating ends up 9+ or lower, offer a
  setting (and the default for unknown ages) of **quick notes only**,
  inbound and outbound.

## 5. Data (migration 17+)

```sql
inbox (id BIGSERIAL, user_id, kind, actor_id NULL, beach_id NULL,
       item_id NULL, rating NULL, note_id NULL, count INT DEFAULT 1,
       day TEXT NULL, payload JSONB, created_at, read_at NULL)
  index (user_id, created_at DESC); unique (user_id, kind, beach_id, day) WHERE day IS NOT NULL
notes (id, from_id, to_id, beach_id, body TEXT CHECK (length <= 280),
       quick BOOLEAN, hidden_at NULL, created_at)
ratings (rater_id, beach_id, shells INT CHECK (1..5), updated_at,
         PRIMARY KEY (rater_id, beach_id))   -- beach.rating_sum / rating_n kept in step
blocks (blocker_id, blocked_id, created_at, PRIMARY KEY (blocker_id, blocked_id))
reports (id, reporter_id, note_id, reason, created_at, resolved_at, resolution)
push_subscriptions (id, user_id, platform, endpoint/token, keys, tz, created_at)
push_queue (id, user_id, inbox_id, due_at, sent_at)
notify_prefs (user_id PRIMARY KEY, gifts BOOL, neighbors BOOL, invites BOOL)
```

## 6. API

```
GET  /api/public/beaches/:code         no session; on-shore beaches only; 60/min per IP
POST /api/beaches/:code/visit { shells?, note?, quick?, item? }
       -> { rated, noted, gifted }      one inbox row; each part checked as above
GET  /api/beaches/:code/rating          -> { average, count, mine }
GET  /api/inbox?before=                 -> { unread, entries: [...] }   newest first, 30 a page
POST /api/inbox/read { upTo }           mark read
POST /api/notes/:id/report { reason }   -> 204
PUT/DELETE /api/blocks/:code            block / unblock; GET /api/blocks
POST /api/push/subscribe { platform, endpoint|token, keys?, tz }, DELETE /api/push/subscribe
GET/PUT /api/notify-prefs
```

`GET /api/neighbors` (the 30 s poll) gains `inbox: { unread, latest }`.

## 7. Phases

| Phase | What | Needs the owner |
|---|---|---|
| V1 | Inbox (table, dialog, badge); gifts, neighbor requests/accepts and invites write rows; in-app notes | — |
| V2 | Visitor card: notes (with filter, report, block, admin Reports tab), gift with a note | the word list; the report contact address for the stores |
| V3 | Ratings (shells), the name-tag average, batched star/rating rows | decision 2 |
| V4 | Signed-out visits (public beach endpoint) and sign-in from the card; visit-link sign-ups count as invites | decisions 3, 4 |
| V5 | Web push | VAPID secrets |
| V6 | Native push | APNs key, Firebase project, store privacy forms |

Each phase ships on its own and keeps the app playable. V2 must not ship
to the stores without the filter, report and block in the same release.

## 8. Tests

- Server: each action writes exactly one inbox row in the same statement
  (and none when it fails: a 409 gift leaves no row); batching folds stars
  and ratings per day; blocks stop every kind; rate limits; the filter
  refuses links and listed words; the public endpoint refuses off-shore
  beaches; read state; retention; account deletion.
- Client: inbox rendering and actions; the badge from the poll; the visitor
  card's owned-only gift picker (free items never listed); signed-out card →
  sign-in → card reopens.
- e2e (`npm run e2e:inbox`): Ben visits Ana's beach, rates, notes and gives
  a starfish; Ana's badge shows 1; she opens the inbox, says thanks, then
  blocks Ben; Ben's next note doesn't go through.

## Decisions for the owner

1. **Notes are private** (only the owner reads them). A public guestbook
   later?
2. **Ratings: shells 1–5, separate from stars.** Should the leaderboard
   use them (for example, "best rated" with at least 10 ratings), or stay
   on stars?
3. **Signed-out visitors can see on-shore beaches** through a link. This
   is new exposure: today only signed-in people can see a beach.
4. **A sign-up from a visit link counts as an invite** of that beach's
   owner (the same rewards as INVITES_GUIDE.md).
5. **Gifts stay instant** (no accept step), now with an inbox row and Say
   thanks. Add decline/return later if unwanted gifts happen.
6. **Push limits:** one an hour, quiet 22:00–08:00, no pushes for stars or
   ratings.
