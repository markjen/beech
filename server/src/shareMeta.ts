// Link previews for shared beaches.
//
// Crawlers don't run JavaScript, so the preview has to come from the
// server: when a page request carries a `?visit=` code that names a beach
// with a save, the Open Graph tags for that beach are injected into
// index.html. Anything else gets the plain page (the app itself then says
// "no beach has that code" if the code is bad). The name is the owner's
// first name, HTML-escaped before it goes into the page.

import fs from 'node:fs';

import type { Context, Next } from 'hono';

import { normalizeCode } from './app.js';
import type { Db } from './db.js';

/** `&<>"'` -> entities, so a name can't break out of an attribute. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function shareMetaTags({ name, url, image }: { name: string; url: string; image?: string }): string {
  const title = `Visit ${name}'s beach on beech`;
  const description = `Walk the shore, dig in the sand, and see what ${name} built.`;
  // a picture of the beach (shoreSite.ts draws it) only for beaches on the
  // shore, which anyone can already see on beechshore.com
  const pic = image
    ? [
        `<meta property="og:image" content="${escapeHtml(image)}">`,
        `<meta property="og:image:width" content="1200">`,
        `<meta property="og:image:height" content="630">`,
        `<meta name="twitter:image" content="${escapeHtml(image)}">`,
      ]
    : [];
  return [
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    ...pic,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
  ].join('\n    ');
}

/** Put the tags just before `</head>`; unchanged if there is no head tag. */
export function injectShareMeta(html: string, tags: string): string {
  const i = html.toLowerCase().indexOf('</head>');
  if (i < 0) return html;
  return `${html.slice(0, i)}    ${tags}\n  ${html.slice(i)}`;
}

/**
 * A handler for GET `/`: injects the preview tags when the request is a
 * share link for a real beach, otherwise passes through to the static
 * file (call `next()`). Registered before the static middleware.
 */
export function createSharePageHandler(db: Db, indexHtmlPath: string) {
  return async (c: Context, next: Next) => {
    const code = normalizeCode(c.req.query('visit') ?? '');
    if (code.length !== 6) return next();
    // A code names a beach now (multi-beach), and the preview names its
    // owner; only a beach with a save gets tags.
    const rows = await db.query<{ name: string; on_shore: boolean; updated_at: string | null }>(
      'SELECT u.name, b.on_shore, b.updated_at FROM beach b JOIN users u ON u.id = b.owner_id WHERE b.code = $1 AND b.sand IS NOT NULL',
      [code],
    );
    if (!rows[0]) return next();
    const name = rows[0].name?.trim() || 'Someone';
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    const u = new URL(c.req.url);
    const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || u.protocol.replace(':', '');
    const origin = `${proto}://${c.req.header('host') ?? u.host}`;
    const image = rows[0].on_shore ? `${origin}/shore/img/${code}.png?v=${rows[0].updated_at ?? 0}` : undefined;
    c.header('Cache-Control', 'no-cache');
    return c.html(injectShareMeta(html, shareMetaTags({ name, url: c.req.url, image })));
  };
}
