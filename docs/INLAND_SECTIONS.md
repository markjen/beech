# Inland beach sections

Status: **built** for the account-enabled game (2026-11-26) as scenery,
with the differences below. Sand extensions straight behind a beach are
playable sand since 2026-11-27 ("Playable sand: what was built", below).

## What was built, and how it differs from this design

- **Bought with beech bucks** (50 each for every type since 2026-11-27, was 15), not $1.49
  purchases, like piers: one `item_section_*` product per type, granting a
  `section-*` bag item. **For now only the sand extension is on sale**
  (`SECTIONS_ON_SALE` in `server/src/sections.ts` and `src/world/sections.ts`),
  listed in the shop's **Beaches** tab. The other types keep their catalog
  entries and rendering; the editor offers one only if it's already in your
  bag (bought before, or granted), with no buy button. All types trade in
  from the same 50.
- **Counted, not individual copies.** A placed row is counted against
  what's owned of its type across every beach (the pier model), instead of
  a stable section ID per purchase. Stored props and per-copy sand would
  need IDs; they come with editable sand. Refunds don't apply: beech bucks
  are spent, so there is no per-section purchase to refund.
- **One write for every change.** `PUT /beaches/mine/:id/sections
  {rows, rev}` replaces the whole list (append, replace, reorder, return to
  the bag), made from the revision the editor opened at. The same type can
  fill more than one row if you own enough.
- **Editor:** Manage → Beaches → **inland sections** on the selected beach
  (`src/ui/sectionsEditor.ts`): each row with ↑ ↓, **replace** and
  **to bag** (replace, 2026-11-27: the add buttons become **→ type** and
  swap that row in place; the displaced copy goes back to the bag; buying
  while replacing fills that row), then
  **+ type** for what's free or **buy type · (coin) 50** to buy one; the rows show
  behind the beach as you change them; **save** / **cancel**. A stale
  revision is refused (the player reopens the editor).
- **Rendering:** `src/render/sections.ts` (`SectionLayer`, loaded on first
  use), drawn by `NeighborView` for every beach in view, yours or anyone's.
  The shapes themselves are in `src/render/sectionShapes.ts` (no Babylon),
  which `npm run bundle:server` also bundles into
  `server/src/generated/sections.ts`.
- **On beechshore.com (2026-11-27):** a beach's thumbnail and its page's
  flat view are taller by its rows, drawn under the sand at the same scale
  from those same shapes seen from above (`drawRowsTop` in
  `server/src/beachImage.ts`; the flat view is `/img/CODE/plan.png`). The
  link-preview card (`/img/CODE.png`) stays the beach alone at 1200×630.
  The rows are part of the pictures' version (`imageVersion`), since
  changing them changes the picture without a save. The site's `rows-1` …
  `rows-4` classes give the cards and the flat view their taller shape. The
  3D views don't show rows yet.
  Joins are derived in `NeighborView.syncSections` from the shore entries
  (`sectionJoins` in `src/world/sections.ts`), so a culled neighbor still
  joins. The camera can pan inland over the deepest occupied row
  (`CameraController.maxZ`). Ground level is the beach's back height, so
  no apron is needed.
- **Not yet:** beechshore.com pictures don't draw the rows; the access
  points are drawn per type (a crossing, a ramp, a gap in a fence) rather
  than one shared connector.

## Playable sand: what was built (2026-11-27)

The design's own grid per Sand Extension copy (128 × 48, saved by section
ID) was not built. Instead **sand rows straight behind the beach make the
beach's own grid deeper**, so they are the same simulation, renderer,
picking, brushes, molds, undo and bag placement as the rest of the sand,
and line up with it exactly (one surface, the same cells).

- **Which rows.** The leading run of `section-sand` rows (`sandRowsOf` in
  `src/world/sections.ts`). A grid with `k` of them is
  `ny = nx + k · round(12 m / dx)` (`gridWithSand`; 72, 96 or 120 cells a
  row on the low, medium and high tiers); its width, cell size and front
  edge are unchanged. A sand extension behind another type stays scenery.
  `SectionLayer` skips the rows the beach draws itself (`SectionSpot.from`,
  from the depth drawn now, so a preview still shows them as scenery).
- **The ground.** The rest profile carries on past 32 m (the back of the
  beach rises to about 0.93 m within the first metres and stays there),
  so the sand runs straight on. The sea never reaches it. The sim's cost is
  flat in the dry rows (4.4 ms a tick at 32 m, 4.3 ms at 80 m, medium).
- **The save.** The saved beach (BCH1–3) is just deeper: `ny > nx`. Loads
  keep the depth in metres on any tier (`resampleWidth`) and fit it to the
  beach's rows now (`fitDepth`): rows added get untouched sand, rows taken
  away lose their sand, and the things on them drop out of the save, so
  they are back in the bag on the next save (a load that had to refit
  saves at once). Sand travels with the row's position, not with a copy.
  The undo history doesn't survive a change of depth.
- **Changing depth.** After the shore refreshes (the editor's save, or
  another device's), `fitSandRows` in `main.ts` refits every beach held:
  the store's (`BeachStore.setSandRows`), and the live one by asking the
  worker for its sand and sending it back with the new grid
  (`setSand {grid}`); the worker makes its sim again at that size (same
  time and sea) and posts `regrid`, and the live renderer and picker
  `resize`. Snapshot renderers resize on repaint.
- **Seams.** The shaders take each neighbor's row count (`negRows`,
  `posRows`): the sand, water and wave seams blend only over rows both
  beaches have, and a side skirt shows where this beach runs deeper.
- **Server.** Saves accept `ny >= nx` (a shallower grid is still the old
  app's 426); grids up to 400 × 800 cells; things up to 96 m inland. Apps
  from before send no `X-Beach-Deep`, and their save of a beach stored
  deeper is refused (426: they would squeeze it into the square). Pictures
  on beechshore.com crop to the beach itself. Beach files are the beach
  itself (export crops, import keeps the rows behind untouched);
  checkpoints keep the whole grid.
- **State machine.** No new server state: the layout is still the one
  `PUT /sections` write, and what's on a beach is still counted from its
  saved sand, so `InlandSections.tla` is unchanged (see STATE_MACHINES.md).

## Player experience

Players can extend each beach with up to four **32 m wide × 12 m deep**
sections, adding up to **48 m** inland. Row 1 starts at the back of the
original beach. Each subsequent row starts at the back of the previous row.

Each purchase grants one reusable copy of a specific section type to the
player's account. The proposed US launch price is **$1.49 per section**.
From **Inland sections** on an owned beach, the player can preview an
available copy, append it to the next row, replace an occupied row with a
stored copy, reorder placed sections, or return a section to inventory.
Replacing a row stores the displaced copy. Returning a row shifts each
later row one step toward the waterfront. Stored copies can be reused on
any beach the player owns. The preview shows which neighbor joins the
proposed layout opens or closes, including changes caused by shifted rows.

## Layout and catalog

Resolve each left and right edge independently. An edge joins when the beach
on that side is directly linked and has the same section type at the same
row. An empty row, a different type, or an unlinked boundary uses the
finished edge. For example, two neighbors can share a boardwalk in row 1
and a bike path in row 3 while their row 2 sections end separately. Every
type has centered access points on its front and back edges so different
types can connect inland.

| Launch section | Joined edge | Finished edge |
| --- | --- | --- |
| Sand Extension | Continuous dry sand at a shared grade | Low dune lip and beach grass |
| Boardwalk | Aligned planks, trim, and rails | Viewing deck with a bench and inward ramp |
| Bike, Run & Skate Path | Continuous pavement and lane markings | Rounded turnaround with a planted verge |
| Playground | Shared play surface and an open gate | Closed fence, planting, and a bench |
| Coastal Road | Aligned lanes, curbs, and sidewalks | Compact turnaround with a planted verge |
| Storefronts | Continuous sidewalk and aligned awnings | Corner shop and a pocket of seating |
| Dune Garden | Continuous native planting and trail | Grasses and curved split-rail fencing |
| Picnic Grove | Shared gravel walk between shaded tables | Path widens into a shaded seating pocket |

The same grid can support a future market plaza with a paved aisle and a
planter island at its end, a sports park with a perimeter path and an end
of hedges and bleachers, or a coastal overlook with a joined viewing rail
and a small lookout deck at its end.

## Playable sand

A Sand Extension adds dry, editable space at any row. Players can dig,
sculpt, stamp castle molds, undo or redo terrain edits, and place or
rearrange compatible bag items. Sand and props travel with an individual
copy through swaps, reorders, and storage. Stored props still count against
the account's bag limits and can be returned to the bag from the section
editor. To move a prop between surfaces, return it to the bag and place
it on the destination.

Built sections are scenery for exploration at launch. The original
waterfront hosts surf, tides, dig rewards, and wildlife.

## State machine

Start implementation with the proposed `specs/tla/InlandSections.tla`,
following the [model-first workflow](STATE_MACHINES.md#model-first-workflow).
Model verified purchase grants and retries, append, swap, reorder, return,
sand saves and prop returns, edit-session handoff, and refunds. Check the
interleavings with TLC, then map actions to routes in
[STATE_MACHINES.md](STATE_MACHINES.md).

- **Ownership.** Each verified purchase grants one stable section ID tied
  to its purchase inventory. A retry for the same purchase yields the
  same copy. Every active copy is stored or appears in exactly one layout
  on a beach owned by the account.
- **Layout.** Each beach holds an ordered list of up to four distinct
  section IDs. Array position determines the row. Require the owner's
  current edit token and expected layout revision. Validate and commit
  layout mutations atomically. Reject stale revisions so a client can
  refresh its preview before trying again.
- **Sand and bag.** Save terrain and props by section ID and protect sand
  writes with the edit token and a sand revision. Validate bag usage
  across waterfront saves and both placed and stored sections under the
  same account lock. Derive counts from the saved props.
- **Refund.** Revoke only the copy granted by the refunded purchase.
  Atomically remove any placement, compact the layout and advance its
  revision, and return the copy's props to the bag. Serialize this with
  placement and sand saves so a stale write or duplicate refund cannot
  restore the copy or return its props twice.

## Shore rendering and persistence

- Extend existing 3D shore responses with placed section types in row
  order and sand revisions using current shore visibility rules. The
  owner editor reads the account's inventory and layout revision. Visitors
  can view placed sections when they can view the beach. Keep stored
  sections and edit operations private to the owner.
- Derive joins from the linked shore entries independently of mesh
  loading and culling. Recompute both sides when a relevant layout or
  neighbor link changes. Expand camera bounds and culling over occupied
  rows, and use a short graded apron from the back of the beach to row 1.
- Reuse the current terrain editing and compression primitives on a fixed
  **128 × 48** grid for each Sand Extension. Keep joined sand edges at a
  common grade without changing either player's saved sculpture when the
  join changes. Beach files and checkpoints continue to cover the original
  beach surface.

## Implementation and release

1. Model and check the state machine, then implement inventory, layout,
   terrain persistence, bag validation, and refund handling.
2. Ship the editor and shore renderer. Verify the full layout in owner
   and visitor views before enabling sales.
3. Enable section sales once the editor and renderer are live.

| Area | Release checks |
| --- | --- |
| Layout and joins | Reject a fifth row. Verify both sides of every catalog type, mixed types and empty rows, linked and unlinked beaches, joins across a culled neighbor, and the preview after a reorder or return. |
| Purchases and concurrency | Retry a purchase and a refund. Refund both placed and stored copies. Verify gap closure and that each prop returns once. Exercise cross-device stale layout and sand writes and a refund racing a save. |
| Editable sand | Dig, sculpt, use molds, undo and redo, and move props. Reload after a swap, reorder or return to inventory, then reuse the same copy on another beach. Check bag limits while the copy is stored. |
| Access and navigation | Verify authorized visitor reads, visitor write rejection, and private inventory. Pan to the full 48 m extension on desktop and mobile. |
