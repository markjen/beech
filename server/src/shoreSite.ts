// beechshore.com: every beach on the shore, public, no sign-in.
//
// Server-rendered pages (fast, and link previews and search engines see
// everything without running JavaScript), with progressive enhancement for
// social snapshot postcards, clipboard copy, Web Share API (including image
// files), and arrow-key walking. Only beaches that are on the shore and
// saved (`isPublic`) appear anywhere here: no picture, name or listing for
// any other beach. A beach page for a code that is off the shore sends you
// on to the game's own visit link (the game asks you to sign in, as it
// always has for visiting by code), so a link its owner shared still works.
//
// Served two ways by the game's own server (rootApp.ts): at `/` for the
// shore's own hosts (SHORE_HOSTS, beechshore.com), and under `/shore` on
// every other host, so it works before the domain does and in development.
//
//   /                      home: featured beach, most loved, rising, just built, places
//   /top /rising /new      the lists, 24 a page (?page=2)
//   /at/:place             beaches at one real place (bondi, waikiki…)
//   /find?q=...            jump to a beach by 6-letter code or search public beaches by name
//   /random                a random beach (302)
//   /:CODE                 one beach: its picture, social share & snapshot studio,
//                          its stretch of shore, visit in beech
//                          (off the shore: 302 to the game's ?visit= link; no such code: 404)
//   /img/:CODE.png         its link-preview card (1200×630)
//   /img/:CODE/thumb.png   its thumbnail (480×300)
//   /img/shore.png         the site's own card (the untouched beach)
//   /robots.txt /sitemap.xml

import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { beachPng, placeById, PLACES } from './beachImage.js';
import { DISCORD_INVITE_URL } from './community.js';
import { toBytes, type Db } from './db.js';
import { createRateLimiter, logEvent } from './observability.js';
import { BEACH, NODE, isPublic, normalizeCode, shoreGraph, type NodeRow, type Step } from './shore.js';
import { createItemSubmission, creatorSubmissions, limitUpload, multipart, requireSubmissionSession } from './itemSubmissions.js';
import { assetExample, assetSchema } from './submissionAssets.js';
import { connectContent, specContent, submissionContent } from './submissionPage.js';
import { FAVICON, ICONS, SHORE_CSS, SHORE_SCRIPT, WAVE_SVG } from './shoreAssets.js';

export interface ShoreSiteConfig {
  /** path the site is mounted at: '' on beechshore.com, '/shore' elsewhere */
  base: string;
  /** the game, where "visit" and "build your own" go (https://play.beech.games) */
  gameUrl: string;
  /** the site's public origin for links people share (https://beechshore.com); unset: from the request */
  publicUrl?: string;
  /** canonical shore origin, used only by the game's account connection window */
  submissionOrigin?: string;
  /** uncached image draws per minute per client IP (default 60) */
  imageDrawsPerMinute?: number;
  /** optional shared limiter across host/path mounts */
  imageLimiter?: (ip: string) => boolean;
  now?: () => number;
}

const PAGE = 24;
const RISING_WINDOW = 7 * 86400000;
const RISING_HALF_LIFE = 2 * 86400000;
const CARD = { width: 1200, height: 630 };
const THUMB = { width: 480, height: 300 };

type Sort = 'top' | 'rising' | 'new';
type NavKey = 'home' | 'top' | 'rising' | 'new' | 'submit' | 'other';
interface ListRow extends NodeRow {
  stars: string | number;
  recent: string | number;
  velocity: string | number;
}
export interface ShoreBeach {
  code: string;
  name: string;
  beachName?: string;
  location: string | null;
  updatedAt: number | null;
  stars: number;
  recent: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'beach';

/** "Ana's beach", or the name its owner gave it */
export const beachTitle = (b: { name: string; beachName?: string }) => b.beachName?.trim() || `${b.name?.trim() || 'Someone'}’s beach`;
const ownerName = (b: { name: string }) => b.name?.trim() || 'Someone';
const placeLabel = (loc: string | null) => {
  const p = placeById(loc);
  return p ? `${p.name}, ${p.place}` : '';
};

/** "just now", "5 min ago", "3 h ago", "2 days ago", "on 4 Mar 2026" */
export function ago(t: number | null, now: number): string {
  if (!t) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} days ago`;
  return `on ${new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
}

/** The text people send with a link: short enough for a text message. */
export function shareText(b: { name: string; beachName?: string } | null): string {
  if (!b) return 'Every beach people built in beech, one after another down an endless shore 🏖️';
  return b.beachName?.trim()
    ? `Look at “${b.beachName.trim()}”, ${ownerName(b)}’s beach on the shore 🏖️`
    : `Look at ${ownerName(b)}’s beach on the shore 🏖️`;
}

export function createShoreSite(db: Db, cfg: ShoreSiteConfig): Hono<any, any, any> {
  const base = cfg.base.replace(/\/$/, '');
  // routes below are relative to the base; fetch() is called with the full path
  const app = base ? new Hono().basePath(base) : new Hono();
  const graph = shoreGraph(db);
  const now = () => cfg.now?.() ?? Date.now();
  const game = cfg.gameUrl.replace(/\/$/, '');
  const href = (p: string) => (p === '/' ? base || '/' : `${base}${p}`);
  /** absolute URL on this site, for sharing and previews */
  const abs = (c: Context, p: string) => {
    if (cfg.publicUrl) return `${cfg.publicUrl.replace(/\/$/, '')}${p}`;
    const u = new URL(c.req.url);
    const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || u.protocol.replace(':', '');
    return `${proto}://${c.req.header('host') ?? u.host}${href(p)}`;
  };
  const visitUrl = (code: string) => `${game}/?visit=${code}`;
  const imgPath = (b: Pick<ShoreBeach, 'code' | 'updatedAt'>, kind: 'card' | 'thumb') =>
    `/img/${b.code}${kind === 'thumb' ? '/thumb' : ''}.png?v=${b.updatedAt ?? 0}`;

  // ------------------------------------------------------------ data
  const SCORE = `
    LEFT JOIN (
      SELECT f.beach_id,
             COUNT(*) AS stars,
             COUNT(*) FILTER (WHERE s.at > $1) AS recent,
             COALESCE(SUM(POWER(0.5, GREATEST(0, $2::bigint - s.at)::float8 / $3)) FILTER (WHERE s.at > $1), 0) AS velocity
        FROM favorites f
        JOIN beach fb ON fb.id = f.beach_id
        JOIN star_first s ON s.user_id = f.user_id AND s.beach_id = f.beach_id
       WHERE f.user_id <> fb.owner_id
       GROUP BY f.beach_id
    ) sc ON sc.beach_id = b.id`;
  const COLS = `${NODE}, COALESCE(sc.stars, 0) AS stars, COALESCE(sc.recent, 0) AS recent, COALESCE(sc.velocity, 0) AS velocity`;
  const PUBLIC = `b.on_shore AND b.sand IS NOT NULL`;
  const toBeach = (r: ListRow): ShoreBeach => ({
    code: r.code,
    name: r.name,
    beachName: r.beach_name || undefined,
    location: r.location,
    updatedAt: r.updated_at === null ? null : Number(r.updated_at),
    stars: Number(r.stars),
    recent: Number(r.recent),
  });
  const scoreArgs = () => {
    const t = now();
    return [t - RISING_WINDOW, t, RISING_HALF_LIFE];
  };

  async function list(sort: Sort, limit: number, offset: number, place?: string): Promise<ShoreBeach[]> {
    const args: unknown[] = scoreArgs();
    let where = PUBLIC;
    if (place) {
      args.push(place);
      where += ` AND b.location = $${args.length}`;
    }
    if (sort === 'rising') where += ' AND COALESCE(sc.recent, 0) > 0';
    const order =
      sort === 'top'
        ? 'stars DESC, velocity DESC, b.updated_at DESC'
        : sort === 'rising'
          ? 'velocity DESC, stars DESC'
          : 'b.updated_at DESC';
    args.push(limit, offset);
    const rows = await db.query<ListRow>(
      `SELECT ${COLS} FROM ${BEACH} ${SCORE} WHERE ${where} ORDER BY ${order}, b.id LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    return rows.map(toBeach);
  }

  async function search(q: string, limit: number): Promise<ShoreBeach[]> {
    const escaped = q.replace(/[\\%_]/g, '\\$&').toLowerCase();
    const args: unknown[] = [...scoreArgs(), `%${escaped}%`, limit];
    const rows = await db.query<ListRow>(
      `SELECT ${COLS} FROM ${BEACH} ${SCORE}
        WHERE ${PUBLIC}
          AND (LOWER(b.name) LIKE $4 ESCAPE '\\' OR LOWER(u.name) LIKE $4 ESCAPE '\\')
        ORDER BY stars DESC, b.updated_at DESC, b.id
        LIMIT $5`,
      args,
    );
    return rows.map(toBeach);
  }

  async function one(code: string): Promise<{ beach: ShoreBeach; node: NodeRow } | null> {
    const c = normalizeCode(code);
    if (c.length !== 6) return null;
    const rows = await db.query<ListRow>(`SELECT ${COLS} FROM ${BEACH} ${SCORE} WHERE b.code = $4 AND ${PUBLIC}`, [...scoreArgs(), c]);
    if (!rows[0]) return null;
    return { beach: toBeach(rows[0]), node: rows[0] };
  }

  async function counts(): Promise<{ beaches: number; places: Record<string, number> }> {
    const rows = await db.query<{ location: string | null; n: string }>(`SELECT b.location, COUNT(*) AS n FROM beach b WHERE ${PUBLIC} GROUP BY b.location`);
    const places: Record<string, number> = {};
    let beaches = 0;
    for (const r of rows) {
      beaches += Number(r.n);
      if (r.location) places[r.location] = Number(r.n);
    }
    return { beaches, places };
  }

  // ------------------------------------------------------------ images
  // Drawing a card takes tens of milliseconds, so recent ones are kept.
  // Image URLs carry the beach's save time (?v=), so a cached picture is
  // never stale for long and the URL can be cached for good. Uncached draws
  // are rate-limited per client IP so a crawler walking every code can't burn
  // the CPU (cache hits are free).
  const imageCache = new Map<string, Buffer>();
  const IMAGE_CACHE = 64;
  const imageDrawLimiter = cfg.imageLimiter ?? createRateLimiter(cfg.imageDrawsPerMinute ?? 60);
  const remember = (k: string, v: Buffer) => {
    imageCache.set(k, v);
    while (imageCache.size > IMAGE_CACHE) imageCache.delete(imageCache.keys().next().value as string);
  };
  const sendPng = (c: Context, png: Buffer, etag: string, immutable: boolean) => {
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, { ETag: etag });
    return c.body(new Uint8Array(png), 200, {
      'Content-Type': 'image/png',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      ETag: etag,
    });
  };

  app.get('/img/shore.png', (c) => {
    const key = 'shore';
    let png = imageCache.get(key);
    if (!png) remember(key, (png = beachPng(null, { ...CARD, location: 'bondi' })));
    return sendPng(c, png, '"shore-1"', false);
  });

  app.get('/img/:file{[A-Za-z0-9]{6}\\.png}', (c) => image(c, c.req.param('file').slice(0, 6), 'card'));
  app.get('/img/:code{[A-Za-z0-9]{6}}/thumb.png', (c) => image(c, c.req.param('code'), 'thumb'));

  async function image(c: Context, raw: string, kind: 'card' | 'thumb') {
    const code = normalizeCode(raw);
    const rows = await db.query<{ sand: unknown; location: string | null; updated_at: string | null }>(
      `SELECT b.sand, b.location, b.updated_at FROM beach b WHERE b.code = $1 AND ${PUBLIC}`,
      [code],
    );
    const row = rows[0];
    if (!row) return c.text('no such beach on the shore', 404);
    const v = String(row.updated_at ?? 0);
    const key = `${code}:${v}:${kind}`;
    let png = imageCache.get(key);
    if (!png) {
      const ip = (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim();
      if (ip && !imageDrawLimiter(ip)) {
        logEvent('shore_image_rate_limited', { kind }, 'WARNING');
        return c.text('too many image requests: slow down a little', 429, { 'Retry-After': '60' });
      }
      const t0 = Date.now();
      png = beachPng(toBytes(row.sand), { ...(kind === 'card' ? CARD : THUMB), location: row.location });
      remember(key, png);
      logEvent('shore_image', { kind, ms: Date.now() - t0, bytes: png.length });
    }
    return sendPng(c, png, `"${key}"`, c.req.query('v') === v);
  }

  // ------------------------------------------------------------ pages
  const html = (c: Context, body: string, status: 200 | 404 = 200) => {
    c.header('Cache-Control', status === 200 ? 'public, max-age=60' : 'no-cache');
    return c.html(body, status);
  };

  interface Meta {
    title: string;
    description: string;
    url: string;
    image: string;
    imageAlt: string;
  }
  const navLinks = (active: NavKey) =>
    [
      `<a href="${href('/top')}"${active === 'top' ? ' aria-current="page"' : ''}>Most loved</a>`,
      `<a href="${href('/submit')}"${active === 'submit' ? ' aria-current="page"' : ''}>Submit an item</a>`,
      `<a href="${href('/rising')}"${active === 'rising' ? ' aria-current="page"' : ''}>Rising</a>`,
      `<a href="${href('/new')}"${active === 'new' ? ' aria-current="page"' : ''}>Just built</a>`,
      `<a href="${href('/random')}" rel="nofollow">Surprise me</a>`,
    ].join('');

  const layout = (
    m: Meta,
    main: string,
    opts: { share?: { url: string; text: string; title: string }; active?: NavKey; query?: string } = {},
  ) => {
    const active = opts.active ?? 'other';
    const links = navLinks(active);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(m.title)}</title>
<meta name="description" content="${esc(m.description)}">
<link rel="canonical" href="${esc(m.url)}">
<meta name="theme-color" content="#fbf6ee">
<link rel="icon" href="${FAVICON}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,SOFT,wght@9..144,50,600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
<meta property="og:site_name" content="beechshore">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.description)}">
<meta property="og:url" content="${esc(m.url)}">
<meta property="og:image" content="${esc(m.image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${CARD.width}">
<meta property="og:image:height" content="${CARD.height}">
<meta property="og:image:alt" content="${esc(m.imageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(m.title)}">
<meta name="twitter:description" content="${esc(m.description)}">
<meta name="twitter:image" content="${esc(m.image)}">
<meta name="twitter:image:alt" content="${esc(m.imageAlt)}">
<style>${SHORE_CSS}</style>
</head>
<body>
<div class="top-wrap">
  <header class="top">
    <a class="brand" href="${href('/')}" aria-label="beechshore home">${WAVE_SVG}<span>beech<b>shore</b></span></a>
    <nav aria-label="Browse the shore">${links}</nav>
    <form class="find" action="${href('/find')}" method="get" role="search">
      ${ICONS.search}
      <input type="search" name="q" value="${esc(opts.query ?? '')}" placeholder="Code or name…" aria-label="Find a beach by code or name" autocomplete="off" spellcheck="false">
    </form>
    <a class="btn small" href="${esc(game)}/">Build a beach</a>
  </header>
  <nav class="mob-nav" aria-label="Browse the shore">${links}</nav>
</div>
<main>
${main}
</main>
<footer>
  <p><b>beech</b> is a calm sand-and-waves toy: dig, build, and watch the sea rework it. Every beach here is someone’s, built in the game and set on the shore.</p>
  <div class="flinks">
    <a href="${esc(game)}/">Play beech</a>
    <a href="${href('/top')}">Most loved</a>
    <a href="${href('/rising')}">Rising</a>
    <a href="${href('/new')}">Just built</a>
    <a href="${href('/find')}">Find a beach</a>
    <a href="${href('/submit')}">Submit an item</a>
    <a href="${esc(DISCORD_INVITE_URL)}">Discord</a>${
      opts.share
        ? ` <button type="button" class="linkish" data-share data-url="${esc(opts.share.url)}" data-text="${esc(opts.share.text)}" data-title="${esc(opts.share.title)}">Share this page</button>`
        : ''
    }
  </div>
</footer>
<div class="toast" role="status" aria-live="polite"></div>
<script>${SHORE_SCRIPT}</script>
</body>
</html>`;
  };

  const card = (b: ShoreBeach, n: number, opts: { rank?: number } = {}) => {
    const where = placeLabel(b.location);
    return `<li class="card">
  <a href="${href(`/${b.code}`)}">
    <span class="thumb">
      ${opts.rank ? `<span class="rank-badge r${opts.rank}">#${opts.rank}</span>` : ''}
      <img src="${esc(href(imgPath(b, 'thumb')))}" width="${THUMB.width}" height="${THUMB.height}" loading="lazy" decoding="async" alt="${esc(`${beachTitle(b)}, seen from above`)}">
    </span>
    <span class="info">
      <span class="t">${esc(beachTitle(b))}</span>
      <span class="s">${b.beachName ? `${esc(ownerName(b))} · ` : ''}${esc(where || 'somewhere on the shore')}</span>
      <span class="m">${b.stars ? `<span class="stars" title="${b.stars} stars">★ ${b.stars}</span>` : ''}${b.recent ? `<span class="up">▲ ${b.recent} this week</span>` : ''}<span class="when">${esc(ago(b.updatedAt, n))}</span></span>
    </span>
  </a>
</li>`;
  };
  const grid = (bs: ShoreBeach[], ranked = false, offset = 0) => {
    const n = now();
    return `<div class="grid-wrap"><ul class="grid">${bs.map((b, i) => card(b, n, ranked ? { rank: offset + i + 1 } : {})).join('')}</ul></div>`;
  };

  const socialButtons = (url: string, text: string, title: string, includeNative = false) => {
    const msg = `${text} ${url}`;
    const e = encodeURIComponent;
    return `<div class="share">${
      includeNative
        ? `\n  <button type="button" class="btn small" data-share data-url="${esc(url)}" data-text="${esc(text)}" data-title="${esc(title)}">${ICONS.share} Share</button>`
        : ''
    }
  <a class="chip" data-net="x" href="https://twitter.com/intent/tweet?text=${esc(e(text))}&amp;url=${esc(e(url))}" target="_blank" rel="noopener">${ICONS.x} X</a>
  <a class="chip" data-net="bsky" href="https://bsky.app/intent/compose?text=${esc(e(msg))}" target="_blank" rel="noopener">${ICONS.bsky} Bluesky</a>
  <a class="chip" data-net="threads" href="https://www.threads.net/intent/post?text=${esc(e(msg))}" target="_blank" rel="noopener">${ICONS.threads} Threads</a>
  <a class="chip" data-net="reddit" href="https://www.reddit.com/submit?url=${esc(e(url))}&amp;title=${esc(e(text || title))}" target="_blank" rel="noopener">${ICONS.reddit} Reddit</a>
  <a class="chip" data-net="wa" href="https://wa.me/?text=${esc(e(msg))}" target="_blank" rel="noopener">${ICONS.whatsapp} WhatsApp</a>
  <a class="chip" data-net="fb" href="https://www.facebook.com/sharer/sharer.php?u=${esc(e(url))}" target="_blank" rel="noopener">${ICONS.facebook} Facebook</a>
  <a class="chip" data-net="sms" href="sms:?&amp;body=${esc(e(msg))}">${ICONS.sms} Text</a>${
    includeNative ? `\n  <button type="button" class="chip" data-copy="${esc(url)}">${ICONS.copy} Copy link</button>` : ''
  }
</div>`;
  };

  // home
  app.get('/', async (c) => {
    const [top, rising, fresh, n] = await Promise.all([list('top', 8, 0), list('rising', 4, 0), list('new', 8, 0), counts()]);
    const url = abs(c, '/');
    const text = shareText(null);
    const featured = top[0] ?? fresh[0] ?? null;
    const featuredWhere = featured ? placeLabel(featured.location) : '';
    const places = PLACES.filter((p) => n.places[p.id])
      .sort((a, b) => (n.places[b.id] ?? 0) - (n.places[a.id] ?? 0))
      .map(
        (p) =>
          `<a class="chip" href="${href(`/at/${p.id}`)}"><span class="dot-swatch" style="--dot:${esc(p.sand)}" aria-hidden="true"></span>${esc(p.name)} <span>${n.places[p.id]}</span></a>`,
      )
      .join('');
    const main = `
<section class="hero">
  ${
    featured
      ? `<a class="hero-badge" href="${href(`/${featured.code}`)}">${ICONS.pin} Featured · ${esc(beachTitle(featured))}${featuredWhere ? ` · ${esc(featuredWhere)}` : ''}</a>`
      : ''
  }
  <img class="hero-img" src="${esc(href(featured ? imgPath(featured, 'card') : '/img/shore.png'))}" width="${CARD.width}" height="${CARD.height}" alt="${
    featured ? esc(`${beachTitle(featured)}, seen from above`) : ''
  }">
  <div class="hero-text">
    <h1>Every beach on the shore</h1>
    <p>Sandcastles, moats, harbours and terraces, built by people in <b>beech</b> and set one after another along a shore that never ends.${
      n.beaches ? ` <b>${n.beaches.toLocaleString('en')}</b> ${n.beaches === 1 ? 'beach' : 'beaches'} so far.` : ''
    }</p>
    <div class="cta">
      ${n.beaches ? `<a class="btn" href="${href('/random')}" rel="nofollow">${ICONS.compass} Walk the shore</a>` : ''}
      <a class="btn ghost" href="${esc(game)}/">Build your own beach</a>
    </div>
  </div>
</section>
${
  n.beaches === 0
    ? `<section><p class="empty">Nobody has set a beach on the shore yet. <a href="${esc(game)}/">Be the first.</a></p></section>`
    : `
${
  top.some((b) => b.stars)
    ? `<section><div class="sec-head"><h2>Most loved</h2><a class="see-all" href="${href('/top')}">See all →</a></div>${grid(top.filter((b) => b.stars), true)}</section>`
    : ''
}
${
  rising.length
    ? `<section><div class="sec-head"><h2>Rising this week</h2><a class="see-all" href="${href('/rising')}">See all →</a></div>${grid(rising)}</section>`
    : ''
}
<section><div class="sec-head"><h2>Just built</h2><a class="see-all" href="${href('/new')}">See all →</a></div>${grid(fresh)}</section>
${places ? `<section><div class="sec-head"><h2>By real beach</h2></div><div class="chips">${places}</div></section>` : ''}`
}
<section class="sharebox">
  <div>
    <h2>Send the shore to someone</h2>
    <p>Share beechshore, or open any beach to grab a postcard snapshot for social media.</p>
  </div>
  ${socialButtons(url, text, 'beechshore', true)}
</section>`;
    return html(
      c,
      layout(
        {
          title: 'beechshore: every beach on the shore',
          description: 'Sandcastles, moats and harbours people built in beech, one beach after another along an endless shore. Walk it, then build your own.',
          url,
          image: abs(c, featured ? imgPath(featured, 'card') : '/img/shore.png'),
          imageAlt: 'A beach from above, sand and sea',
        },
        main,
        { share: { url, text, title: 'beechshore' }, active: 'home' },
      ),
    );
  });

  // lists
  const LISTS: Record<Sort, { title: string; blurb: string }> = {
    top: { title: 'Most loved', blurb: 'The beaches with the most stars. People star a beach in the game when they walk past it.' },
    rising: { title: 'Rising this week', blurb: 'Beaches picking up stars right now: a star today counts for more than one last week.' },
    new: { title: 'Just built', blurb: 'Beaches that changed most recently. The sea keeps working on them too.' },
  };
  for (const sort of ['top', 'rising', 'new'] as const) {
    app.get(`/${sort}`, async (c) => {
      const page = Math.min(500, Math.max(1, Number(c.req.query('page') ?? 1) | 0 || 1));
      const rows = await list(sort, PAGE + 1, (page - 1) * PAGE);
      const more = rows.length > PAGE;
      const bs = rows.slice(0, PAGE);
      const L = LISTS[sort];
      const url = abs(c, `/${sort}${page > 1 ? `?page=${page}` : ''}`);
      const main = `
<section class="head">
  <h1>${esc(L.title)}</h1>
  <p>${esc(L.blurb)}</p>
  <div class="tabs">${(['top', 'rising', 'new'] as const).map((s) => `<a href="${href(`/${s}`)}"${s === sort ? ' aria-current="page"' : ''}>${LISTS[s].title}</a>`).join('')}</div>
</section>
<section>${bs.length ? grid(bs, sort !== 'new', (page - 1) * PAGE) : `<p class="empty">Nothing here yet.</p>`}
<nav class="pager">${page > 1 ? `<a class="btn ghost" href="${href(`/${sort}${page > 2 ? `?page=${page - 1}` : ''}`)}">← newer</a>` : ''}${
        more ? `<a class="btn ghost" href="${href(`/${sort}?page=${page + 1}`)}">more →</a>` : ''
      }</nav></section>`;
      return html(
        c,
        layout(
          {
            title: `${L.title} · beechshore`,
            description: L.blurb,
            url,
            image: abs(c, bs[0] ? imgPath(bs[0], 'card') : '/img/shore.png'),
            imageAlt: 'A beach from above',
          },
          main,
          { share: { url, text: `${L.title} on beechshore 🏖️`, title: L.title }, active: sort },
        ),
      );
    });
  }

  // find by 6-character code or public beach/owner name
  app.get('/find', async (c) => {
    const raw = (c.req.query('q') ?? '').trim().slice(0, 80);
    const code = normalizeCode(raw);
    // Direct jump when someone pastes a 6-character code (e.g. "k7f-2qx" or "K7F2QX").
    if (code.length === 6 && /^[A-Za-z0-9\s-]+$/.test(raw)) {
      const exists = (await db.query('SELECT 1 FROM beach WHERE code = $1', [code])).length > 0;
      if (exists) {
        c.header('Cache-Control', 'no-store');
        return c.redirect(href(`/${code}`), 302);
      }
    }
    const hits = raw ? await search(raw, PAGE) : [];
    const url = abs(c, '/find');
    const main = `
<section class="head">
  <h1>Find a beach</h1>
  <p>Enter a 6-letter beach code to jump straight to it, or search public beaches by name to view and share their snapshot.</p>
  <form class="find-big" action="${href('/find')}" method="get" role="search">
    <input type="search" name="q" value="${esc(raw)}" placeholder="e.g. K7F2QX or Ana" aria-label="Beach code or name" autofocus>
    <button type="submit" class="btn">Find</button>
  </form>
</section>
${
  raw
    ? `<section>${
        hits.length
          ? `<div class="sec-head"><h2>${hits.length} ${hits.length === 1 ? 'beach' : 'beaches'} matching “${esc(raw)}”</h2></div>${grid(hits)}`
          : `<p class="empty">No beaches on the shore match “${esc(raw)}”. Check the 6-letter code in beech’s settings and try again.</p>`
      }</section>`
    : ''
}`;
    return html(
      c,
      layout(
        {
          title: raw ? `Search “${raw}” · beechshore` : 'Find a beach · beechshore',
          description: 'Find any beach on beechshore by its 6-letter code or name to visit it in 3D or share a snapshot.',
          url,
          image: abs(c, hits[0] ? imgPath(hits[0], 'card') : '/img/shore.png'),
          imageAlt: 'Find a beach on beechshore',
        },
        main,
        { query: raw },
      ),
    );
  });

  // a real place
  app.get('/at/:place', async (c) => {
    const p = placeById(c.req.param('place').toLowerCase());
    if (!p) return notFound(c);
    const page = Math.min(500, Math.max(1, Number(c.req.query('page') ?? 1) | 0 || 1));
    const rows = await list('top', PAGE + 1, (page - 1) * PAGE, p.id);
    const bs = rows.slice(0, PAGE);
    const url = abs(c, `/at/${p.id}`);
    const main = `
<section class="head">
  <h1>${esc(p.name)}</h1>
  <p>Beaches built at ${esc(p.name)}, ${esc(p.place)}. In the game they get the real sun, moon and tides there.</p>
</section>
<section>${bs.length ? grid(bs) : '<p class="empty">Nobody has built here yet.</p>'}
<nav class="pager">${page > 1 ? `<a class="btn ghost" href="${href(`/at/${p.id}${page > 2 ? `?page=${page - 1}` : ''}`)}">← back</a>` : ''}${
      rows.length > PAGE ? `<a class="btn ghost" href="${href(`/at/${p.id}?page=${page + 1}`)}">more →</a>` : ''
    }</nav></section>`;
    return html(
      c,
      layout(
        {
          title: `${p.name}, ${p.place} · beechshore`,
          description: `Beaches people built at ${p.name} in beech.`,
          url,
          image: abs(c, bs[0] ? imgPath(bs[0], 'card') : '/img/shore.png'),
          imageAlt: p.name,
        },
        main,
        { share: { url, text: `Beaches built at ${p.name} 🏖️`, title: p.name } },
      ),
    );
  });

  app.get('/random', async (c) => {
    const rows = await db.query<{ code: string }>(`SELECT b.code FROM beach b WHERE ${PUBLIC} ORDER BY random() LIMIT 1`);
    c.header('Cache-Control', 'no-store');
    return c.redirect(rows[0] ? href(`/${rows[0].code}`) : href('/'), 302);
  });

  app.get('/robots.txt', (c) => c.text(`User-agent: *\nAllow: /\nDisallow: ${base}/random\nDisallow: ${base}/find\nSitemap: ${abs(c, '/sitemap.xml')}\n`));

  app.get('/sitemap.xml', async (c) => {
    const rows = await db.query<{ code: string; updated_at: string | null }>(
      `SELECT b.code, b.updated_at FROM beach b WHERE ${PUBLIC} ORDER BY b.updated_at DESC NULLS LAST LIMIT 5000`,
    );
    const n = await counts();
    const urls = [
      `<url><loc>${esc(abs(c, '/'))}</loc></url>`,
      ...(['top', 'rising', 'new'] as const).map((s) => `<url><loc>${esc(abs(c, `/${s}`))}</loc></url>`),
      ...PLACES.filter((p) => n.places[p.id]).map((p) => `<url><loc>${esc(abs(c, `/at/${p.id}`))}</loc></url>`),
      ...rows.map((r) => `<url><loc>${esc(abs(c, `/${r.code}`))}</loc>${r.updated_at ? `<lastmod>${new Date(Number(r.updated_at)).toISOString()}</lastmod>` : ''}</url>`),
    ];
    c.header('Content-Type', 'application/xml; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=3600');
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  });

  // one beach (last: any six letters and numbers)
  const submissionLayout = (c: Context, title: string, path: string, main: string) => layout({
    title: `${title} · beechshore`,
    description: 'Create and submit an item for Beech.',
    url: abs(c, path),
    image: abs(c, '/img/shore.png'),
    imageAlt: 'An untouched beach',
  }, main, { active: 'submit' });

  app.get('/submit', (c) => {
    const bridge = cfg.publicUrl ? `${game}/shore/submit/connect?destination=shore` : null;
    c.header('X-Frame-Options', 'DENY');
    return html(c, submissionLayout(c, 'Submit an item', '/submit', submissionContent(href, { bridge, endpoint: href('/submit/items') })));
  });
  app.get('/submit/spec', (c) => html(c, submissionLayout(c, 'Item asset specification', '/submit/spec', specContent(href))));
  app.get('/submit/schema.json', (c) => c.json(assetSchema, 200, { 'Cache-Control': 'public, max-age=60' }));
  app.get('/submit/example.json', (c) => c.json(assetExample, 200, { 'Cache-Control': 'public, max-age=60' }));
  if (!cfg.publicUrl) {
    app.get('/submit/connect', (c) => {
      const destination = c.req.query('destination') === 'shore' ? cfg.submissionOrigin : null;
      if (c.req.query('destination') === 'shore' && !destination) return c.text('Submission site unavailable', 404);
      c.header('Cache-Control', 'no-store');
      c.header('X-Frame-Options', 'DENY');
      c.header('Referrer-Policy', 'no-referrer');
      return c.html(submissionLayout(c, 'Connect Beech', '/submit/connect', connectContent(destination ?? null)));
    });
  }

  const submissionSession = requireSubmissionSession(db);
  const uploads = createRateLimiter(5);
  app.get('/submit/items', submissionSession, async (c) => {
    const user = c.get('submitter');
    const [submissions, credit] = await Promise.all([
      creatorSubmissions(db, user.id),
      db.query<{ credit_cents: number }>('SELECT credit_cents FROM users WHERE id = $1', [user.id]),
    ]);
    return c.json({ user: { name: user.name }, submissions, creditCents: credit[0]?.credit_cents ?? 0 });
  });
  app.post('/submit/items', submissionSession, limitUpload, async (c) => {
    const user = c.get('submitter');
    if (!uploads(user.id)) return c.json({ error: 'Too many attempts. Try again in a minute.' }, 429, { 'Retry-After': '60' });
    const id = await createItemSubmission(db, user.id, await multipart(c.req.raw), now());
    return c.json({ id, status: 'pending' }, 201);
  });

  app.get('/:code{[A-Za-z0-9]{6}}', async (c) => {
    const raw = c.req.param('code');
    const found = await one(raw);
    if (!found) {
      // A beach kept off the shore (or not saved yet) isn't shown here, but
      // its owner may still have shared its link on purpose: send them to
      // the game, which shows it to signed-in people as visiting by code
      // always has. Only a code that names no beach at all is a 404.
      const code = normalizeCode(raw);
      const exists = code.length === 6 && (await db.query('SELECT 1 FROM beach WHERE code = $1', [code])).length > 0;
      if (exists) {
        c.header('Cache-Control', 'no-store');
        return c.redirect(visitUrl(code), 302);
      }
      return notFound(c);
    }
    const { beach: b, node } = found;
    // the short link is the canonical one, in capitals
    if (raw !== b.code) return c.redirect(href(`/${b.code}`), 301);
    const { left, right } = await graph.walk(node, ['left', 'right'], 3, new Set([node.id]), isPublic);
    const title = beachTitle(b);
    const owner = ownerName(b);
    const where = placeLabel(b.location);
    const url = abs(c, `/${b.code}`);
    const shortUrl = url.replace(/^https?:\/\//, '');
    const text = shareText(b);
    const cardHref = href(imgPath(b, 'card'));
    const thumbHref = href(imgPath(b, 'thumb'));
    const n = now();
    const step = (s: Step | undefined, dir: 'left' | 'right') =>
      s
        ? `<a class="walk ${dir}" href="${href(`/${s.code}`)}" rel="${dir === 'left' ? 'prev' : 'next'}" data-key="${dir === 'left' ? 'ArrowLeft' : 'ArrowRight'}" title="Walk ${dir} to ${esc(beachTitle(s))}" aria-label="Walk ${dir} to ${esc(beachTitle(s))}">${dir === 'left' ? '‹' : '›'}</a>`
        : '';
    const strip = (s: Step) =>
      `<li><a href="${href(`/${s.code}`)}"><span class="sthumb"><img src="${esc(href(`/img/${s.code}/thumb.png?v=${s.updatedAt ?? 0}`))}" width="${THUMB.width}" height="${THUMB.height}" loading="lazy" alt="${esc(beachTitle(s))}"></span><span class="slabel"><span>${esc(beachTitle(s))}</span>${s.linked ? '<span class="linked-dot">Neighbor</span>' : ''}</span></a></li>`;
    // left is on the left, the way you'd see it facing the sea
    const hereItem = `<li class="here"><div class="here-inner"><span class="sthumb"><img src="${esc(thumbHref)}" width="${THUMB.width}" height="${THUMB.height}" alt=""></span><span class="slabel"><span>${esc(title)}</span></span></div></li>`;
    const shore = [...left].reverse().map(strip).join('') + hereItem + right.map(strip).join('');
    const neighbors = [left[0]?.linked ? left[0] : null, right[0]?.linked ? right[0] : null].filter(Boolean) as Step[];
    const main = `
<article class="beach">
  <div class="pic">
    <img src="${esc(cardHref)}" width="${CARD.width}" height="${CARD.height}" alt="${esc(`${title}, seen from above: the sand, the sea, and what's on it`)}">
    <div class="pic-pills">
      ${where ? `<a class="pic-pill" href="${href(`/at/${b.location}`)}">${ICONS.pin} ${esc(where)}</a>` : '<span></span>'}
      <button type="button" class="pic-pill code" data-copy="${esc(b.code)}" data-copied="Code ${esc(b.code)} copied" title="Copy beach code">${esc(b.code)}</button>
    </div>
    ${step(left[0], 'left')}${step(right[0], 'right')}
  </div>
  <div class="about">
    <div>
      <h1>${esc(title)}</h1>
      <p class="by">${b.beachName ? `by ${esc(owner)}` : ''}${b.beachName && where ? ' · ' : ''}${
        where ? `<a href="${href(`/at/${b.location}`)}">${esc(where)}</a>` : ''
      }</p>
      <p class="m">${b.stars ? `<span class="stars">★ ${b.stars} ${b.stars === 1 ? 'star' : 'stars'}</span>` : ''}${
        b.recent ? `<span class="up">▲ ${b.recent} this week</span>` : ''
      }<span class="when">changed ${esc(ago(b.updatedAt, n))}</span></p>
      ${neighbors.length ? `<p class="nb">Neighbors: ${neighbors.map((s) => `<a href="${href(`/${s.code}`)}">${esc(beachTitle(s))}</a>`).join(' and ')}</p>` : ''}
    </div>
    <div class="actions">
      <div class="action-row">
        <a class="btn big" href="${esc(visitUrl(b.code))}">Visit in beech →</a>
        <a class="btn ghost big" href="#share">${ICONS.share} Share snapshot</a>
      </div>
      <p class="hint">Walk onto it in 3D, sit in a deckchair, star it. The waves are live.</p>
    </div>
  </div>

  <section id="share" class="studio"
    data-img="${esc(cardHref)}"
    data-title="${esc(title)}"
    data-owner="${esc(owner)}"
    data-place="${esc(where)}"
    data-stars="${b.stars}"
    data-code="${esc(b.code)}"
    data-url="${esc(url)}"
    data-text="${esc(text)}"
    data-slug="${esc(slug(title))}">
    <div class="studio-head">
      <h2>Share this beach</h2>
      <div class="seg" role="group" aria-label="Snapshot format">
        <button type="button" data-fmt="postcard" aria-pressed="true">Postcard</button>
        <button type="button" data-fmt="square" aria-pressed="false">Square</button>
        <button type="button" data-fmt="story" aria-pressed="false">Story</button>
        <button type="button" data-fmt="clean" aria-pressed="false">Clean</button>
      </div>
    </div>
    <div class="studio-grid">
      <div class="stage">
        <div class="stage-frame">
          <canvas class="snap-canvas" aria-label="${esc(`Preview snapshot of ${title}`)}"></canvas>
          <img class="snap-fallback" src="${esc(cardHref)}" width="${CARD.width}" height="${CARD.height}" alt="${esc(`Preview snapshot of ${title}`)}">
        </div>
        <div class="stage-meta">1200 × 630 · Ready for X, Discord, Bluesky, Reddit, Facebook</div>
      </div>
      <div class="studio-controls">
        <div class="snap-actions">
          <button type="button" class="btn btn-primary-snap" data-share-snap>${ICONS.share} Share with snapshot</button>
          <button type="button" class="btn ghost" data-copy-img>${ICONS.image} Copy snapshot</button>
          <button type="button" class="btn ghost" data-download-snap>${ICONS.download} Download PNG</button>
        </div>
        <div class="field-group">
          <span class="field-label">Direct link</span>
          <div class="copy-bar">
            <code>${esc(shortUrl)}</code>
            <button type="button" class="chip" data-copy="${esc(url)}">${ICONS.copy} Copy link</button>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label" for="share-caption">Caption</label>
          <div class="copy-bar">
            <input id="share-caption" type="text" data-caption value="${esc(text)}" aria-label="Post caption">
            <button type="button" class="chip" data-copy-post>${ICONS.copy} Copy post</button>
          </div>
        </div>
        <div class="field-group">
          <span class="field-label">Post directly to</span>
          ${socialButtons(url, text, title, false)}
        </div>
        <p class="share-note">Pasting <b>${esc(shortUrl)}</b> on X, Discord, iMessage, Bluesky, Slack, or WhatsApp automatically includes your beach’s preview snapshot.</p>
      </div>
    </div>
  </section>
</article>
${
  left.length || right.length
    ? `<section><div class="sec-head"><h2>Along the shore</h2><span class="hint keys">Use ← and → to walk</span></div><div class="strip-wrap"><ul class="strip">${shore}</ul></div></section>`
    : ''
}
<section class="make">
  <div>
    <h2>Make one of your own</h2>
    <p>Dig a moat, build a castle, put out a deckchair, and set your beach on the shore next to everyone else’s. Free, in your browser or on your phone.</p>
  </div>
  <a class="btn big" href="${esc(game)}/">Start building →</a>
</section>`;
    return html(
      c,
      layout(
        {
          title: `${title} on beechshore`,
          description: `${b.beachName ? `${owner}’s beach` : 'A beach'}${where ? ` at ${where}` : ''}, built in beech. ${b.stars ? `★ ${b.stars}. ` : ''}Walk the shore, then build your own.`,
          url,
          image: abs(c, imgPath(b, 'card')),
          imageAlt: `${title}, seen from above`,
        },
        main,
        { share: { url, text, title } },
      ),
    );
  });

  const notFound = (c: Context) =>
    html(
      c,
      layout(
        {
          title: 'Washed away · beechshore',
          description: 'That beach is not on the shore.',
          url: abs(c, '/'),
          image: abs(c, '/img/shore.png'),
          imageAlt: 'An untouched beach',
        },
        `<section class="head"><h1>Washed away</h1><p>No beach on the shore has that code. Its owner may have taken it off the shore, or the code changed.</p>
<div class="cta"><a class="btn" href="${href('/')}">See the shore</a><a class="btn ghost" href="${esc(game)}/">Build a beach</a></div></section>`,
      ),
      404,
    );
  app.notFound(notFound);
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    logEvent('shore_error', { message: err.message, path: c.req.path }, 'ERROR');
    return c.text('something went wrong', 500);
  });
  return app;
}
