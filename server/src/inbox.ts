// Visitors, the inbox and notifications (docs/INBOX_NOTIFICATIONS.md).
//
// What a visitor can leave on someone's beach (a rating in shells, a note,
// a gift from their bag), the limits on it, and the note filter. The inbox
// rows themselves are written by app.ts in the same statement as the thing
// they record, so a row exists exactly when the thing happened.

/** what lands in someone's inbox */
export const INBOX_KINDS = [
  'visit', // a visitor left a note and/or a gift (and maybe a rating)
  'gift', // a gift from the bag (no visitor card)
  'neighbor_request',
  'neighbor_linked',
  'star', // batched per beach per day
  'rating', // ratings without a note, batched per beach per day
  'invite_joined',
  'invite_settled',
  'system',
  'copied', // someone copied your beach (once per person per beach)
  'tide', // the sea worked on your beach while you were away (one row per beach per UTC day)
  'pet_fed', // a visitor fed your beach's pet
] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** longest note, in characters */
export const NOTE_MAX = 280;
/** notes one person can send in an hour, anywhere */
export const NOTES_PER_HOUR = 10;
/** notes one person can send to the same beach in a day */
export const NOTES_PER_BEACH_DAY = 3;
/** a rating can change at most this often */
export const RATING_EVERY_MS = 24 * 60 * 60 * 1000;
/** accounts younger than this can only send quick notes */
export const FREE_TEXT_AFTER_MS = 24 * 60 * 60 * 1000;
/** a beach shows its average once it has this many ratings */
export const RATING_SHOWN_AT = 3;
/** inbox rows kept per person (newest first) */
export const INBOX_KEEP = 500;
/** read rows older than this go */
export const INBOX_READ_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** Preset notes: one tap, always allowed (new accounts can only send these). */
export const QUICK_NOTES = [
  'Lovely beach!',
  'So peaceful here',
  'Great sandcastle!',
  'Nice moat!',
  'Beautiful spot',
  'Thanks for the gift!',
  'Come and visit mine',
  'Thank you!',
];

/**
 * Words a note may not contain, matched as whole words after folding case
 * and common look-alike characters. A starting list: the owner keeps it up
 * to date (docs/INBOX_NOTIFICATIONS.md, "Safety").
 */
const BLOCKED_WORDS = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'cunt', 'bitch', 'bastard', 'asshole', 'arsehole',
  'dick', 'cock', 'pussy', 'slut', 'whore', 'wanker', 'twat', 'prick', 'porn', 'nude', 'nudes', 'sex', 'sexy',
  'rape', 'kill yourself', 'kys', 'suicide', 'nazi', 'retard', 'retarded',
];

/** fold case, accents and look-alikes ("$h1t" -> "shit") */
function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't');
}

// a vowel may be masked ("f*ck", "sh#t"); a space may be any run of spaces
const wordPattern = (w: string) => w.replace(/[aeiou]/g, '[aeiou*#]').replace(/ /g, '\\s+');
const BLOCKED = new RegExp(`(^|[^a-z*#])(${BLOCKED_WORDS.map(wordPattern).join('|')})($|[^a-z*#])`);
/** links and handles: "http", "www.", "name.com", "@name", an email */
const LINKISH = /(https?:|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|me|co|ly|app|xyz|tv|link|site)\b|@[a-z0-9_]{2,}|discord|snap(chat)?|insta(gram)?|whats ?app|telegram)/i;
/** a phone number or similar: 7+ digits, allowing spaces, dots and dashes between */
const DIGITS = /(\d[\s.-]?){7,}/;

export type NoteCheck = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Is this note fine to deliver? Trims it, collapses runs of spaces, and
 * refuses empty, too long, links / handles / phone numbers, and blocked
 * words. `reason` is shown to the sender as-is (a short status, not advice).
 */
export function checkNote(raw: unknown): NoteCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'a note is text' };
  const text = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, reason: 'the note is empty' };
  if ([...text].length > NOTE_MAX) return { ok: false, reason: `notes are ${NOTE_MAX} characters at most` };
  if (LINKISH.test(text) || DIGITS.test(text)) return { ok: false, reason: 'no links, handles or numbers in notes' };
  if (BLOCKED.test(fold(text))) return { ok: false, reason: 'that note can’t be sent' };
  return { ok: true, text };
}

/** UTC date, YYYY-MM-DD: the key for batched rows */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
