# Beech: an agent-collaboration log

A log of how Beech was built, 22–27 November 2026 — what shipped, and how
the work happened. This is a record, not marketing copy: dates, PR numbers
and claims come from the repo (`git log` on `origin/main`, `gh pr list`,
`server/src/releaseNotes.ts`, `docs/STATUS.md`, `docs/BACKLOG.md`,
`CLAUDE.md`). Where a detail comes from the working session record rather
than the repo — Mark's decisions in chat, the Discord loop, the portal and
console steps — it is marked *(working record)*. Dates are the repo's UTC
dates; in Mark's timezone (America/Chicago) the late entries of each UTC day
fell on the previous evening.

The headline numbers: the repo's first commit is 22 November 2026
("Add game plan for Beech beach simulator"). By 27 November, `main` held
317 commits and **170 merged pull requests** — 2 on the 22nd, 31 on the 23rd,
43 on the 24th, 26 on the 25th, 40 on the 26th, 28 on the 27th. No PR in the
week was authored under any name but `markjen`: the GitHub record shows
branches and merges, not which agent wrote what, so this log attributes work
to Mark, to Rosie (the coordinating agent), to subagents and to the parallel
session only where the record supports it, and says so where it does not.

## 22 November — the game in a day

The whole game arrived in one day, mostly as direct commits on `main`
(the repo's rule then, and still, allows small high-confidence changes
straight to `main`; the week's PR count for the day is 2).

- `98a3dcf` — "Add game plan for Beech beach simulator" (`PLAN.md`).
- M0–M1 — Vite + TypeScript + Babylon scaffold, beach simulation core,
  diorama renderer, orthographic camera.
- M2 — the sand toy: dig with a screen-constant brush, ring, rim,
  undo/redo, second-finger cancel.
- M3–M4 — waves, foam, wet sand, calm toggle, erosion, live tuning panel.
- M5 — ambience: procedural audio, haptics, day-cycle palettes, start
  screen, settings sheet.
- The day's release note (the first) lists what players got: neighbors,
  the shore, the claw machine, the chair view, shells and sea glass,
  Google/Apple sign-in in the phone apps, rocks and driftwood.

The milestones M0–M5 in `docs/STATUS.md` were all marked done the same day.
The plan was the contract for everything after: the simulation stays plain
TypeScript with no DOM or Babylon imports, so it runs in a Web Worker and
in Vitest, and the app must stay playable after every commit.

## 23 November — domains, and going live

31 PRs merged. The product became a public service this day.

- The domains were registered: `beech.games` (main site), `beechgame.com`
  and `beechgames.com` redirecting to it, and `beechshore.com`, the public
  browser of public beaches *(working record)*. Production runs on Cloud
  Run in GCP project `beech-prod`, at `play.beech.games` (the game) and
  `beech.games` (landing, policies, guide).
- `beech.games` got a home page; the game itself moved to
  `play.beech.games`. The guide moved out of the game UI into
  `beech.games/guide` — the "no notes in the game UI" rule dates from here:
  only labels, status and confirmations on screen; everything explanatory
  lives in the guide, and a feature that changes how the game works updates
  the guide in the same commit (`CLAUDE.md`).
- The shop opened (deckchair, parasol, surfboard, tiki torches,
  sandcastle, beach hut, lighthouse, extra beaches), with gift cards and
  promo codes on the web; the vending machine (one free ball a day, weekly
  set); the leaderboard; checkpoints (named copies of a beach); export and
  import of beaches; a beach now holds 2,000 things (was 400).
- The Xsolla web-checkout plan was reviewed (the PR #21 plan, per
  `docs/BACKLOG.md`), the first step toward card payments on the web.

## 24 November — animals, linked beaches, beechshore

43 PRs merged, the busiest day by count.

- Beach animals A1–A5 landed: the wild sand crab, beach snacks, resident
  pets, visitor feeding, the dolphin. Animals got bigger and more frequent
  the same day, and wild dolphins started cruising the deeper water.
- Linked beaches: neighbors now blend edge to edge into one continuous
  beach — sand, water and rolling wave fronts flow across the seam, and
  linked neighbors' inland rows join up and run straight on.
- `beechshore.com` got a refreshed look, a beach finder, a share studio
  (Postcard / Square / Story / Clean snapshots), an item catalog with votes
  and comments, and 3D views of every beach page. The item-submission flow
  opened: design an item, propose a price, earn shop credit when it sells.
- Invites: anyone who joins from an invite link starts with a parasol, and
  the inviter earns a gift per friend (up to ten).
- The safety net landed alongside: one active editor per person, a daily
  auto-save checkpoint, and a checkpoint taken before any large edit
  (bulldozer, flatten, vacuum, or anything reshaping a tenth of a beach).
- The UI was rebuilt around the palm: a single vertical toolbar, a status
  pane upper left, and the Inbox as the hub for messages, leaderboard,
  starred beaches and visiting by code.

## 25 November — the interface rebuild, and the store wiring

26 PRs merged.

- The palm-first UI shipped (#99): at rest the screen is just the beach
  and a palm button; the toolbar is one column (Inbox, Hand, Dirt, Bag,
  Store, View, Manage) and always opens on the hand.
- Live beaches (#93, L1–L5): the sea keeps working while you are away —
  tides wear the sand, wash up shells and driftwood — and visitors see
  your changes live. Away events later moved into the inbox (#135, 26 Nov).
- Local weather (#110): the sky and light follow the beach in view along
  the shore, blending as you pan to another place in the world.
- Formal verification arrived: the game's state machines were modeled in
  TLA+ (#113, "fix five races"), LemmaScript + Dafny tooling was added,
  and the model-first workflow became a ground rule — new gameplay starts
  with its state machine, the model decides which steps must be one
  transaction and under which lock, and the tests replay what TLC found
  (`CLAUDE.md`, `docs/STATE_MACHINES.md`).
- Observability (#103): attributable slow queries, a cold-start flag,
  beach save/load sizes, real client `load_ms`, and the alert policies
  that would fire repeatedly over the next two days.
- Money: Xsolla web checkout secrets were wired into the deploy (#108),
  the player country is sent with checkout (#111), and the web shop's card
  button was made to work on more mobile connections.
- Mobile: Android became a hosted shell (#115) — it loads
  `play.beech.games` live in a WebView, so web and server changes reach it
  with no new build. Sign-in diagnostics went in for native Google
  failures (#120), and the Android sign-in error [16] was traced to the
  original app signing key being unregistered in Google Cloud; registering
  it fixed sign-in *(working record)*. Builds 4 and 5 were bumped (#116,
  #121).
- Apple Developer enrollment completed this day *(working record)*, and
  the iOS listing name was chosen: "Beech Beach" (the name "Beech" was
  taken; the home-screen name stays "Beech").

## 26 November — the big day

40 PRs merged, and the parallel session was landing work alongside all day.

- Real weather, 21 more real beaches, and a place picker (#129): every
  beach's sky follows a live Open-Meteo forecast, 34 beaches in all, each
  with its own real tides; the picker searches, drops a dot on a world
  map, or browses by region. The next day the refresh was cut to once an
  hour (#143), and the free no-key Open-Meteo tier was kept by Mark's
  choice *(working record)*.
- Piers (#128): snap three of your beaches side by side and the middle one
  can hold a timber pier out over the water (30 sand bucks). A pier preview
  drawn as a see-through ghost followed (#162), and a hint in the bag for a
  bought pier with nowhere to put it (#140 — see the Discord loop below).
- Pets (#133): six wild species — crab, sandpiper, octopus, seal, turtle,
  dolphin — movable, sand-bucks-only, befriended for a quarter of the shop
  price in snacks.
- Inland beach sections (#150): up to four rows behind any beach — sand
  extension, boardwalk, bike path, playground, coastal road, storefronts,
  dune garden, picnic grove (15 bb each).
- The currency was renamed: "sand bucks" became "beech bucks" (bb), with a
  coin icon and a Settings link to the Beechshore account page (#144).
  Mark's decision in chat was one line — "Lets do it" — on a Discord
  request from a player *(working record)*. Product IDs (`bucks_*`) did not
  change; only the display name did.
- Auth: attach a sign-in while signed in — Google, Apple or Steam — so the
  same beaches follow you everywhere (#147); merging two non-empty
  accounts through the link flow (#149); and web Sign in with Apple, with
  Apple tokens revoked on account delete (#161). The #161 deploy failed
  five times before it landed: the Cloud Run service account had no read
  access on the new Secret Manager secret, and the fix — granting it — is
  now a recorded lesson: every new secret needs the accessor grant before
  deploy *(working record)*.
- Push notifications (#127, inbox push V5/V6): Firebase setup, FCM, and a
  Cloud Scheduler job ticking `/api/push/tick` once a minute (#154),
  after a slow-query alert investigation traced the "slow database
  queries" to the in-process tick running on CPU-throttled instances —
  not the database at all. Both the Firebase setup and the Scheduler job
  were then imported into Terraform (#152, #155).
- The store: account-loaded promo codes with an admin ledger for
  corrections and refunds (#148); Android sand-buck purchases that finish
  after the server confirms, recover unfinished ones, and price in bulk
  (#134); paid extra tries on the claw and vending machines, 10 sand
  bucks each (#139).
- Play: build 6 (#136) then build 7 (#151), the first push-capable build,
  released to internal testing and promoted to closed testing the same
  day; the merchant account and all five `bucks_*` products went live,
  renamed to beech bucks *(working record)*. iOS build 7 was submitted
  for Beta App Review in TestFlight the same evening *(working record)*.
- The Discord loop was running all day: a player-reported bug (spaces
  swallowed while typing visitor notes) was reproduced from the report,
  fixed in #123, and the player was told when it shipped; a pier-placement
  report from Rose became #140 the same day *(working record)*.

## 27 November — shore sign-in, and the polish pass

28 PRs merged (UTC date; in Mark's timezone this was the evening of the
26th).

- Sign in with Apple + Google on `beechshore.com`, and link sign-ins there
  (#177): the account page signs in with Google or Apple right there and
  mints a 1-hour shore token — the page never holds a game session — and
  links more sign-ins under the shore token. The two portal steps it
  needed were done the same day: `beechshore.com` added to the Apple
  Services ID and to the Google web OAuth client's authorized origins
  *(working record)*.
- Promo codes became bonus-only: Mark's one-line steer — "Change promo
  codes to always be for bonus bb. Support percentage bonus only" — turned
  #148's fixed/discount model into percent-only bonus beech bucks (#169),
  model-first (`PromoBucks.tla`). Trade in several things at once (#170,
  model-first `TradeMany`), sand extensions behind a beach became playable
  sand (#168), piers were raised clear of storm waves at the highest tide
  (#175), paid shop items were scaled up 1.5× (#176), and the copy-beach
  basket follow-up closed because beech bucks had already done it (#181).
- Push alerts (#171), admin system messages to every inbox at most once a
  day (#180), an admin Beech bucks tab (#163, 26 Nov) and Referrals tab
  (#159), ratings along the shore (#160), the status pane's stars and
  finds-today chips (#172), and an E2E pass that stopped WebGL draws
  except when screenshotting (#178).
- The domains sweep from the 25th closed out: FortiGuard reclassified
  `beech.games` and `beechgames.com` to Games *(working record)*.

## How the collaboration works

The mechanics are the story as much as the features. They are written
down in the repo itself (`CLAUDE.md`, `AGENTS.md` in the working record),
and this week exercised all of them.

- **One worktree per agent, always.** Every agent working on Beech gets
  its own local git worktree off `origin/main`; nobody shares a checkout
  and nobody touches another agent's worktree. Stashes are banned in the
  shared repo — they are shared across worktrees, so one agent's stash can
  surface another agent's draft changes (a lesson from PR #134).
- **Everything lands through pull requests.** Mark's rule from 22
  November: no direct commits to `main` for fixes and features, even small
  ones; the merge rule is "once it looks good and CI is green, squash and
  merge." The one exception the week kept is the direct-commit path for
  small, high-confidence changes that `CLAUDE.md` still allows — the
  first day was built that way.
- **Review agents check each PR before it lands.** The shared `review-pr`
  skill was itself shared with the Codex and Claude sessions (#130), so
  the same review ran everywhere. A review verdict is READY or NEEDS WORK
  with specific blockers; a NEEDS WORK verdict spawns a fix-up agent that
  rebases, renumbers a migration, or fixes the failing check, and the PR
  is re-reviewed before merging. This week that loop caught a migration
  number collision on #128 (both #127 and #128 numbered theirs 33), a
  `creatorCredit.dfy` datatype the PR had not updated (#133), and a
  migration that would have dropped the `merge` ledger kind (#148).
- **Parallel sessions land alongside.** More than one session works the
  repo at once — #145 and #146 were merged by the parallel session while
  other PRs were being reviewed, and #142 was merged by it while its
  re-review was still in flight. The cost is rebase churn (main moved
  under #177 twice); the benefit is that a day like the 26th can land 40
  PRs.
- **Model-first.** Anything that changes state the server keeps starts
  with a TLA+ spec, and the spec decides the transaction and locking.
  The week's model-first PRs name their specs in the title: `PromoBucks`,
  `TradeMany`, `NoteSuspension`. Verification is `lsc check` with Dafny
  behind it, and it must pass before every commit where a spec exists.
- **Mark steers in one line.** The week's decisions arrived as short
  messages and were applied across the whole task, not just the row
  mentioned: "Lets do it" (beech bucks), "Change promo codes to always be
  for bonus bb", "Keep the free API as-is" (Open-Meteo), "Leave it public
  for now" (the repo), "No, I'll handle the trade-in myself" (Pixel).
  When a decision names a different priority — "Stop x sign up task for
  now. Let's setup domains first" (23 Nov) — the stopped task is parked,
  not closed, and not re-raised until he resumes it.
- **The human does the portal steps.** Agents do the code, the review and
  the deploy; the steps that need a person happen in Mark's hands or his
  browser: Apple API keys created on his laptop, the Play Console in the
  device browser (the cloud browser's saved Google password is rejected
  there), the App Store Connect API key, the Services ID edits.
- **The Discord loop.** A monitor watches the Beech Discord server
  (#feedback, #bugs, #general) every five minutes, the bot acknowledges
  new posts in-channel, reproducible bugs become PRs, and when the fix is
  live the bot replies to the original message that it shipped (Mark's
  rule, 24 Nov). Player requests that shipped this week include the
  beech-bucks rename, the pier ghost preview, the pier-in-the-bag hint,
  and the visitor-note spaces fix. Feature requests that conflict with a
  shipped design — more than one pet per beach, against #133's one-pet
  rule — are surfaced to Mark as decisions, not built silently.
- **Release notes are the player's record.** Every player-noticeable
  change adds a plain-words line to `server/src/releaseNotes.ts` in the
  same commit, shown at `beech.games/guide/releases`. A missing line is a
  review blocker — #138 and #141 exist only because of it.

## Still open (at time of writing)

From `docs/BACKLOG.md` and the working record: the sandcastle mini-game
is still a to-do, not built; Steam's five microtransaction item
definitions (1101–1105) still need creating; Xsolla's sandbox checkout is
still blocked on error 0401-2000, with partner support emailed 26 November
and awaiting a reply; Stripe setup as a backup (and a possible future
merch store) has started, with merchant onboarding pending; promo codes on
web card payments still need mirroring into Xsolla; the 15% Play
service-fee program is deliberately not enrolled until after launch; the
end-to-end Apple/Google click-through on `beechshore.com` is still
untested; and a diagonal brown line in the beach render, reported 26
November, was being investigated with no PR open at time of writing.

## Sources and limits

Ground truth, in order: `git log` on `origin/main` (317 commits,
22–27 November 2026), `gh pr list --state all` (170 merged PRs; counts by
UTC merge date), `server/src/releaseNotes.ts` (what players got, by day),
`docs/STATUS.md` and `docs/BACKLOG.md` (state and open work), `CLAUDE.md`
(the working rules). Items marked *(working record)* — domain
registration, the Discord loop, Mark's one-line decisions, portal and
console steps, the Apple-deploy secret failure, the slow-query
investigation, the Play/TestFlight rollout — come from the session record
kept alongside the repo, not from the repo itself. Anything the record did
not support was left out. The one attribution the repo cannot give is who
wrote what: every PR is authored `markjen`, so "Rosie", "subagent" and
"parallel session" in this log describe roles in the workflow, not GitHub
authors.
