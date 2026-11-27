# Visitors, the inbox and notifications

Status: **phases V1–V4 built** (2026-11-24): the inbox, the visitor card
(ratings, notes, gifts), filter / report / block with the admin Reports tab,
and signed-out visits. **V5–V6 (web and native push) and Steam
notifications built** (2026-11-26); each platform switches on when the
owner's setup for it is done ("Turning on push: owner steps", below).

### State machine

`specs/tla/Push.tla` ([STATE_MACHINES.md](STATE_MACHINES.md#push-notifications-pushtla)):
a player's devices subscribing, unsubscribing, signing out and being
forgotten by the push service; blocks, muted kinds and reads; and two push
senders at once. Its rules: a row reaches each device at most once, one
push an hour, nothing in quiet hours, never a star, and nothing reaches a
device after an unsubscribe, sign-out, block or mute has returned. The
sender commits its claim under the player's push lock (`push_state`,
`FOR UPDATE`), then retakes that lock and locks the subscription rows to
recheck eligibility and send. Block and mute take the same push lock.
A crash after the claim can drop the notification. The inbox entry stays
available, and a later tick skips the claim. Tests: `server/test/stateMachines/push.test.ts`.

### Push: as built (2026-11-26)

- **Three ways in, one server.** Web push (VAPID, RFC 8291 encryption done
  with `node:crypto`, no new dependency) for browsers and Home Screen web
  apps; **APNs directly** for the iOS app (a `.p8` key in Secret Manager,
  HTTP/2 from the server: simpler than routing iOS through Firebase, and no
  Firebase SDK in the iOS app); **FCM HTTP v1** for the Android app, sent
  with the Cloud Run service's own identity. Code: `server/src/push.ts`.
- **Steam has no push service for games.** The Steam build shows an OS
  notification itself (Electron `Notification`, through
  `window.beechSteam.notify`) when the 30 s poll brings something pushable
  while the game isn't the window in front, minimised included. Nothing
  reaches a player whose game is closed; the guide says so.
- **The queue is a column**, not a table: `inbox.pushed_at` (migration 33).
  A row is due while it's empty; a push claim marks every due row, sent or
  folded or skipped (read, blocked, muted, older than a day). Rows from
  before push were marked done by the migration. Marking per row, not a
  cursor, means a row committed late with a lower id is never skipped.
- **The tick** runs every minute in the server (like the Steam refund sync)
  and, once set up, from Cloud Scheduler (`POST /api/push/tick` with an
  OIDC token), because Cloud Run can idle an instance's CPU between
  requests. Two at once are safe (the model).
- **What a push says:** "Ben gave you a gift", "Ben left you something",
  "Ben wants to be your neighbor", "You and Ben are neighbors", "Ben settled
  in", "The sea changed your beach while you were away", "Ben fed your pet";
  several in an hour: "Ben left you 3 things" or "Ben and 2 others left
  you something". Never a note's text (lock screens). Pushed kinds: `visit`
  and `gift` (setting "gifts and notes"), `neighbor_request` and
  `neighbor_linked` ("neighbors"), `invite_settled` ("invites"), `tide` and
  `pet_fed` ("your beaches"). A tap opens
  the inbox (`?inbox=1`, the service worker's message, the Capacitor action
  listener, or Electron's click).
- **Quiet hours** use the newest subscribed device's time zone.
- **Subscriptions belong to the session** that made them
  (`session_hash … ON DELETE CASCADE`). Sign-out and account deletion remove
  them. Expired sessions are immediately ineligible for sends, even before
  cleanup removes their rows. The limit is 10 devices per player.
  Signing back in re-sends this device's subscription if its switch is on.
  Web endpoints must be a known push service (the server posts to them).
- **Asking:** once, a few seconds after the first pushable thing arrives
  while playing (after its own note over the beach), never at start-up.
  Away events never get that note: a tide or pet row waits in the inbox
  (with its push) instead of popping up over the beach.
  Settings → Settings has the **notifications** switch (per device) and,
  under it, **gifts and notes / neighbors / invites / your beaches** (per player, on the
  server). If the OS has notifications off, the row says so.
- **Native builds opt in.** The Android app runs the hosted web build, so
  a build flag can't say whether that app was built with Firebase; instead
  an app built with push set up adds `BeechPush/1` to its user agent
  (`capacitor.config.ts`, `BEECH_NATIVE_PUSH=1`, set by the release
  workflow when the `NATIVE_PUSH` variable is 1). Without it the app never
  calls the native push plugin, so a build without Firebase can't crash.
  iOS includes the push plugin, and the release workflow adds the
  `aps-environment` entitlement, only then too.
- **Local development:** `npm run server:dev` makes throwaway VAPID keys;
  `npm run e2e:push` checks the question, the settings rows and the routes.
  Headless Chromium refuses push subscriptions, so the e2e notes that and
  leaves delivery to the server tests (which decrypt a real RFC 8291
  payload).

### As built (where it differs from the design below)

- **No explanations in the game** (CLAUDE.md, a rule added after this
  spec): the card and the inbox show labels and status only, with a "how it
  works" link to the web guide (`/guide#visitors`, `server/src/guide.ts`).
- **"Leave something" is on each beach's name tag**, not the shore bar:
  main's viewing mode hides the shore bar while you're visiting and shows
  the name tags in the "i" card instead. The beach's **average shows in
  the visitor card** (from 3 ratings), and in the shore bar of the
  expanded status pane while you look at that beach (a shell, "4.6 · 12";
  2026-11-27). The shore walk's JSON (`/shore`, `/shore/more`,
  `/public/shore`) carries it as `rating: { average, count }` on each
  beach, left out under 3 ratings (`ratingShown` in `server/src/shore.ts`).
- The **blocked list** is at the bottom of the inbox, not in settings.
- The admin can **hide** a reported note or **dismiss** the report, and
  **suspend the sender's notes** for 1, 7, 30 or 365 days (2026-11-27),
  optionally hiding every note of theirs still shown, and lift it again.
  While suspended, `POST /beaches/:code/visit` refuses anything carrying a
  note (403, "notes are paused on your account until …"); ratings and
  gifts still go through. `users.notes_suspended_until`, migration 42;
  `POST /api/senders/:id/suspend-notes { days, hide }` and
  `POST /api/senders/:id/lift-notes` in the admin console, both audited.
  Modelled in `specs/tla/NoteSuspension.tla`: the visit checks the
  suspension inside its transaction under the sender's row lock, which the
  suspension's `UPDATE users` also takes, so no note lands after a
  suspension commits.
- Ratings with no note fold into a "N new ratings" row per day, as
  designed. A rating that comes with a note or a gift is part of that
  visit's row.
- The visitor card's gift list counts **owned** items, not what's left
  after placing: a gift moves what you own (SHARING_GIFTING.md), and the
  thing on your sand stays.
- **Signed-out visits** were built on main at the same time (the
  beechshore follow-ups, `/api/public/shore`, `/api/public/shore/more`,
  `/api/public/beaches/:code`, docs/SHORE_SITE.md); this work uses those.
- Code: `server/src/inbox.ts` (limits, quick notes, the filter), the
  endpoints in `server/src/app.ts`, migration 24, the Reports tab in
  `adminApp.ts` / `adminPage.ts`; the app's `src/ui/inbox.ts`,
  `src/ui/visitorCard.ts`, `src/ui/inboxText.ts` (the wording), and
  `InboxApi` in `src/net/account.ts`. Tests: `server/test/inbox.test.ts`,
  the reports test in `server/test/admin.test.ts`,
  `tests/inboxText.test.ts`, and `npm run e2e:inbox`.

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
| `system` | the admin console (News tab, `POST /api/system-messages { text, requestId }`) | the admin's words, up to 140 characters ("Week 2's vending set is in"). Everyone with an account then gets one; at most one a UTC day, and a retried request never sends twice (one statement: `system_messages`' unique day and request id decide, and the inbox rows come from what it inserted; `specs/tla/SystemMessages.tla`). Announced over the beach as "News from beech"; pushed (its words) to those whose **news** switch is on (`notify_prefs.news`, on by default). Audited. |
| `tide` | the sea worked on your beach while you were away (batched, below) | "The sea worked on Moat Beach: 4 high tides, the sea took 1 thing (back in your bag)" |
| `pet_fed` | a visitor fed your beach's pet | "Ben fed Shelly on Moat Beach" |

### Rules

- **Written with the action, in one statement.** The gift CTE, the
  neighbor-request insert, the referral settle and so on each gain one more
  `INSERT INTO inbox …` in the same statement. An inbox row exists exactly
  when the thing happened: no outbox worker, no "sent but not recorded".
- **Batching.** Stars and note-less ratings fold into one row per beach per
  UTC day (`UPDATE … SET count = count + 1` on a key of
  `(user, kind, beach, day)`), so a popular beach doesn't flood anyone.
  Tide rows batch the same way: one row per beach per day, adding up the
  tides, what the sea took and what it washed up, and keeping the newest
  "Before the tide" checkpoint. A pet feeding is one row per feed (like a
  visit): each one names the feeder.
- **Away events live here, not on the beach.** The sea working on your beach
  and visitors feeding your pet used to pop up as a card (or a toast) when
  you next opened the beach; now they land here, and as a push (below).
  Opening your beach just shows the beach. Tapping a tide or pet row takes
  you to that beach; a tide row's "Before the tide" checkpoint is in
  Manage → Checkpoints if the sea changed more than you like. Tide and pet
  rows are never announced over the beach while you're playing (`ANNOUNCE`
  in `src/ui/inboxText.ts` leaves them out).
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
  settled, the sea working on your beach (`tide`) and a visitor feeding
  your pet (`pet_fed`). **Never pushed:** stars, ratings, visits without a note. Those
  stay in the inbox.
- **At most one push per hour per person**; anything more in that hour is
  folded into the next push ("Ben and 2 others left you something").
- **Quiet hours:** no push between 22:00 and 08:00 in the person's time
  zone (taken from the device when they subscribe); waiting pushes go at
  08:00.
- **Per-kind settings** in the settings sheet (gifts and notes / neighbors
  / invites / your beaches), stored server-side (`notify_prefs`), all on by default once
  push is allowed. "Your beaches" covers the sea (`tide`) and pet feedings
  (`pet_fed`).
- Sending is a small job on the server: when an inbox row of a pushed kind
  is written, a row goes into `push_queue` in the same statement. A Cloud
  Scheduler tick each minute (or Cloud Tasks) sends what's due and applies
  the hourly limit and quiet hours. Failed endpoints (410 Gone) are
  removed.

### Turning on push: owner steps

Push needs keys and setup that only the owner can do. The Android/FCM
side is Terraform in the repo (`infra/firebase.tf`); the Apple key and
the GitHub variables and secrets stay by hand. The code is built (2026-11-26); each platform switches on
by itself once its part below is done, and the deploy only adds a part's
settings once its GitHub variable exists. Everything here is free.

**Quick way:** `scripts/setup-push.sh web` and `scripts/setup-push.sh ios
<AuthKey_KEYID.p8> <TEAM_ID>` do every Google Cloud step below (run them where gcloud is signed in to
`beech-prod`; they're safe to re-run and never print a secret), then print
the GitHub variables to set. The Android/FCM setup (§C) is Terraform now;
`scripts/setup-push.sh android` is only a fallback for it. The Apple
console steps (B1, B4) and the GitHub variables and secrets stay by hand.

By hand, with the same shell variables as GCP.md, "One-time setup":

```bash
PROJECT=beech-prod; REGION=us-central1
RUN_SA=beech-run@$PROJECT.iam.gserviceaccount.com
```

**A. Web push**

1. Make the key pair (on your machine, not in the repo):
   ```bash
   npx web-push generate-vapid-keys --json > /tmp/vapid.json
   ```
2. Keep the private key in Secret Manager, readable by the game server:
   ```bash
   node -e "process.stdout.write(require('/tmp/vapid.json').privateKey)" \
     | gcloud secrets create beech-vapid-private-key --data-file=-
   gcloud secrets add-iam-policy-binding beech-vapid-private-key \
     --member=serviceAccount:$RUN_SA --role=roles/secretmanager.secretAccessor
   node -e "console.log(require('/tmp/vapid.json').publicKey)"   # copy this
   rm /tmp/vapid.json
   ```
3. GitHub → Settings → Secrets and variables → Actions → **Variables**:
   `VAPID_PUBLIC_KEY` = the public key (it's public), and `VAPID_SUBJECT` =
   `mailto:` plus a support address the push services can write to. The
   next deploy turns web push on (`push_config` in the logs says
   `web: true`).
4. A once-a-minute tick from Cloud Scheduler (the server only ticks
   itself when Scheduler isn't configured — local dev — because on
   Cloud Run an idle instance's CPU is throttled and its timer's query
   looked slow, ~1 s, tripping the slow-query alert):
   ```bash
   gcloud services enable cloudscheduler.googleapis.com
   gcloud iam service-accounts create beech-scheduler
   SCHED_SA=beech-scheduler@$PROJECT.iam.gserviceaccount.com
   URL=$(gcloud run services describe beech --region=$REGION --format='value(status.url)')
   gcloud run services add-iam-policy-binding beech --region=$REGION \
     --member=serviceAccount:$SCHED_SA --role=roles/run.invoker
   gcloud scheduler jobs create http beech-push-tick --location=$REGION \
     --schedule='* * * * *' --http-method=POST --uri="$URL/api/push/tick" \
     --oidc-service-account-email=$SCHED_SA --oidc-token-audience="$URL/api/push/tick"
   ```
   Then the variables `PUSH_TICK_SERVICE_ACCOUNT` = `$SCHED_SA` and
   `PUSH_TICK_AUDIENCE` = `$URL/api/push/tick`. Until the next deploy the
   job gets 404s; that's fine.

Note: on iPhone, web push only works once the site is **added to the Home
Screen** (iOS 16.4 and later). The store apps use native push (B, C).

**B. iOS app (APNs, no Firebase)**

1. **Apple push key.** developer.apple.com → Certificates, IDs & Profiles →
   **Keys** → + → tick **Apple Push Notifications service (APNs)** →
   download the `.p8` (Apple lets you download it **once**; keep it in your
   password manager). Note its **Key ID** and your **Team ID**.
2. **Into Secret Manager:**
   ```bash
   gcloud secrets create beech-apns-key --data-file=AuthKey_XXXXXXXXXX.p8
   gcloud secrets add-iam-policy-binding beech-apns-key \
     --member=serviceAccount:$RUN_SA --role=roles/secretmanager.secretAccessor
   ```
3. **Variables** `APNS_KEY_ID` and `APNS_TEAM_ID`. The next deploy turns
   iOS push on in the server (it sends to `app.beech.beach`; TestFlight and
   App Store builds both use the production APNs host).
4. **Turn on the capability:** developer.apple.com → Identifiers →
   `app.beech.beach` → **Push Notifications** on. If you use manual
   provisioning profiles, regenerate them.

**C. Android app (FCM)** — Terraform (`infra/firebase.tf`), done
2026-11-26 and imported into state; do not redo it in the console.

1. **Firebase on the existing project** (`google_firebase_project`) and
   the **Android app** (`google_firebase_android_app`, package
   `app.beech.beach`) are managed by Terraform. Analytics is off. If
   either ever has to be recreated, change the Terraform, don't click it
   in the console — and import anything the console creates before the
   next apply.
2. **The config file stays by hand:** download `google-services.json`
   (Firebase console → Project settings → Your apps) and add it as the
   GitHub Actions **secret** `GOOGLE_SERVICES_JSON` (base64:
   `base64 -w0 google-services.json`). For local builds put it at
   `android/app/google-services.json` (the build applies the plugin when
   the file is there; it's git-ignored). Don't commit it.
3. **Let the server send** is Terraform too: the FCM API
   (`fcm.googleapis.com`) is in the managed API list in `infra/main.tf`
   and the `roles/firebasecloudmessaging.admin` grant on `beech-run` is
   `google_project_iam_member.beech_run_fcm_admin`. Then the GitHub
   variable `FCM_PROJECT_ID` = `beech-prod` (by hand — GitHub variables
   aren't Terraform). The next deploy turns FCM on in the server.

**D. App builds with push (after B and/or C)**

Set the variable `NATIVE_PUSH` = `1`, then run "Release to stores". That
build writes `google-services.json` from the secret, adds the push
entitlement on iOS, and marks the apps as push-capable (`BeechPush/1` in
the user agent). Older app builds keep working without push. Do B4 before
an iOS release with `NATIVE_PUSH` on, or signing fails.

**E. Store forms** (MOBILE.md, "Store forms"): Play's Data safety form gains
"Device or other IDs: collected, for app functionality, not shared" (the
push token). Apple's privacy label needs no new data type for push tokens;
the review notes should say push is opt-in and only for gifts, notes,
neighbors and invites. `public/privacy.html` already covers push.

**Steam** needs nothing: the game shows its own notifications while it runs.

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

## 5. Data (migration 24)

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
| V5 | Web push (built 2026-11-26) | VAPID secrets (A) |
| V6 | Native push, and Steam's own notifications (built 2026-11-26) | APNs key (B), Firebase (C), `NATIVE_PUSH` (D), store forms (E) |

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

Decided (2026-11-24): **3 — yes**, signed-out visitors see on-shore
beaches through a link; **4 — yes**, a sign-up from a plain visit link
counts as an invite. The rest were built with the defaults below; say if
any should change.

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
