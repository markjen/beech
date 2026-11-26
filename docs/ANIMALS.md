# Animals (design)

Status: **A1–A5 built** (wild sand crab, beach snacks & feeding, resident pets,
visitor feeding, offshore dolphin — 2026-11-24). **Six species, pets as
movable things: [PETS.md](PETS.md)** (2026-11-26).

Animals bring quiet life to the beach without turning it into a busy zoo. We
start small — **one animal species (sand crab)**, showing up rarely and leaving
on its own — and design the seams so food, feeding, and resident pets layer on
cleanly later.

## Principles

- **Quiet first.** Most of the time, there is no animal on the beach at all.
  Seeing one should feel like a small moment you notice while digging or
  watching the waves, not background clutter.
- **One animal at a time.** Start with a single species and at most one wild
  visitor on screen. Add more species only after the first feels right.
- **Cozy, never punishing.** Feeding is a pleasant way to invite or linger with
  an animal; pets never die, get sick, or permanently run away if you take a
  week off.
- **Fits both views.** Readable from the diorama (default 34° ortho view,
  32 × 32 m slab) and charming up close when zoomed in or sitting in chair view.
- **No notes in the game UI.** Follow the existing rule: only labels, status,
  and confirmations in-app. Full rules and odds live in `beech.games/guide`
  (`server/src/guide.ts`).
- **Light on performance.** Stay inside `perf/budget.json` (1–2 draw calls when
  visible, 0 extra draw calls when absent, zero per-frame allocations, no
  changes to the 30 Hz water/sand worker hot loop).

---

## Choosing the first animal

The beach world is 32 × 32 m: roughly 16.5 m of simulated water (`j = 0` to
`PROFILE.shoreline`) plus the far-ocean apron/open sea, and 15.5 m of sand
(`shoreline` to the back berm).

| Candidate | Where it lives | Diorama read | Chair-view read | Interaction with sand & player | Complexity |
|---|---|---|---|---|---|
| **Sand crab** | Wet & dry sand near the waterline (`z ≈ 15–26 m`) | Good if slightly stylized (25–35 cm across, like shells are larger than life); bright coral/terracotta shell contrasts with warm sand | Great — scurries right past the chair | Highest: follows live sand height, dodges incoming waves, scurries away from your digging brush, ducks into a little sand burrow to leave | Low–medium: single low-poly body + claws + scuttling legs (procedural vertex wiggle or tiny hierarchy), simple 2D steering on the heightfield |
| **Bird (seagull / sandpiper)** | Walks/pecks along the swash zone; arrives and leaves by gliding in from off-slab | Strong — white/grey silhouette with wing motion reads clearly at full zoom-out | Great — flies across the horizon and lands on the wet sand | Medium: hops away from your brush and big waves; ties naturally into the existing procedural gull call in `src/audio/ambience.ts` | Medium: needs both ground-walk and flight-arc states plus wing flap |
| **Dolphin** | Offshore water (`z ≈ 2–12 m`, deeper than ~0.7 m) or just past the surf | Strong — breaching arc + splash ring in the blue water is unmistakable from above | Great — leaps across the sea in front of your chair | Lower in Phase 1 (doesn't touch your sand), but natural to toss fish/food into the surf in Phase 2 | Medium: spline/arc breach animation, water-entry splash ring, stays clear of shallow sandbars |
| **Whale** | Far ocean (`z < 0`, out on the apron / open-sea horizon) | Subtle in diorama (apron fades by ~17 m offshore, so it must stay close to the edge or scale down) | Dramatic — spout and fluke on the open horizon | Lowest (distant spectacle; awkward to "feed" or keep as a beach pet later) | Low for a distant spout/fluke, higher if it swims close |

### Decision for v1: sand crab

We start with the **sand crab**:

- **Crab** is the strongest bridge across all three phases: it runs directly on
  the sand you sculpted, reacts to your brush and waves, naturally eats a piece
  of food dropped on the sand, and makes an endearing resident beach pet in
  Phase 3 (it already has a cozy "burrows into the sand to sleep" state when
  unfed).
- **Dolphin** is a natural second species later (water counterpart to a land
  animal), **seagull** ties into the existing gull audio, and **whale** fits
  best as a rare scenic horizon event rather than a fed pet.

The architecture stays species-agnostic so future species plug in as modules.

---

## Phase 1: Rare wild visitor (MVP)

**Goal:** One wild animal occasionally visits your beach, behaves believably on
the live sand/water, and leaves on its own. Works in both the sandbox and
production builds, with zero server changes.

### Presence & pacing

- **Empty most of the time.** *(Superseded 2026-11-24: now ~50% uptime, see STATUS.md.)* Target roughly **10–15% uptime** during an
  unbaited session:
  - After boot (or after a visitor leaves), roll a quiet wait of **4–12 minutes**
    (uniform or triangular distribution, tuned in `src/config.ts`).
  - When the wait expires, roll a visit chance (e.g. **65%**); on a miss, wait
    another quiet interval. This guarantees players can easily spend 10–20
    minutes with an empty beach and still be pleasantly surprised.
  - A visit lasts **45–120 seconds** unless startled away early.
  - At most **1 wild animal** at a time.
- **Time-of-day & tide awareness (optional light touch):**
  - Crabs appear any time (slightly more active at dawn/dusk/night or low tide
    if desired, never 0% so players always have a chance).
  - Birds only visit in daylight (`daylight > 0.2`, matching `Ambience`'s
    existing gull rule).
- **Deterministic / debuggable:** `?debug=1` gets a "Spawn animal" button and
  live state readout (next spawn countdown, current state) so testing and
  screenshots (`scripts/shot.mjs`) don't have to wait 10 minutes.

### Behaviour state machine (crab example)

All movement reads the latest sand height and water depth already copied to the
main thread (the same heightfield `SandPicker` uses), so the sim worker is
untouched:

1. **Enter:** Emerges from a small sand mound near the dry/damp boundary (or
   walks in from the left/right slab edge if not linked to a neighbor).
2. **Wander / forage:** Scurries sideways in short bursts (0.6–1.4 m/s for
   1–2.5 s), pauses to look around / wave claws (1–4 s), picks a new target on
   damp or dry sand (`depth < 0.03 m`, inside the 32 × 32 m slab with a 1.5 m
   margin).
3. **React to environment:**
   - **Wave wash:** If water depth at the crab exceeds ~4 cm, it darts upslope
     toward drier sand (or hunkers briefly if caught by thin swash).
   - **Player brush:** While digging/building/flattening within ~2.5 m, it
     scurries away from the brush point. Repeatedly chasing it (e.g. 3
     startles) makes it leave early.
   - **Obstacles:** Steers around placed rocks and large shop pieces (reads the
     main thread's current object list).
4. **Leave:** After its visit timer expires (or after being startled too often),
   picks a dry spot, does a quick burrow-down animation (or walks off the slab
   edge), and despawns cleanly.

### Rendering & audio

- **Procedural mesh** in `src/render/animals.ts` (using `src/render/meshKit.ts`
  and colours in `src/palette.ts` so it responds to dawn/day/golden/dusk/night
  lighting just like props).
- **Single draw call:** One merged mesh (or 2 max) with simple vertex-shader
  animation (leg scuttle driven by a `uPhase` / `uSpeed` uniform, subtle claw
  bob), or a tiny transform rig hidden (`setEnabled(false)`) when no animal is
  present. Because `perf/budget.json` budgets `scenes.0.drawCallsPerFrame: 12`
  (currently 10), keeping the animal disabled when absent means **0 extra draw
  calls** in the idle benchmark and **+1 draw call** when visible.
- **No save-file impact:** Wild visitors are ephemeral client-side life — they
  are **not** written into `BCH3` saves, `.beach.json`, or `MAX_OBJECTS`
  (2000). They never block placement or undo.
- **Audio (subtle):** Optional soft procedural cue in `src/audio/ambience.ts`
  (e.g. faint sand scuttle only when zoomed in close, or tying a visual gull to
  the existing gull call).

### Module plan (Phase 1)

| Path | Responsibility |
|---|---|
| `src/config.ts` | `ANIMALS` tuning block (wait min/max, visit duration, speed, flee radius, max count) |
| `src/palette.ts` | Animal palette colours (e.g. crab shell, claws, eyes) |
| `src/world/animals.ts` | Pure-TS state machine & steering (no DOM/Babylon, unit-testable in Vitest) |
| `src/render/animals.ts` | Procedural mesh, lit shader material, per-frame pose & hide/show |
| `src/main.ts` | Tick controller in render loop; pass sand/water sampler, brush point, daylight |
| `src/ui/debug.ts` | Debug spawn button & state readout |
| `tests/animals.test.ts` | Unit tests: spawn timing distribution, bounds clamping, wave/brush avoidance, despawn |

---

## Phase 2: Food & feeding

**Goal:** Players can obtain food and place/toss it on the beach to attract wild
animals more often and keep visiting animals around longer.

### How feeding works

- **Food items** live in the normal bag (`src/world/items.ts`) as consumables
  (e.g. `crab-treat` / "Beach snacks", or species-specific treats once multiple
  species exist).
- **Placing food:** Pick the food from the bag and tap the sand (or water for a
  sea animal) to drop a small portion (e.g. a little pile of kelp/crumbs or
  shrimp bits). It sits visibly on the sand as a temporary treat (not saved in
  `BCH3` forever — expires after e.g. 15 minutes if uneaten, or swept away by a
  big wave).
- **Effect when an animal is present:**
  - The animal notices food within ~10 m, scurries over, pauses to nibble (with
    a small happy particle/heart or claw-wave cue), and consumes it.
  - Its remaining visit duration extends (e.g. **+3 to 5 minutes**, capped so a
    wild visitor still eventually wanders off) and it becomes less skittish
    around your brush for a while.
- **Effect when no animal is present (bait):**
  - Dropped food acts as bait: while active, the wait timer runs faster (e.g.
    **3–4× faster** spawn rate, or rolls a boosted arrival within 30–90 s).
  - Once an animal arrives, it heads straight for the food and eats it.
- **Server-side consumption (production builds):**
  - Dropping food calls `POST /api/animals/feed` (or decrements the consumable
    stack atomically in `inventory`), returning the updated count.
  - Sandbox build: either disabled (like the shop/claw) or offers a free sample
    snack so the interaction can be tested offline.

### Economy & shop fit

Beech's pricing rule (`docs/PRICING.md`): free to play forever, no loot boxes,
no subscriptions, no pay-to-win. Food uses a **free + shop** mix:

- **Free trickle:** Occasional free treats earned through existing free loops
  (daily vending machine, claw machine, or digging finds), so every player can
  experience feeding without paying.
- **Consumable packs in the shop** (`server/src/products.ts`): a small
  entry-price pack (`food_pack_10` — 10 beach treats for **$0.99**, matching the
  entry price of a parasol/towel, plus a larger bundle for **$2.99**) for
  players who want to stock up.

---

## Phase 3: Resident pets & visitor feeding

**Goal:** A player can adopt a pet that permanently lives on a specific beach,
asks to be fed via gentle notifications, and can also be fed by friends and
visitors walking the shore.

### Adoption (two paths)

Players can get a resident pet on a beach in either of two ways:

1. **Befriend by feeding (free path):** Each time you feed a wild visitor of a
   species on a beach, the server increments a per-beach bond counter
   (`wild_feed_progress`, e.g. threshold of ~10–15 feeds). Once you reach the
   threshold (and the beach doesn't already have a pet), the wild animal decides
   to stay and offers to become your beach's resident pet (with an optional
   name).
2. **Adopt in the shop (instant path):** Buy a pet directly in the shop (like a
   centrepiece, e.g. **$1.99–$2.99**) to adopt one immediately on any beach
   without waiting to befriend a wild visitor.

### Pet lifecycle & cozy rules

- **One pet per beach** to start (keeps the shore uncrowded even across a long
  stretch of neighbors).
- **Always on your beach:** Unlike wild visitors, your pet is always there when
  you open that beach (and visible to neighbors/visitors on the shore).
- **Mood / hunger states** computed purely from `now - last_fed_at` (no cron
  jobs needed on the server):

| Time since last fed | State | Behaviour on the beach |
|---|---|---|
| 0 – 12 h | **Happy** | Active, scurries around, playful idle animation, welcomes you |
| 12 – 24 h | **Peckish** | Slower wander, occasionally pauses and looks toward the camera / chair |
| 24 – 48 h | **Hungry** | Sits near its home spot with a subtle visual cue (no nagging popups) |
| 48 h+ | **Sleepy / burrowed** | Tucked half into a cozy sand burrow (or curled up) snoozing until fed |

- **Never dies, never leaves.** Feeding it immediately wakes it up to **Happy**
  and resets `last_fed_at`.

### Data model (server)

Keep pet state in its own tables — **not** inside the `BCH3` sand blob — so a
visitor feeding your pet never races with your device saving sand:

```sql
-- Future migration N
CREATE TABLE beach_pets (
  beach_id UUID PRIMARY KEY REFERENCES beach (id) ON DELETE CASCADE,
  species TEXT NOT NULL,                  -- 'crab', ...
  name TEXT NOT NULL DEFAULT '',          -- optional short pet name
  variant SMALLINT NOT NULL DEFAULT 0,    -- colour/look variant
  source TEXT NOT NULL,                   -- 'befriended' | 'shop'
  last_fed_at BIGINT NOT NULL,
  last_fed_by UUID REFERENCES users (id) ON DELETE SET NULL,
  fed_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE wild_feed_progress (
  beach_id UUID NOT NULL REFERENCES beach (id) ON DELETE CASCADE,
  species TEXT NOT NULL,
  feed_count INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (beach_id, species)
);

CREATE TABLE pet_feed_log (
  id BIGSERIAL PRIMARY KEY,
  beach_id UUID NOT NULL REFERENCES beach (id) ON DELETE CASCADE,
  feeder_id UUID REFERENCES users (id) ON DELETE SET NULL,
  feeder_name TEXT NOT NULL DEFAULT '',
  fed_at BIGINT NOT NULL
);
CREATE INDEX pet_feed_log_beach_time ON pet_feed_log (beach_id, fed_at DESC);
```

### Visitor feeding

- **How it works:** When visiting someone else's beach (by walking the shore,
  neighbors, favorites, leaderboard, or `?visit=CODE`), their pet is rendered on
  their beach in its current mood state (returned in the existing shore/beach
  metadata payload).
- **Tapping or feeding:** A signed-in visitor can tap the pet (or drop food from
  their own bag) to feed it → `POST /api/beaches/:code/pet/feed`.
- **Anti-spam / fairness:**
  - Each signed-in visitor gets **1 free feed per beach per UTC day** (no food
    item needed), and can also feed anytime by spending a food item from their
    own bag.
  - Updates `beach_pets.last_fed_at`, increments `fed_count`, and inserts a row
    in `pet_feed_log` (capped/pruned to recent entries).
- **Owner delight:** Next time the owner opens their beach (or during the 30 s
  neighbor refresh), a quiet toast / status shows e.g. *"Gus fed Barnaby"*.
- **Signed-out visitors** (public `?visit=CODE` read-only 3D) can see the pet
  but are prompted to sign in to feed it.

### Notifications

- **Phase 3a — Local notifications (mobile apps, simplest & zero server push
  infra):**
  - Use `@capacitor/local-notifications` on iOS and Android.
  - Opt-in toggle in Settings (off until the player adopts a pet and agrees).
  - Whenever you feed your pet (or open the app), reschedule a single local
    notification for `last_fed_at + 24h` (e.g. *"Your crab is getting hungry on
    Bondi"*). Respect quiet hours (no pings between 22:00 and 08:00 local time).
  - Limitation: if a visitor feeds your pet while your app is closed, the local
    schedule won't know until you open the app — acceptable for 3a.
- **Phase 3b — Remote push (optional follow-up):**
  - APNs / FCM / Web Push via a small `push_tokens` table, enabling real-time
    *"Gus fed your crab!"* notifications and cancelling hunger alerts when a
    visitor already fed it. (Also shares infra with the existing backlog item
    "Push for neighbor requests".)

---

## Phased milestones

Each milestone keeps the app playable, tested, and within `perf/budget.json`.

- **A1 — Wild visitor MVP (Phase 1):** Sand crab spawning rarely on the live
  beach, wandering, dodging waves and your digging brush, and burrowing away on
  its own. Debug spawn button, unit tests, guide section, release notes. No
  server or save-format changes.
- **A2 — Animal food & feeding (Phase 2):** Food item in catalog/bag (free
  trickle + shop packs), drop on sand to bait or extend a visit, happy eat
  animation, server consumable inventory.
- **A3 — Resident pets (Phase 3a):** Adopt one pet per beach either by
  befriending wild visitors through feeding (`wild_feed_progress`) or buying
  directly in the shop; `beach_pets` table, cozy mood states from
  `last_fed_at` (sleepy/burrowed after 48 h, never leaves), visible on
  neighbors' beaches, local hunger notifications on iOS/Android.
- **A4 — Visitor feeding & activity (Phase 3b):** Visitors can feed a beach's
  pet (`POST /api/beaches/:code/pet/feed` — 1 free/day per beach, or spend own
  food anytime), owner "X fed your pet" cue, optional remote push later.
- **A5 — Second species (later):** Add a water animal (e.g. dolphin offshore) or
  sky/shore animal (seagull) using the same species interface.

---

## Decisions (2026-11-24)

- **First species:** Sand crab.
- **Food acquisition (Phase 2):** Both — occasional free treats (claw / vending
  / digging) plus consumable packs in the shop.
- **Pet adoption (Phase 3):** Both — buy a pet directly in the shop, or feed
  wild visitors enough times on a beach that one decides to stay as your pet.
- **Visitor feeding (Phase 3):** 1 free feed per day per beach, plus visitors
  can spend their own food anytime.
- **Pet hunger tone (Phase 3):** Cozy — gets sleepy / burrowed until fed, never
  dies or leaves.
