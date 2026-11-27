# Antigravity Work Log — `beech`

A chronological log of Antigravity's contributions to `markjen/beech`, written as source material for the multi-agent collaboration story.

## Summary

Across two sprints (**Nov 24** and **Nov 26, 2026**), Antigravity shipped **6 merged pull requests** (`#52`, `#73`, `#145`, `#146`, `#153`, `#148`), spanning **113 file changes** (`+8,015 / -1,081` lines) across the desktop/Steam shell, in-game HUD and shop UX, `beechshore.com` navigation, 3D rendering and simulation performance, formal TLA+ verification, database migrations, and admin console tooling.

| Date | PR | Commit | Area | Summary |
| --- | --- | --- | --- | --- |
| 2026-11-24 | [#52](https://github.com/markjen/beech/pull/52) | `dd54383` | Platform / Steam | Steam S1: runtime abstraction, Electron + Steamworks shell, and SteamPipe workflow |
| 2026-11-24 | [#73](https://github.com/markjen/beech/pull/73) | `d95a0ae` | In-Game HUD / UX | Combine sand tools, reorder bulldozer, add collapse pan mode, float neighbor tags on side |
| 2026-11-26 | [#145](https://github.com/markjen/beech/pull/145) | `700fc15` | Web (`beechshore.com`) | Simplify and reorganize `beechshore.com` navigation *(co-polished with Claude)* |
| 2026-11-26 | [#146](https://github.com/markjen/beech/pull/146) | `ebedb03` | In-Game Shop UX | Improve store UI navigation with category tabs and sticky header *(co-polished with Claude)* |
| 2026-11-26 | [#153](https://github.com/markjen/beech/pull/153) | `8f62771` | Performance / Bundle | Optimize simulation tick, main-thread camera allocations, and client JS bundle size |
| 2026-11-26 | [#148](https://github.com/markjen/beech/pull/148) | `1849a4e` | Economy / TLA+ / Admin | Account-loaded promo codes for `bb` packs + admin ledger corrections & refunds |

---

## Sprint 1 — Nov 24, 2026: Desktop Foundation & In-Game Feel

### 1. Steam S1: Runtime Abstraction, Electron + Steamworks Shell & SteamPipe Workflow
- **PR:** [#52](https://github.com/markjen/beech/pull/52) (`feat/steam-s1-shell`) · **Commit:** `dd54383` · **Diff:** 33 files (`+4,933 / -45`)
- **What we built:**
  - Authored the Steam packaging and shipping plan in `docs/STEAM.md` and added owner prerequisites plus S2–S6 milestones to `docs/BACKLOG.md`.
  - Introduced `src/platform/runtime.ts` (`getRuntime`, `isSteam`, `isMobileApp`, `isPackagedApp`, `steamBridge`) and migrated all 9 `Capacitor.isNativePlatform()` call sites so web, mobile, and Steam builds share a single platform abstraction.
  - Scaffolded the `desktop/` Electron + `steamworks.js` shell: privileged `app://beech/` protocol, pre-`whenReady` Steamworks + Steam Overlay initialization, typed `window.beechSteam` preload bridge, OS Save dialog, fullscreen toggle, Quit button in Settings, and unpacked `dir` targets for Windows x64 and Linux x64/SteamOS.
  - Wired `app://beech` into default `ALLOWED_ORIGINS`, added `build:steam` to `package.json`, registered `desktop/package.json` in `scripts/set-version.mjs`, and added a gated manual SteamPipe release workflow (`.github/workflows/release-steam.yml`).
- **Verification:** `npm test` (including new `tests/runtime.test.ts` and Steam cases in `tests/shopCodes.test.ts` and `tests/quality.test.ts`), `npm run build`, `npm run build:steam`, and `server/` typecheck + 176/176 tests.

### 2. Grouped Sand Tools, Collapsed Pan Mode & Side-Floating Neighbor Tags
- **PR:** [#73](https://github.com/markjen/beech/pull/73) (`tools-collapse-side-tags`) · **Commit:** `d95a0ae` · **Diff:** 19 files (`+263 / -90`)
- **What we built:**
  - **Combined Sand tool group** (matching Bulldozer/Clearing): defaults to **Dig** (new shovel icon), followed by **Build up** (sand dune icon) and **Blend** (rake icon), while preserving `1`–`5` keyboard shortcuts.
  - **Bulldozer / Clearing tool reorder & icon:** defaults to **Bulldozer** at the top, followed by **Flatten sand** and **Vacuum items** (with a new upright vacuum icon).
  - **Collapsed pan mode:** added a bottom-left hide-toolbars toggle (eye icon) plus `H` / `Escape` shortcuts to collapse all toolbars and overlays into a single subtle corner restore button while forcing look/pan mode for distraction-free exploring.
  - **Side-floating neighbor tags:** updated `placeTag` (`src/ui/tagPlace.ts`) and `Neighbors` (`src/render/neighbors.ts`) so other players' name tags float along the left and right screen edges—avoiding HUD controls and stacking cleanly—instead of sitting over the middle of the beach.
  - Updated unit tests (`tests/clearing.test.ts`, `tests/tagPlace.test.ts`), E2E tool selectors across 7 E2E scripts, the in-game guide (`server/src/guide.ts`), and release notes.
- **Verification:** `npm run build`, `npm test` (31 test files, 230 tests), and headless Chromium visual verification on desktop and mobile (`390×844`).

---

## Sprint 2 — Nov 26, 2026: Navigation, Performance & Economy Infrastructure

### 3. Simplify & Reorganize `beechshore.com` Navigation
- **PR:** [#145](https://github.com/markjen/beech/pull/145) (`beechshore-nav`) · **Commit:** `700fc15` · **Diff:** 6 files (`+77 / -28`)
- **What we built:**
  - Replaced the crowded 7-link flat header nav (`Most loved`, `Submit an item`, `Rising`, `Just built`, `Items`, `Surprise me`, `Account`) with two primary browse links (**Beaches**, **Items**) on the left and **Account** (with user icon) in the right-hand utility group next to Search and `Build a beach`.
  - Moved `Surprise me` into the `Beaches` sub-nav tabs (`Most loved` | `Rising this week` | `Just built` | `Surprise me`) and added a `← All beaches` link on place pages.
  - Added matching sub-nav tabs under `Items` (`All items` | `Submit an item` | `Asset spec`) so browsing and submitting items live together under one section.
  - Switched to the compact `.mob-nav` at `900px` so header items never clip on tablet/laptop viewports, and reorganized footer links.
- **Agent collaboration:** Claude Opus 5.5 reviewed the PR and added the matching `Asset spec` tab on `/items` so `/items`, `/submit`, and `/submit/spec` shared identical sub-navigation.

### 4. Improve In-Game Store UI Navigation
- **PR:** [#146](https://github.com/markjen/beech/pull/146) (`shop-navigation-ui`) · **Commit:** `ebedb03` · **Diff:** 7 files (`+457 / -80`)
- **What we built:**
  - Redesigned the in-game shop modal (`src/ui/shop.ts`, `src/ui/hud.css`) with **category tabs** (`All`, `Beaches`, `Items`, `Pets`, `bb`), keyboard arrow/`Home`/`End` navigation, and a **sticky header** keeping the title, balance, status line, `+ bb` jump button, and close button pinned while scrolling.
  - Wired `open('packs')`, `+ bb`, and unaffordable price pills to jump straight to the `bb` tab.
  - Refined item cards, widened the desktop modal (`min(500px, 100%)`), preserved scroll position across purchases, and added unit tests in `tests/shopNav.test.ts`.
- **Agent collaboration:** Claude Opus 5.5 rebased the branch onto `#144` (the sand bucks → beech bucks rename), fixed a subtle keyboard-focus bug where `renderTabs()` rebuilt buttons and dropped focus to `<body>`, updated the Shop guide section, and fixed stale `(bb)` assertions in `account-e2e.mjs` and `copy-e2e.mjs`.

### 5. Performance & Client JS Bundle Size Optimization Pass
- **PR:** [#153](https://github.com/markjen/beech/pull/153) (`perf/bundle-and-sim-pass`) · **Commit:** `8f62771` · **Diff:** 10 files (`+584 / -181`)
- **What we built:**
  - **Bundle size reductions:**
    - Replaced Babylon's `ArcRotateCamera` and `FreeCamera` with `TargetCamera` + a lightweight `OrbitCamera` subclass (`src/input/cameraController.ts`), shedding unused camera inputs, behaviors, collisions, and the `Animations` subsystem (**−85 KB raw / −18 KB gzip**).
    - Replaced `Sky`'s Babylon `Layer` + `DynamicTexture` with a fullscreen clip-space triangle `Mesh`, `ShaderMaterial`, and `RawTexture` (`src/render/sky.ts`), shedding layer components and shader chunks (**−12 KB raw / −4 KB gzip**).
    - Extracted brush/sand/clearing predicates to `src/sim/modes.ts` and lazy-loaded `BeachSim` in `BeachStore`, plus code-split on-demand modals (`beachFileDialog`, `AccountPanel`, `Shop`, `ClawMachine`, `VendingMachine`, `CopySheet`, `Leaderboard`, `SocialHub`, `DigFind`, `PierPreview`, etc.).
    - Lowered `perf/budget.json` gates (`mainJsGzipKB: 350 → 330`, `totalJsGzipKB: 450 → 430`) and documented the pass in `docs/PERFORMANCE.md`.
  - **Runtime simulation & main-thread speedups:**
    - Optimized `BeachSim.flow()` (`src/sim/beachSim.ts`): skipped dead `vx`/`vy` work on non-final substeps, threaded `wetTop` across substeps, hoisted boundary checks, and added a deep-water fast-path in Pass 1.
    - Short-circuited `erode()` division/`Math.sqrt` when `g2 <= minG2`, and skipped dry rows above `wetTop` in `updateWetFoam()`.
    - Reused scratch `Vector3` and `Matrix` instances in `cameraController.ts` to eliminate per-frame allocations.
- **Measured impact:**
  - Sandbox main JS gzip: `349.8 KB → 313.8 KB` (**−10.3%**); Production (`VITE_ACCOUNTS=1`) main JS gzip: `401.3 KB → 344.3 KB` (**−14.2%**).
  - Simulation tick (`npm run perf:sim`): low `5.85 → 5.37 ms` (**−8.2%**), medium `9.96 → 9.40 ms` (**−5.6%**), high `15.47 → 14.06 ms` (**−9.1%**; `flow` **−11% to −14%**).

### 6. Account-Loaded Promo Codes for `bb` Packs + Admin Ledger Corrections & Refunds
- **PR:** [#148](https://github.com/markjen/beech/pull/148) (`promo-codes-and-admin-ledger`) · **Commit:** `1849a4e` · **Diff:** 38 files (`+1,699 / -657`)
- **What we built:**
  - **Model-first TLA+ spec:** Wrote `specs/tla/PromoCodes.tla` (`PromoCodesFixed.cfg` passes TLC with 0 errors; unfixed `PromoCodes.cfg` catches the concurrent `maxUses` race) and documented it in `docs/STATE_MACHINES.md`.
  - **Database (Migration 40):** Added `account_promo_codes` (unique `(user_id, code)`), added `purchase_id` and `bonus_bucks` to `promo_uses`, extended `credit_ledger_kind_check` with `promo_bonus`, `promo_bonus_refund`, `admin_adjustment`, and `admin_refund`, and tightened `promo_codes_kind_check` to `percent`-only.
  - **Collect & auto-apply best deal (`server/src/promos.ts`, `bucksDb.ts`):** Players can load multiple promo codes via in-game shop (`POST /promo-codes/load`) or `beechshore.com/account` (`POST /account/api/promo-codes`). On any `bb` pack purchase (Apple, Google, Steam, Xsolla, or dev), `grantPurchase` locks the buyer's unused codes, picks the eligible code giving the largest bonus `bb`, atomically claims it (falling through if another buyer took the last use), and credits a separate `promo_bonus` ledger entry. Refunds claw back both base `bb` and `promo_bonus`.
  - **Removed legacy credit-purchase discount path:** `POST /api/store/quote` and `/api/store/credit-purchase` now refuse `promoCode` with 400; deleted obsolete Dafny specs (`giftCards.dfy` / `giftCards.dfy.gen`).
  - **Admin Console — Users & Ledger tab (`server/src/adminApp.ts`, `adminPage.ts`):** Added user search (`GET /api/users`, `GET /api/users/:id`), positive/negative ledger adjustments & refunds (`POST /api/users/:id/ledger`), debt forgiveness (`POST /api/users/:id/forgive-debt`), and full purchase revocation/refund (`POST /api/purchases/:id/refund`), all with `admin_audit` logging.
- **Agent collaboration:** Later in `#169`, Claude built on this model to formalize the bonus-only promo invariant in `PromoBucks.tla`.

---

## Themes for the Collaboration Story

- **Cross-stack range:** From Electron/Steamworks native shells (`#52`) and WebGL/Babylon.js shader & simulation hot loops (`#153`) to TLA+ concurrency proofs and Postgres migrations (`#148`).
- **Seamless agent handoffs:** Antigravity and Claude Opus 5.5 worked directly on the same PRs (`#145`, `#146`)—Antigravity designing and implementing the UI/navigation overhauls, Claude rebasing onto parallel currency renames (`#144`) and catching focus/E2E edge cases—and extended each other's formal models (`PromoCodes.tla` in `#148` → `PromoBucks.tla` in `#169`).
