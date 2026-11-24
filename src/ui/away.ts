import type { AwaySummary } from '../net/account';

/** "2 days", "5 hours", "40 minutes": how long the sea had the beach to itself. */
export function awayFor(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 90) return `${Math.max(1, min)} minute${min === 1 ? '' : 's'}`;
  const h = Math.round(ms / 3600000);
  if (h < 36) return `${h} hours`;
  const d = Math.round(ms / 86400000);
  return `${d} days`;
}

/**
 * The "while you were away" card (docs/LIVE_SIM.md, section 6): a summary,
 * counting rather than naming what the sea took.
 */
export function awayText(a: AwaySummary): string {
  const parts = [`While you were away (${awayFor(a.to - a.from)})`];
  if (a.highTides > 0) parts.push(`${a.highTides} high tide${a.highTides === 1 ? '' : 's'}`);
  if (a.lost > 0) parts.push(`the sea took ${a.lost} thing${a.lost === 1 ? '' : 's'} (back in your bag)`);
  else if (a.broughtIn > 0) parts.push(`the sea washed up ${a.broughtIn} thing${a.broughtIn === 1 ? '' : 's'}`);
  else parts.push('the sea smoothed your sand');
  return parts.join(' · ');
}
