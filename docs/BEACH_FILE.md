# Beach files: export, import and design offline

Status: **planned** (2026-11-23). This page is the plan and the file
specification. The spec is the contract: once version 1 ships, readers keep
accepting every version 1 file.

## Why

People want to design a beach away from the game: sketch it in a text editor,
generate it with a script, or start from a heightmap. They also want to keep a
copy of a beach they like and bring it back later or move it to another
beach. A beach file covers all of these:

- **Export** writes the beach you're looking at to a `.beach.json` file.
- **Import** reads one onto the beach you're on, after a preview.
- The format is plain, documented JSON, so it can be written by hand or by a
  program. Sand can be given as a grid of heights, as simple shapes
  (mounds, walls, trenches, moats, plateaus), or both.

Checkpoints ([CHECKPOINTS.md](CHECKPOINTS.md), designed separately) store the
same beach data on the server. An imported file can be saved as a checkpoint,
and a checkpoint can be exported as a file.

## The file (version 1)

A UTF-8 JSON object, at most **4 MB**. The extension is `.beach.json`. The
MIME type is `application/json`.

```json
{
  "format": "beech.beach",
  "version": 1,
  "name": "Castle cove",
  "sand": { "nx": 4, "ny": 3, "unit": "mm", "encoding": "rows",
            "data": [[0, 0, 0, 0], [0, 120, 120, 0], [0, 0, 0, 0]] },
  "shapes": [
    { "type": "mound", "x": 16, "y": 22, "radius": 2.5, "height": 0.6 },
    { "type": "ring", "x": 16, "y": 22, "radius": 3.2, "width": 0.6, "height": -0.3 }
  ],
  "objects": [
    { "item": "rock", "x": 12.5, "y": 19, "size": 0.6, "angle": 30, "variant": 2 },
    { "item": "flag", "x": 16, "y": 22.4 }
  ]
}
```

### Top level

| Field | Type | Required | Meaning |
|---|---|---|---|
| `format` | string | yes | Always `"beech.beach"`. |
| `version` | integer | yes | `1`. A reader refuses a file with a higher version and says the app needs updating. |
| `name` | string | no | Up to 40 characters. Shown in the import preview; becomes the beach name only if you choose to rename. |
| `location` | string | no | A location id from `src/world/locations.ts` (the real beach whose tides and light it uses). Unknown ids are ignored. |
| `createdWith` | string | no | Free text, e.g. `"beech 1.4.0"` or `"my-generator 0.2"`. Informational. |
| `sand` | object | no | A grid of sand heights. See below. |
| `shapes` | array | no | Shapes applied on top of the grid, in order. See below. |
| `objects` | array | no | Things on the beach. See below. |

Unknown fields are ignored at every level, so later versions can add fields
without breaking older readers. Writers should not invent fields; put notes
in `name` or `createdWith`.

### Coordinates

Everything is in **metres**, seen from above:

- The beach is **32 m × 32 m**.
- `x` runs alongshore, from 0 (left) to 32 (right), looking from the sea
  toward land.
- `y` runs from **0 at the offshore edge** (the sea) to **32 at the land
  edge**.
- Heights are **relative to the untouched beach**. 0 means "as it comes",
  +0.5 is half a metre of sand piled up, −0.3 is a 30 cm hole.
- The untouched beach slopes up from the sea. The still waterline is about
  `y = 16.5`. The sea floor is deep near `y = 0`, and the dunes are near
  `y = 32`. (The exact rest profile, with a table of heights by `y`, will be
  added here in milestone E1 from `src/sim/profile.ts`.)
- Below a fixed floor the sand can't go lower (it's bedrock). Heights below
  it are clamped when the file loads.

Angles in the file are **degrees**, counter-clockwise seen from above, with
0 pointing along +x.

### `sand`: a grid of heights

| Field | Type | Meaning |
|---|---|---|
| `nx`, `ny` | integers, 8 to 512 | Grid size. Columns run along `x`, rows along `y`. The grid covers the whole 32 m × 32 m, whatever its size, and is resampled to the device's grid. |
| `unit` | `"mm"` | Heights are integer millimetres, −32767 to 32767. |
| `encoding` | string | One of the three below. |
| `data` | array or string | The heights. |

Encodings:

| `encoding` | `data` | Use |
|---|---|---|
| `"rows"` | an array of `ny` rows, each `nx` integers. Row 0 is the offshore edge (`y = 0`); each row runs from `x = 0` to `x = 32`. | Hand editing, scripts, spreadsheets. |
| `"int16le"` | base64 of `nx × ny` little-endian int16, in the same row order. | Compact, no compression. |
| `"deflate-int16le"` | base64 of the same bytes, zlib-deflated (RFC 1950). | What the app exports by default. It is the sand part of the app's own save format. |

Each grid value is the height at the **centre** of its cell. Without a `sand`
grid, the beach starts untouched and only `shapes` change it.

### `shapes`: sand drawn with primitives

Shapes are applied in order, after the grid. Every shape changes the height
by `height` metres (positive builds up, negative digs) with a smooth edge.
`mode` says how the shape combines with what is already there.

| `mode` | Effect |
|---|---|
| `"add"` (default) | Add the shape's height. |
| `"set"` | Replace the height inside the shape (blending over `edge`). |
| `"max"` | Raise to at least the shape's height (good for walls over uneven sand). |
| `"min"` | Lower to at most the shape's height (good for flat-bottomed pools). |

| `type` | Fields | Shape |
|---|---|---|
| `"mound"` | `x`, `y`, `radius`, `height` | A round, smooth (cosine) bump, or a pit if `height` is negative. |
| `"line"` | `from: [x, y]`, `to: [x, y]`, `width`, `height` | A straight ridge or wall, or a trench if `height` is negative. Rounded ends. |
| `"rect"` | `x`, `y` (centre), `width` (along x before rotating), `length`, `angle`, `height`, `edge` | A plateau or a flat pool. |
| `"ring"` | `x`, `y`, `radius`, `width`, `height` | A circular wall, or a moat if `height` is negative. |

Common optional fields: `mode` (above) and `edge`, the width in metres of the
soft edge. The default is a quarter of the shape's width or radius; `0` gives
the sharpest edge the grid allows. Limits: at most 500 shapes; sizes from
0.05 m to 32 m; `|height|` up to 3 m.

### `objects`: things on the beach

| Field | Type | Required | Meaning |
|---|---|---|---|
| `item` | string | yes | A catalog id from `src/world/items.ts`: `rock`, `driftwood`, `shell`, `seaglass`, `flag`, `deckchair`, `lighthouse`, … The list is in the appendix. |
| `x`, `y` | number | yes | Where it sits (metres). Kept 0.3 m inside the edges. |
| `angle` | number | no | Degrees. Default 0. |
| `size` | number | no | Metres: a rock's radius, a driftwood log's length, a shell's width. Clamped to the item's size range. Ignored for fixed-size items (flag, deckchair and the shop items). The default is the middle of the range. |
| `variant` | integer | no | Picks one of the item's shapes and colours (0, 1, 2, …), wrapping around. Default 0. |

At most **400** objects. The order doesn't matter. Things the sea brought in
by itself are not exported. Floating and tumbling things (driftwood, shells,
bottles) start where the file puts them, and the sea may then move them.

### What a reader does

1. Parse JSON and check `format` and `version`. Structural errors (not JSON,
   wrong format, a higher version, a `data` of the wrong length, too big)
   **refuse the file**, listing each error with its JSON path, e.g.
   `objects[3].x: must be a number`.
2. Anything else that is out of range is **fixed and reported as a warning**:
   values are clamped, an unknown `item` or shape `type` is skipped, extra
   objects past 400 are dropped.
3. Build the heights: start from the grid (or zeros), apply the shapes, clamp
   to the bedrock floor, then resample to the device's grid.
4. Objects: give each a fresh id. Its `kind` comes from the catalog item.
5. **Inventory** (see below), then show the preview.

### What a writer (the app's export) does

- `format`, `version: 1`, `name` (the beach's name), `location`,
  `createdWith: "beech <app version>"`.
- `sand` at the device's grid size, `"deflate-int16le"`. A "for editing"
  option writes `"rows"` instead (about 6× bigger).
- No `shapes`: the export holds the resulting heights.
- `objects` where they are **now**, with `wild` ones left out. Numbers are
  rounded to millimetres and tenths of a degree.
- Exporting then importing gives back the same beach, within a millimetre
  and the grid's resampling.

## Import in the app

- **Where:** a "Beach file" row with **Export** and **Import** buttons. In
  the account panel it goes under each beach (in production). In Settings it
  works on the beach you're on, including the sandbox build, which has no
  accounts.
- **Preview:** the file's name, a small top-down map of the heights and
  objects, the counts of objects by item, and every warning. **Replace this
  beach** is the main button.
- **Inventory:** you can only put down what you own. Free items (rock,
  driftwood, shell, sea glass, flag) are unlimited. For every other item, the
  file may use at most *owned − placed on your other beaches*. The preview
  lists what's missing ("2 deckchairs: you have 1 free") and offers
  **Import without them** or **Get them in the shop**. The sandbox build has no
  inventory, so non-free items are always left out there, and the preview
  says so. This is the same rule a checkpoint restore uses; the two share one
  function, `reconcileItems(counts, owned, placedElsewhere)`.
- **Safety:** an import replaces the whole beach, so it is **one undo
  step** (today, loading a beach clears the undo stack). Once checkpoints
  exist, an import also makes an automatic "Before import" checkpoint.
- **Saving:** an import marks the beach dirty, and it saves like any other
  edit. Neighbors see it on their next refresh, as with any change.
- **Server trust:** today the server stores what the app saves and records
  item counts without checking them against ownership. Import uses the
  client-side check. The server-side ownership check is planned with
  checkpoints, and applies to every save, imported or not.

## Code layout

| Where | What |
|---|---|
| `src/world/beachFile.ts` | Pure TypeScript, no DOM: `parseBeachFile(text) → { beach, warnings } \| { errors }`, `writeBeachFile(beach, opts) → string`, `drawShapes(delta, nx, ny, shapes)`, `reconcileItems(...)`. Uses `CompressionStream` like `sandCodec.ts`, so it runs in the browser, Node and Vitest. |
| `src/ui/beachFileDialog.ts` | The preview dialog and the export/import buttons. |
| `src/sim/*` | A `setSand` with `undoable: true` that pushes one whole-beach undo entry. |
| `docs/beach-file.schema.json` | JSON Schema (draft 2020-12) of version 1, for editors and validators. |
| `docs/examples/*.beach.json` | Example files, checked by a test to parse with no warnings. |
| `scripts/beach-file.mjs` | Offline tool (milestone E4): `validate`, `rows` / `compact` (switch encodings), and `heightmap in.png` (a grayscale PNG to a beach file, with `--min` and `--max` in metres). |

## Milestones

Each one leaves the app playable and passes `npm test` and `npm run build`.

| | Milestone | Done when |
|---|---|---|
| **E0** | This plan and spec | Committed. |
| **E1** | Format, codec and spec complete | `beachFile.ts` parses and writes all three encodings and the four shapes with all modes, gives errors and warnings as specified, and round-trips with the app's save format. JSON Schema and examples are added. The rest-profile table is in this page. Unit tests cover the round trip, each shape and mode, clamping, bad files, the size limit, resampling and `reconcileItems`. No UI changes yet. |
| **E2** | Export and import in the app (web) | Settings and account-panel buttons. Export downloads a file. Import uses a file picker, then the preview with inventory and warnings, then replaces the beach as one undo step, and it saves. Screenshots at desktop and phone sizes, and an e2e step in `scripts/account-e2e.mjs`. |
| **E3** | Phone apps | Export through the share sheet (`@capacitor/filesystem` and `@capacitor/share`). Import through the system file picker in both WebViews. `npx cap sync`, and the Android debug build passes. |
| **E4** | Offline tools and guide | `scripts/beach-file.mjs` (validate, rows/compact, heightmap PNG with its own small PNG decoder, no new dependencies). A short "Design a beach offline" guide at the end of this page, with a worked example and a 20-line generator script. |
| **E5** | With checkpoints | "Save as checkpoint" in the import preview, "Export" on a checkpoint, and the automatic "Before import" checkpoint. Built once checkpoints land; see CHECKPOINTS.md. |

## Open questions (decided for now)

- **Share beach files with other people?** Yes. A file holds no account data,
  only sand and items, and importing still needs your own inventory.
- **Heightmap images inside the file?** No. The file stays plain JSON, and
  the offline tool converts images.
- **Larger worlds?** No. The beach is always 32 m × 32 m. A future world size
  would be a version 2 with its own field.

## Appendix: item ids (version 1)

Free: `rock`, `driftwood`, `shell`, `seaglass`, `flag`.
Owned (prizes and the shop): `conch`, `sanddollar`, `starfish`, `deckchair`,
`parasol`, `surfboard`, `tikitorch`, `sandcastle`, `beachhut`, `lighthouse`,
`bottle`, `pink-shell`, `blue-seaglass`, `pebble`, `spiral-conch`,
`gold-sanddollar`, `sunset-starfish`, `green-bottle`, `nautilus`.
The catalog (`src/world/items.ts`) is the source of truth; new items are
added there and here.
