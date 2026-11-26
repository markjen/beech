// Share links: a URL that opens someone's beach.
//
// The beach id in the link is the owner's neighbor code (6 letters and
// numbers) — the public id beaches already have. The app reads `?visit=`
// on startup (see main.ts) and visits that beach once the person is
// signed in. These helpers are pure so they can be tested without a DOM.

/** `https://play.beech.games/?visit=K7F2QX` (works on any host/path). */
export function shareUrl(origin: string, pathname: string, code: string): string {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${origin}${path}?visit=${code}`;
}

/** The `?visit=` code from a query string, or null. Forgiving about case, spaces and dashes. */
export function visitCodeFromUrl(search: string): string | null {
  const raw = new URLSearchParams(search).get('visit') ?? '';
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === 6 ? code : null;
}

/** `?visit=CODE&copy=1` (beechshore.com's "Copy to my beach"): open the copy sheet once there. */
export function copyRequested(search: string): boolean {
  return visitCodeFromUrl(search) !== null && new URLSearchParams(search).get('copy') === '1';
}

/** The query string with `visit` removed ("" when nothing is left). */
export function withoutVisitParam(search: string): string {
  const q = new URLSearchParams(search);
  q.delete('visit');
  q.delete('copy');
  const s = q.toString();
  return s ? `?${s}` : '';
}

// Invite links (docs/INVITES_GUIDE.md): `?invite=CODE`, the inviter's home
// beach code. The app keeps the code until the friend has signed in, then
// claims it (POST /api/referrals/claim).

/** `https://play.beech.games/?invite=K7F2QX` (works on any host/path). */
export function inviteUrl(origin: string, pathname: string, code: string): string {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${origin}${path}?invite=${code}`;
}

/** The `?invite=` code from a query string, or null. Forgiving like `?visit=`. */
export function inviteCodeFromUrl(search: string): string | null {
  const raw = new URLSearchParams(search).get('invite') ?? '';
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === 6 ? code : null;
}

/** The query string with `invite` removed ("" when nothing is left). */
export function withoutInviteParam(search: string): string {
  const q = new URLSearchParams(search);
  q.delete('invite');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** The words that go with a shared invite link. */
export function inviteText(name: string): string {
  return name
    ? `${name} invited you to beech, a quiet beach by the sea. Dig in the sand, watch the waves, and get a welcome gift:`
    : 'Come to my beach on beech: dig in the sand, watch the waves, and get a welcome gift:';
}

// ---------------------------------------------------------------- beechshore.com
// The public shore (server/src/shoreSite.ts): every beach on the shore, with
// a picture, for anyone, signed in or not. Its beach links are the ones to
// send people: they preview with a picture of the beach, open without an
// account, and carry on into the game with "Visit in beech".

/** Your account page on beechshore (docs/SAND_BUCKS.md): balance, history, top-ups, gifts, invites; `section` is its anchor. */
export function shoreAccountUrl(query: Record<string, string> = {}, section?: string, shore: string = SHORE_URL): string {
  const q = new URLSearchParams(query).toString();
  return `${shore}/account${q ? `?${q}` : ''}${section ? `#${section}` : ''}`;
}

/** The shore site's origin (VITE_SHORE_URL; the game's server also has it under /shore). */
export const SHORE_URL = String(import.meta.env.VITE_SHORE_URL || 'https://beechshore.com').replace(/\/+$/, '');

/** `https://beechshore.com/K7F2QX`: short enough to text. */
export function shoreBeachUrl(code: string, shore: string = SHORE_URL): string {
  return `${shore.replace(/\/+$/, '')}/${code}`;
}

/** What goes with a shared link: "Look at Ana's beach on the shore 🏖️" */
export function beachShareText(owner: string | undefined, beachName?: string, yours = false): string {
  const who = owner?.trim() || 'Someone';
  if (yours) return beachName?.trim() ? `Come and see “${beachName.trim()}”, my beach on the shore 🏖️` : 'Come and see my beach on the shore 🏖️';
  return beachName?.trim() ? `Look at “${beachName.trim()}”, ${who}’s beach on the shore 🏖️` : `Look at ${who}’s beach on the shore 🏖️`;
}
