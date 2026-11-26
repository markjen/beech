# Inland beach sections

Status is **designed** for the account-enabled game.

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
