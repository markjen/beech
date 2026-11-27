// What each inbox row says (docs/INBOX_NOTIFICATIONS.md). Pure, so it can be
// tested without a DOM. These are statements of what happened (status and
// confirmations), never advice: the game shows no explanatory notes
// (CLAUDE.md); how the inbox works is in the web guide.

import type { InboxEntry } from '../net/account';
import { awayCounts } from './away';
import { prizeName } from '../world/items';

/** "a starfish", "an extra beach" */
export function aPrize(id: string): string {
  if (id === 'beach') return 'an extra beach';
  const n = prizeName(id).toLowerCase();
  return `${/^[aeiou]/.test(n) ? 'an' : 'a'} ${n}`;
}

const shells = (n: number) => `${n} shell${n === 1 ? '' : 's'}`;

/** The row's headline and, under it, the details (a note, a gift, a rating). */
export function describeEntry(e: InboxEntry): { title: string; detail: string[] } {
  const who = e.from?.name ?? 'A former visitor';
  const where = e.beach?.name || 'your beach';
  const detail: string[] = [];
  switch (e.kind) {
    case 'visit':
      if (e.note) detail.push(e.note.removed ? '(this note was removed)' : `“${e.note.text ?? ''}”`);
      if (e.item) detail.push(`gave you ${aPrize(e.item)}`);
      if (e.shells) detail.push(shells(e.shells));
      return { title: `${who} visited ${where}`, detail };
    case 'gift':
      return { title: `${who} gave you ${e.item ? aPrize(e.item) : 'something'}`, detail };
    case 'neighbor_request':
      return { title: `${who} wants to be your neighbor`, detail };
    case 'neighbor_linked':
      return { title: `You and ${who} are neighbors`, detail };
    case 'star':
      return { title: e.count > 1 ? `${e.count} people starred ${where}` : `${who} starred ${where}`, detail };
    case 'rating':
      if (e.rating?.average != null) detail.push(`${e.rating.average} average from ${e.rating.count}`);
      return { title: e.count > 1 ? `${where} got ${e.count} new ratings` : `${who} rated ${where}`, detail };
    case 'invite_joined':
      return { title: `${who} joined through your invite`, detail };
    case 'invite_settled':
      return { title: `${who} settled in${e.item ? `: you got ${aPrize(e.item)}` : ''}`, detail };
    case 'copied':
      return { title: `${who} copied ${where}`, detail };
    case 'tide': {
      // one row per beach per UTC day: the payload adds up what the sea did
      const p = e.payload;
      const tideDetail = awayCounts({ highTides: p.tides ?? 0, lost: p.lost ?? 0, broughtIn: p.brought ?? 0 });
      if (p.checkpoint) tideDetail.push('kept as it was before the tide');
      return { title: `The sea worked on ${where}`, detail: tideDetail };
    }
    case 'pet_fed': {
      const pet = e.payload.pet ?? 'your sand crab';
      return { title: `${who} fed ${pet} on ${where}`, detail };
    }
    default:
      return { title: String((e.payload as { text?: string }).text ?? 'News from beech'), detail };
  }
}

/** "now", "5 min", "3 h", "2 d", then a date */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** the kinds worth a note over the beach when they arrive (the rest wait in the inbox) */
export const ANNOUNCE = new Set(['visit', 'gift', 'neighbor_request', 'neighbor_linked', 'invite_settled', 'copied', 'system']);
// Away events ('tide', 'pet_fed') are deliberately not here: they happened
// while the owner was away, so they wait in the inbox (with a push) instead
// of popping up over the beach when it opens.

/** The note over the beach for a new row: "Ben left you something". */
export function announce(kind: string, name: string | null): string {
  const who = name ?? 'Someone';
  switch (kind) {
    case 'visit':
      return `${who} left you something`;
    case 'gift':
      return `${who} gave you a gift`;
    case 'neighbor_request':
      return `${who} wants to be your neighbor`;
    case 'neighbor_linked':
      return `You and ${who} are neighbors`;
    case 'invite_settled':
      return `${who} settled in`;
    case 'copied':
      return `${who} copied your beach`;
    case 'system':
      return 'News from beech';
    default:
      return 'Something new in your inbox';
  }
}
