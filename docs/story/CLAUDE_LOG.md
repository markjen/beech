# Claude's log: building Beech

Source material for the agent collaboration story. Written by Claude (Claude Code,
cloud sessions) on 2026-11-27.

**How this was written.** Claude does not remember earlier sessions; each cloud
session starts fresh in a new container. I rebuilt this log from the repository:
317 commits on `main` from 2026-11-22 to 2026-11-26, their `Co-Authored-By` and
`Claude-Session` trailers, PR numbers, and the docs. Read it as an account of
what the history shows. It is not a diary.

## The cast, as the commits show it

| Contributor | Trace in git |
|---|---|
| Mark Jen (owner) | Author of every commit. Set the direction, owner-only steps (store accounts, domains, secrets, Pages, signing), reviews and merges. |
| Claude (Claude Code) | 137 `Co-Authored-By: Claude Opus 5.5` trailers plus 51 plain `Co-authored-by: Claude`, across at least 33 distinct `Claude-Session` links. Branch names `ccr-*` and `claude/*`. |
| Antigravity | 6 co-authored commits. |
| Codex | 1 co-authored commit. The review-pr skill is shared with Codex sessions (#130). |
| Rosie / Rose | 8 co-authored commits. Discord feedback became backlog items (#57). |
| "Muse" | Named in a merge: "Merge main (Muse's fixes, #8, #9)". |

## How the work was organised

The repo was built so that any agent could pick up any task with no other context:

- `CLAUDE.md` is the agent guide: read PLAN → STATUS → ARCHITECTURE → BACKLOG.
- `docs/STATUS.md` and `docs/BACKLOG.md` are shared memory between sessions. Each change updates them in the same commit.
- Many sessions ran in parallel on their own `ccr-*` branches. You can see this in the history as dates that jump back and forth, and in "Merge main (...) into ..." commits, where one agent pulled in another's finished PRs.
- Ground rules kept the parallel work safe: tests and build before every commit, the app stays playable after every commit, perf budgets checked in CI, screenshots before visual changes, release notes for every change a player can notice, and no explanatory notes in the game UI.
- Later, process tooling for agents: rtk to keep tool output small, LemmaScript + Dafny verification, a TLA+ **model-first** workflow, and a shared review-pr skill.

## Timeline

### Day 1: Sun 22 Nov, from a plan to a shipped toy (and much more)
- **The plan.** "Add game plan for Beech beach simulator" (`PLAN.md`). The milestones came after it in a single day:
  - M0+M1: Vite/TS/Babylon scaffold, simulation core, diorama renderer.
  - M2: digging, with a brush that stays the same size on screen, plus undo and redo.
  - M3+M4: waves, foam, wet sand, erosion, a tuning panel.
  - M5: procedural audio, haptics, day-cycle palettes.
  - M6: quality tiers, PWA, Capacitor iOS/Android.
  - M7: shells washing in.
- **Real beaches.** Live sun, moon and tides at 13 famous beaches.
- **Accounts.** These started on a Cloudflare Worker + D1, then moved the same day to **Google Cloud (Cloud Run + Cloud SQL)**, with Terraform (five commits named "Add Terraform…" show the iteration).
- **Native sign-in.** Google on Android and iOS, plus Sign in with Apple.
- **Gameplay.** Inventory (rocks, driftwood, shells, sea glass, flags), live neighbours, a chair view with a dolly-zoom, a walk along the shore, the free daily claw machine, the bulldozer, a 32×32 m world, and wave sets.
- **First parallel PRs.** #7–#23 landed: TV casting, observability, sharing and gifting, a world map, a claw that can miss, the vending machine, digging finds, gift cards and promos.

### Day 2: Mon 23 Nov, money, more than one beach, and launch prep
- Multi-beach support on the server and in the app.
- Shop purchases checked with Apple and Google ("never by us").
- A leaderboard of most-starred beaches.
- **Beach files** (export/import), shipped as E1–E4 from a spec.
- **Checkpoints**, shipped as C1–C5 from a design.
- Xsolla web checkout (the plan in #21, then the build). The admin console split into its own app.
- **Release 1.0.0 (build 1)** for the first Play Store upload (#25).
- A performance push:
  - Things drawn as GPU instances, raising a beach's limit from 400 to 2000 things.
  - `npm run perf` with budgets in CI.
  - A sim tick about 40% faster.
- **beechshore.com**, a public browser of every beach, plus the beech.games landing page, Play Store assets, and Discord links.

### Day 3: Tue 24 Nov, the busiest day (~80 commits)
- Long-press to drag things, a "found" collection, checkpoint thumbnails, and a sandbox that keeps its checkpoints on the device.
- The "spire spike" bug fix (#41): overlapping rocks no longer stack their lifts.
- **Steam S1–S4**: Electron + Steamworks, Steam auth, wallet checkout, achievements and a controller.
- An item catalog with a render harness, followed by content PRs (#59–#66): wash-ashore finds, Vending Week 2, claw coral and coconut, shop centrepieces. Each was integrated by a second pass that fixed renders and tests.
- **Animals A1–A5**: sand crab, snacks, resident pets, visitor feeding, dolphin.
- Item submissions with creator credits, and a catalog with votes.
- Invites, the visitors inbox, editing owned beaches, one active editor per person, auto-checkpoints.
- **Live beaches L1–L5**: the sea keeps working while you're away, and viewers watch live.
- The palm-first UI (#99).

### Day 4: Wed 25 Nov, correctness and agent tooling
- Footprints, local weather, and snack placement.
- A server permissions audit (#107).
- Agent tooling: rtk token savings, then **formal verification** with LemmaScript and Dafny (#112).
- **TLA+ models of the game's state machines**. These found and fixed five races and set the model-first workflow (#113).
- Copying a beach, and sand bucks with trade-ins (#118).
- Android builds 4 and 5, plus sign-in diagnostics.

### Day 5: Thu 26 Nov, ~60 commits of breadth
- Piers and inland sections, both designed first and then built (#128, #150).
- Push notifications on web, mobile and Steam.
- Real weather from Open-Meteo, and 21 more real beaches.
- Six pet species.
- Paid extra tries on the claw and vending machines.
- Sand bucks renamed to **beech bucks (bb)**.
- Account linking and merging, Apple sign-in on the web and on beechshore.
- Terraform for Firebase and Cloud Scheduler.
- Admin tabs for referrals, bucks and note suspension.
- Several features went **model first**, each with its own TLA+ spec: NoteSuspension.tla, PromoBucks.tla, TradeMany, system messages.
- Fixed the flaky E2E tests (#178).

## Things the story could highlight

1. **Docs as shared memory.** STATUS and BACKLOG worked as the handoff between agents that never met.
2. **Parallel agents, serial main.** Many branches merged without breaking main because of the test, build, perf and playable-every-commit gates.
3. **Integration passes.** One agent's content PR was often finished by another ("Integrate … and fix renders").
4. **The rules tightened over time.** It began with tests only, then added perf budgets, then formal verification, then TLA+ models before any code. Each step followed real bugs, such as the five races.
5. **Human-only steps.** Domains, store consoles, signing keys, Pages and secrets stayed with the owner. The agents wrote the checklists for them (MOBILE.md, GCP.md).
6. **Feedback from people.** Discord feedback from Rose became backlog items, and the claw's starter gifts stay a surprise (#9).

## Caveats
- The Claude session count (33) is a lower bound. Older commits used a plain `Co-authored-by: Claude` with no session link.
- Commit dates are author dates, so parallel branches appear out of order.
- For each session's own account, the Claude session links in the trailers lead to the full transcripts.
