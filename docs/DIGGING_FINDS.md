# Digging finds

While digging, you can turn up something buried — an item from this week's
vending set, at the vending odds. It goes straight into your bag.

## How it works

- **The trigger.** A dig stroke ends (finger lifts) and the app measures it:
  how far the brush travelled, in metres, and how long the stroke lasted.
  A stroke earns a roll when the brush travelled at least 2 m, or dug in one
  place for at least 1 s — a tap, or a wiggle, doesn't. Only the dig tool
  counts (not pile, smooth, or flatten), and only on your own beach.
- **The roll.** The app asks the server (`POST /api/dig-finds`, with the
  stroke's metres and milliseconds). The server rolls: 1 in 10 good digs
  turns something up, and the item is drawn from the current vending set
  (`server/src/vending.ts`, `drawVending`) at the vending odds — common 60%,
  uncommon 25%, rare 12%, unique 3%. The app never rolls: like the claw and
  the vending machine, the draw is server-side (`server/src/digFinds.ts`).
- **The reveal.** On a hit the server has already put the item in your bag,
  and the app shows "You dug something up!" with the item and its rarity.
  "Put it on the beach" picks it up in hand; "Keep it" leaves it in the
  bag. On a miss nothing happens — you just keep digging.

## Anti-farming

Digging is a treat, not a faucet — three server-side limits, all in
`server/src/digFinds.ts`:

| Limit | Value | Why |
|---|---|---|
| Stroke must earn the roll | 2 m travelled, or 1 s in place | taps and wiggles don't roll |
| Between rolls | 30 s | a fast client can't spin the roll |
| Finds per day (UTC) | 3 | a day of digging tops out at 3 items |

After the third find the server answers 409 until the next UTC day. The
limits are enforced in one atomic statement (claim + log + grant), so two
rolls at once still grant only one find — see `server/test/digFinds.test.ts`.

The numbers are deliberately close to the other free draws: the vending
machine gives 1 ball a day, the claw rests minutes between goes, and digging
tops out at 3 finds a day — with the same pool, so a unique stays rare
(about 1 in 33 finds).

## Where it lives

- `server/src/digFinds.ts` — the chance, the cap, the cooldown, the roll.
- `server/src/app.ts` — `POST /api/dig-finds`. Finds are logged in `pulls`
  (pool `'dig'`) and granted in `inventory` (source `'pull'`, like any other
  random draw).
- `server/src/migrations.ts` — migration 11, `dig_state` (finds today and
  last roll per person).
- `src/sim/digFinds.ts` — the client-side copy of the stroke thresholds
  (a root test keeps the two copies in step).
- `src/net/account.ts` — `DigFindApi`.
- `src/ui/digFind.ts` — the reveal dialog.
- `src/main.ts` — measures the stroke (brush travel + duration) and asks
  at the end of a dig stroke.

## Tuning

Change the numbers in `server/src/digFinds.ts` (`DIG_FIND_CHANCE`,
`DIG_FIND_DAILY_CAP`, `DIG_FIND_ROLL_COOLDOWN_MS`) and the thresholds
(`DIG_FIND_MIN_PATH_M`, `DIG_FIND_MIN_TIME_MS`) in both the server and the
client module — the test fails if they drift apart. A find rate that feels
too generous or too stingy on a real phone is a one-line change per number;
the daily cap is what keeps it from becoming a faucet either way.
