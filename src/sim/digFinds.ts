// Digging finds: the client-side half. The roll itself is server-side
// (server/src/digFinds.ts) — the app only measures the stroke and asks.
// These thresholds are the same numbers the server enforces; a root test
// (tests/digFinds.test.ts) keeps the two copies in step.

/** a stroke counts as a real dig when the brush travels this far (m) ... */
export const DIG_FIND_MIN_PATH_M = 2;
/** ... or digs in one place this long (ms) */
export const DIG_FIND_MIN_TIME_MS = 1000;
/** shortest gap between two rolls (ms) — the server enforces this, the app mirrors it so it doesn't spam the endpoint */
export const DIG_FIND_ROLL_COOLDOWN_MS = 30_000;

/** Did this stroke dig enough to earn a roll? A tap, or a wiggle, doesn't. */
export function qualifiesForFind(pathM: number, durationMs: number): boolean {
  return pathM >= DIG_FIND_MIN_PATH_M || durationMs >= DIG_FIND_MIN_TIME_MS;
}
