// Share links: a URL that opens someone's beach.
//
// The beach id in the link is the owner's neighbor code (6 letters and
// numbers) — the public id beaches already have. The app reads `?visit=`
// on startup (see main.ts) and visits that beach once the person is
// signed in. These helpers are pure so they can be tested without a DOM.

/** `https://beech.markjen.com/?visit=K7F2QX` (works on any host/path). */
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

/** The query string with `visit` removed ("" when nothing is left). */
export function withoutVisitParam(search: string): string {
  const q = new URLSearchParams(search);
  q.delete('visit');
  const s = q.toString();
  return s ? `?${s}` : '';
}
