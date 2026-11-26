import { describe, expect, it } from 'vitest';
import type { InboxEntry } from '../src/net/account';
import { NOTE_MAX } from '../server/src/inbox';
import { NOTE_MAX_CHARS } from '../src/config';
import { ANNOUNCE, aPrize, ago, announce, describeEntry } from '../src/ui/inboxText';

const entry = (e: Partial<InboxEntry>): InboxEntry => ({
  id: 1,
  kind: 'visit',
  from: { name: 'Ben', code: 'BEN123' },
  beach: { code: 'ANA123', name: null },
  item: null,
  shells: null,
  note: null,
  count: 1,
  payload: {},
  at: 0,
  read: false,
  ...e,
});

describe('inbox wording', () => {
  it('says what a visitor left', () => {
    expect(describeEntry(entry({ shells: 4, item: 'starfish', note: { id: 1, text: 'Lovely!' } }))).toEqual({
      title: 'Ben visited your beach',
      detail: ['“Lovely!”', 'gave you a starfish', '4 shells'],
    });
    expect(describeEntry(entry({ beach: { code: 'X', name: 'Moat Bay' }, shells: 1 })).title).toBe('Ben visited Moat Bay');
    expect(describeEntry(entry({ note: { id: 1, removed: true } })).detail).toEqual(['(this note was removed)']);
  });

  it('names a deleted sender gently, and folds batched rows', () => {
    expect(describeEntry(entry({ kind: 'gift', from: null, item: 'conch' })).title).toBe('A former visitor gave you a conch');
    expect(describeEntry(entry({ kind: 'star', count: 3 })).title).toBe('3 people starred your beach');
    expect(describeEntry(entry({ kind: 'star' })).title).toBe('Ben starred your beach');
    expect(describeEntry(entry({ kind: 'rating', count: 4, rating: { count: 12, average: 4.5 } }))).toEqual({
      title: 'your beach got 4 new ratings',
      detail: ['4.5 average from 12'],
    });
  });

  it('covers neighbors and invites', () => {
    expect(describeEntry(entry({ kind: 'neighbor_request' })).title).toBe('Ben wants to be your neighbor');
    expect(describeEntry(entry({ kind: 'neighbor_linked' })).title).toBe('You and Ben are neighbors');
    expect(describeEntry(entry({ kind: 'invite_joined' })).title).toBe('Ben joined through your invite');
    expect(describeEntry(entry({ kind: 'invite_settled', item: 'beach' })).title).toBe('Ben settled in: you got an extra beach');
  });

  it('says who copied your beach (docs/COPY_BEACH.md)', () => {
    expect(describeEntry(entry({ kind: 'copied' })).title).toMatch(/^Ben copied /);
    expect(announce('copied', 'Ben')).toBe('Ben copied your beach');
  });

  it('says what the sea did while you were away, and who fed your pet', () => {
    // a tide row: one per beach per day, the payload adds up what the sea did
    expect(describeEntry(entry({ kind: 'tide', from: null, beach: { code: 'ANA123', name: 'Moat Bay' }, payload: { tides: 4, lost: 3, brought: 0 } }))).toEqual({
      title: 'The sea worked on Moat Bay',
      detail: ['4 high tides', 'the sea took 3 things (back in your bag)'],
    });
    expect(
      describeEntry(entry({ kind: 'tide', from: null, payload: { tides: 1, lost: 0, brought: 5, checkpoint: 'ck-1' } })).detail,
    ).toEqual(['1 high tide', 'the sea washed up 5 things', 'kept as it was before the tide']);
    expect(describeEntry(entry({ kind: 'tide', from: null, payload: { tides: 0, lost: 0, brought: 0 } })).detail).toEqual(['the sea smoothed your sand']);
    // a pet feeding names the feeder and the pet
    expect(describeEntry(entry({ kind: 'pet_fed', beach: { code: 'ANA123', name: 'Moat Bay' }, payload: { pet: 'Shelly' } })).title).toBe(
      'Ben fed Shelly on Moat Bay',
    );
    expect(describeEntry(entry({ kind: 'pet_fed', payload: {} })).title).toBe('Ben fed your sand crab on your beach');
  });

  it('away events wait in the inbox: no note over the beach for them', () => {
    // tide and pet_fed are deliberately outside ANNOUNCE (inboxText.ts):
    // they happened while the owner was away, so they must not pop up when
    // the beach opens — the badge and the push carry them instead
    expect(ANNOUNCE.has('tide')).toBe(false);
    expect(ANNOUNCE.has('pet_fed')).toBe(false);
    expect(announce('tide', null)).toBe('Something new in your inbox');
    expect(announce('pet_fed', 'Ben')).toBe('Something new in your inbox');
  });

  it('articles, times and announcements', () => {
    expect(aPrize('parasol')).toBe('a parasol');
    expect(aPrize('beach')).toBe('an extra beach');
    const now = Date.UTC(2026, 10, 24, 12);
    expect(ago(now - 10_000, now)).toBe('now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min');
    expect(ago(now - 3 * 3600_000, now)).toBe('3 h');
    expect(ago(now - 2 * 86400_000, now)).toBe('2 d');
    expect(announce('visit', 'Ben')).toBe('Ben left you something');
    expect(announce('gift', null)).toBe('Someone gave you a gift');
  });

  it('the app and the server agree on the note limit', () => {
    expect(NOTE_MAX_CHARS).toBe(NOTE_MAX);
  });
});
