import { describe, expect, it } from 'vitest';
import type { InboxEntry } from '../src/net/account';
import { NOTE_MAX } from '../server/src/inbox';
import { NOTE_MAX_CHARS } from '../src/config';
import { aPrize, ago, announce, describeEntry } from '../src/ui/inboxText';

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
