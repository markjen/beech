import { describe, expect, it } from 'vitest';
import { ANNOUNCE } from '../src/ui/inboxText';
import { PUSH_KINDS } from '../server/src/notifyKinds';

/** Away events: they happened while the owner was away, so they are pushed
 * but never announced over the beach — they wait in the inbox instead. */
const AWAY_KINDS = new Set(['tide', 'pet_fed']);

describe('notifications', () => {
  it('every pushed kind is also announced in the app, except away events', () => {
    for (const k of Object.keys(PUSH_KINDS)) expect(ANNOUNCE.has(k), k).toBe(!AWAY_KINDS.has(k));
  });

  it('away events are exactly the pushed kinds that are not announced', () => {
    expect([...Object.keys(PUSH_KINDS)].filter((k) => !ANNOUNCE.has(k)).sort()).toEqual([...AWAY_KINDS].sort());
  });
});
