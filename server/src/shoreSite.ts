// beechshore.com: every beach on the shore, public, no sign-in.
//
// Server-rendered pages (fast, and link previews and search engines see
// everything without running JavaScript), with a few lines of script for
// sharing and arrow-key walking. Only beaches that are on the shore and
// saved (`isPublic`) appear anywhere here: no picture, name or listing for
// any other beach. A beach page for a code that is off the shore sends you
// on to the game's own visit link (the game asks you to sign in, as it
// always has for visiting by code), so a link its owner shared still works.
//
// Served two ways by the game's own server (rootApp.ts): at `/` for the
// shore's own hosts (SHORE_HOSTS, beechshore.com), and under `/shore` on
// every other host, so it works before the domain does and in development.
//
//   /                      home: most loved, rising, just built, places
//   /top /rising /new      the lists, 24 a page (?page=2)
//   /at/:place             beaches at one real place (bondi, waikiki…)
//   /random                a random beach (302)
//   /:CODE                 one beach: its picture, its stretch of shore, share, visit in beech
//                          (off the shore: 302 to the game's ?visit= link; no such code: 404)
//   /img/:CODE.png         its link-preview card (1200×630)
//   /img/:CODE/thumb.png   its thumbnail (480×300)
//   /img/shore.png         the site's own card (the untouched beach)
//   /robots.txt /sitemap.xml

import { Hono, type Context } from 'hono';

import { beachPng, placeById, PLACES } from './beachImage.js';
import { DISCORD_INVITE_URL } from './community.js';
import { toBytes, type Db } from './db.js';
import { BEACH, NODE, isPublic, normalizeCode, shoreGraph, type NodeRow, type Step } from './shore.js';
import { logEvent } from './observability.js';

export interface ShoreSiteConfig {
  /** path the site is mounted at: '' on beechshore.com, '/shore' elsewhere */
  base: string;
  /** the game, where "visit" and "build your own" go (https://play.beech.games) */
  gameUrl: string;
  /** the site's public origin for links people share (https://beechshore.com); unset: from the request */
  publicUrl?: string;
  now?: () => number;
}

const PAGE = 24;
const RISING_WINDOW = 7 * 86400000;
const RISING_HALF_LIFE = 2 * 86400000;
const CARD = { width: 1200, height: 630 };
const THUMB = { width: 480, height: 300 };

type Sort = 'top' | 'rising' | 'new';
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
  const imgPath = (b: ShoreBeach, kind: 'card' | 'thumb') =>
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
  // never stale for long and the URL can be cached for good.
  const imageCache = new Map<string, Buffer>();
  const IMAGE_CACHE = 64;
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
  const layout = (m: Meta, main: string, opts: { share?: { url: string; text: string; title: string } } = {}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(m.title)}</title>
<meta name="description" content="${esc(m.description)}">
<link rel="canonical" href="${esc(m.url)}">
<meta name="theme-color" content="#8fd0e6">
<link rel="icon" href="${FAVICON}" type="image/svg+xml">
<meta property="og:site_name" content="beechshore">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.description)}">
<meta property="og:url" content="${esc(m.url)}">
<meta property="og:image" content="${esc(m.image)}">
<meta property="og:image:width" content="${CARD.width}">
<meta property="og:image:height" content="${CARD.height}">
<meta property="og:image:alt" content="${esc(m.imageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(m.title)}">
<meta name="twitter:description" content="${esc(m.description)}">
<meta name="twitter:image" content="${esc(m.image)}">
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <a class="brand" href="${href('/')}" aria-label="beechshore home">${WAVE_SVG}<span>beech<b>shore</b></span></a>
  <nav>
    <a href="${href('/top')}">Most loved</a>
    <a href="${href('/new')}">Just built</a>
    <a href="${href('/random')}" rel="nofollow">Surprise me</a>
  </nav>
  <a class="btn small" href="${esc(game)}/">Build a beach</a>
</header>
<main>
${main}
</main>
<footer>
  <p><b>beech</b> is a calm sand-and-waves toy: dig, build, and watch the sea rework it. Every beach here is someone’s, built in the game and set on the shore.</p>
  <p><a href="${esc(game)}/">Play beech</a> · <a href="${href('/top')}">Most loved</a> · <a href="${href('/rising')}">Rising</a> · <a href="${href('/new')}">Just built</a> · <a href="${esc(DISCORD_INVITE_URL)}">Discord</a>${
    opts.share ? ` · <button type="button" class="linkish" data-share data-url="${esc(opts.share.url)}" data-text="${esc(opts.share.text)}" data-title="${esc(opts.share.title)}">Share this page</button>` : ''
  }</p>
</footer>
<div class="toast" role="status" aria-live="polite"></div>
<script>${SCRIPT}</script>
</body>
</html>`;

  const card = (b: ShoreBeach, n: number, opts: { rank?: number } = {}) => {
    const where = placeLabel(b.location);
    return `<li class="card">
  <a href="${href(`/${b.code}`)}">
    <img src="${esc(href(imgPath(b, 'thumb')))}" width="${THUMB.width}" height="${THUMB.height}" loading="lazy" decoding="async" alt="${esc(`${beachTitle(b)}, seen from above`)}">
    <span class="info">
      <span class="t">${opts.rank ? `<span class="rank r${opts.rank}">${opts.rank}</span>` : ''}${esc(beachTitle(b))}</span>
      <span class="s">${b.beachName ? `${esc(ownerName(b))} · ` : ''}${esc(where || 'somewhere on the shore')}</span>
      <span class="m">${b.stars ? `<span class="stars" title="${b.stars} stars">★ ${b.stars}</span>` : ''}${b.recent ? `<span class="up">▲ ${b.recent} this week</span>` : ''}<span class="when">${esc(ago(b.updatedAt, n))}</span></span>
    </span>
  </a>
</li>`;
  };
  const grid = (bs: ShoreBeach[], ranked = false, offset = 0) => {
    const n = now();
    return `<ul class="grid">${bs.map((b, i) => card(b, n, ranked ? { rank: offset + i + 1 } : {})).join('')}</ul>`;
  };
  const shareRow = (url: string, text: string, title: string) => {
    const msg = `${text} ${url}`;
    const e = encodeURIComponent;
    return `<div class="share">
  <button type="button" class="btn" data-share data-url="${esc(url)}" data-text="${esc(text)}" data-title="${esc(title)}">${SHARE_SVG} Share</button>
  <a class="chip" href="sms:?&amp;body=${esc(e(msg))}">Text</a>
  <a class="chip" href="https://wa.me/?text=${esc(e(msg))}" target="_blank" rel="noopener">WhatsApp</a>
  <a class="chip" href="https://twitter.com/intent/tweet?text=${esc(e(text))}&amp;url=${esc(e(url))}" target="_blank" rel="noopener">X</a>
  <a class="chip" href="https://www.facebook.com/sharer/sharer.php?u=${esc(e(url))}" target="_blank" rel="noopener">Facebook</a>
  <button type="button" class="chip" data-copy="${esc(url)}">Copy link</button>
</div>`;
  };

  // home
  app.get('/', async (c) => {
    const [top, rising, fresh, n] = await Promise.all([list('top', 8, 0), list('rising', 4, 0), list('new', 8, 0), counts()]);
    const url = abs(c, '/');
    const text = shareText(null);
    const places = PLACES.filter((p) => n.places[p.id])
      .sort((a, b) => (n.places[b.id] ?? 0) - (n.places[a.id] ?? 0))
      .map((p) => `<a class="chip" href="${href(`/at/${p.id}`)}">${esc(p.name)} <span>${n.places[p.id]}</span></a>`)
      .join('');
    const main = `
<section class="hero">
  <img class="hero-img" src="${esc(href(top[0] ? imgPath(top[0], 'card') : '/img/shore.png'))}" width="${CARD.width}" height="${CARD.height}" alt="">
  <div class="hero-text">
    <h1>Every beach on the shore</h1>
    <p>Sandcastles, moats, harbours and terraces, built by people in <b>beech</b> and set one after another along a shore that never ends. ${
      n.beaches ? `<b>${n.beaches.toLocaleString('en')}</b> ${n.beaches === 1 ? 'beach' : 'beaches'} so far.` : ''
    }</p>
    <div class="cta">
      ${n.beaches ? `<a class="btn" href="${href('/random')}" rel="nofollow">Walk the shore</a>` : ''}
      <a class="btn ghost" href="${esc(game)}/">Build your own beach</a>
    </div>
  </div>
</section>
${
  n.beaches === 0
    ? `<section><p class="empty">Nobody has set a beach on the shore yet. <a href="${esc(game)}/">Be the first.</a></p></section>`
    : `
${top.some((b) => b.stars) ? `<section><h2>Most loved <a href="${href('/top')}">see all</a></h2>${grid(top.filter((b) => b.stars), true)}</section>` : ''}
${rising.length ? `<section><h2>Rising this week <a href="${href('/rising')}">see all</a></h2>${grid(rising)}</section>` : ''}
<section><h2>Just built <a href="${href('/new')}">see all</a></h2>${grid(fresh)}</section>
${places ? `<section><h2>By place</h2><div class="chips">${places}</div></section>` : ''}`
}
<section class="sharebox"><h2>Send the shore to someone</h2>${shareRow(url, text, 'beechshore')}</section>`;
    return html(
      c,
      layout(
        {
          title: 'beechshore: every beach on the shore',
          description: 'Sandcastles, moats and harbours people built in beech, one beach after another along an endless shore. Walk it, then build your own.',
          url,
          image: abs(c, top[0] ? imgPath(top[0], 'card') : '/img/shore.png'),
          imageAlt: 'A beach from above, sand and sea',
        },
        main,
        { share: { url, text, title: 'beechshore' } },
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
<section class="head"><h1>${esc(L.title)}</h1><p>${esc(L.blurb)}</p>
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
          { share: { url, text: `${L.title} on beechshore 🏖️`, title: L.title } },
        ),
      );
    });
  }

  // a real place
  app.get('/at/:place', async (c) => {
    const p = placeById(c.req.param('place').toLowerCase());
    if (!p) return notFound(c);
    const page = Math.min(500, Math.max(1, Number(c.req.query('page') ?? 1) | 0 || 1));
    const rows = await list('top', PAGE + 1, (page - 1) * PAGE, p.id);
    const bs = rows.slice(0, PAGE);
    const url = abs(c, `/at/${p.id}`);
    const main = `
<section class="head"><h1>${esc(p.name)}</h1><p>Beaches built at ${esc(p.name)}, ${esc(p.place)}. In the game they get the real sun, moon and tides there.</p></section>
<section>${bs.length ? grid(bs) : '<p class="empty">Nobody has built here yet.</p>'}
<nav class="pager">${page > 1 ? `<a class="btn ghost" href="${href(`/at/${p.id}${page > 2 ? `?page=${page - 1}` : ''}`)}">← back</a>` : ''}${
      rows.length > PAGE ? `<a class="btn ghost" href="${href(`/at/${p.id}?page=${page + 1}`)}">more →</a>` : ''
    }</nav></section>`;
    return html(
      c,
      layout(
        { title: `${p.name}, ${p.place} · beechshore`, description: `Beaches people built at ${p.name} in beech.`, url, image: abs(c, bs[0] ? imgPath(bs[0], 'card') : '/img/shore.png'), imageAlt: p.name },
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

  app.get('/robots.txt', (c) => c.text(`User-agent: *\nAllow: /\nDisallow: ${base}/random\nSitemap: ${abs(c, '/sitemap.xml')}\n`));

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
    const where = placeLabel(b.location);
    const url = abs(c, `/${b.code}`);
    const text = shareText(b);
    const n = now();
    const step = (s: Step | undefined, dir: 'left' | 'right') =>
      s
        ? `<a class="walk ${dir}" href="${href(`/${s.code}`)}" rel="${dir === 'left' ? 'prev' : 'next'}" data-key="${dir === 'left' ? 'ArrowLeft' : 'ArrowRight'}" aria-label="Walk ${dir} to ${esc(beachTitle(s))}">${dir === 'left' ? '‹' : '›'}</a>`
        : '';
    const strip = (s: Step) =>
      `<li><a href="${href(`/${s.code}`)}"><img src="${esc(href(`/img/${s.code}/thumb.png?v=${s.updatedAt ?? 0}`))}" width="${THUMB.width}" height="${THUMB.height}" loading="lazy" alt=""><span>${esc(beachTitle(s))}</span></a></li>`;
    // left is on the left, the way you'd see it facing the sea
    const shore = [...left].reverse().map(strip).join('') + `<li class="here"><span class="dot"></span><span>${esc(title)}</span></li>` + right.map(strip).join('');
    const neighbors = [left[0]?.linked ? left[0] : null, right[0]?.linked ? right[0] : null].filter(Boolean) as Step[];
    const main = `
<article class="beach">
  <div class="pic">
    <img src="${esc(href(imgPath(b, 'card')))}" width="${CARD.width}" height="${CARD.height}" alt="${esc(`${title}, seen from above: the sand, the sea, and what's on it`)}">
    ${step(left[0], 'left')}${step(right[0], 'right')}
  </div>
  <div class="about">
    <div>
      <h1>${esc(title)}</h1>
      <p class="by">${b.beachName ? `by ${esc(ownerName(b))}` : ''}${b.beachName && where ? ' · ' : ''}${
        where ? `<a href="${href(`/at/${b.location}`)}">${esc(where)}</a>` : ''
      }</p>
      <p class="m">${b.stars ? `<span class="stars">★ ${b.stars} ${b.stars === 1 ? 'star' : 'stars'}</span>` : ''}${
        b.recent ? `<span class="up">▲ ${b.recent} this week</span>` : ''
      }<span class="when">changed ${esc(ago(b.updatedAt, n))}</span></p>
      ${neighbors.length ? `<p class="nb">Neighbors: ${neighbors.map((s) => `<a href="${href(`/${s.code}`)}">${esc(beachTitle(s))}</a>`).join(' and ')}</p>` : ''}
    </div>
    <div class="actions">
      <a class="btn big" href="${esc(visitUrl(b.code))}">Visit in beech →</a>
      <p class="hint">Walk onto it, sit in a deckchair, star it. The waves are live.</p>
    </div>
  </div>
  ${shareRow(url, text, title)}
</article>
${left.length || right.length ? `<section><h2>Along the shore</h2><ul class="strip">${shore}</ul><p class="hint keys">Use ← and → to walk.</p></section>` : ''}
<section class="make">
  <h2>Make one of your own</h2>
  <p>Dig a moat, build a castle, put out a deckchair, and set your beach on the shore next to everyone else’s. Free, in your browser or on your phone.</p>
  <a class="btn" href="${esc(game)}/">Start building</a>
</section>`;
    return html(
      c,
      layout(
        {
          title: `${title} on beechshore`,
          description: `${b.beachName ? `${ownerName(b)}’s beach` : 'A beach'}${where ? ` at ${where}` : ''}, built in beech. ${b.stars ? `★ ${b.stars}. ` : ''}Walk the shore, then build your own.`,
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
        { title: 'Washed away · beechshore', description: 'That beach is not on the shore.', url: abs(c, '/'), image: abs(c, '/img/shore.png'), imageAlt: 'An untouched beach' },
        `<section class="head"><h1>Washed away</h1><p>No beach on the shore has that code. Its owner may have taken it off the shore, or the code changed.</p>
<div class="cta"><a class="btn" href="${href('/')}">See the shore</a><a class="btn ghost" href="${esc(game)}/">Build a beach</a></div></section>`,
      ),
      404,
    );
  app.notFound(notFound);
  app.onError((err, c) => {
    logEvent('shore_error', { message: err.message, path: c.req.path }, 'ERROR');
    return c.text('something went wrong', 500);
  });
  return app;
}

// ------------------------------------------------------------------ look

const WAVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#f6e3c3"/><path d="M1.5 13c4-3 7-3 10 0s6 3 9 0 6-3 10 0V9A15 15 0 0 0 1.5 13z" fill="#2fa4bb"/><path d="M1 13.2c4-3 7-3 10.3 0s6 3 9 0 6.2-3 10.7 0" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const FAVICON = `data:image/svg+xml,${encodeURIComponent(WAVE_SVG)}`;
const SHARE_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const CSS = `
:root{--sand:#f6e3c3;--sand2:#fbeedd;--ink:#3c4a57;--ink2:#6b7a88;--sea:#2fa4bb;--sea2:#8ff0de;--card:#fffaf2;--line:#ead8bd;--accent:#e2574c;--gold:#e5a91a;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--sand:#2b2721;--sand2:#1f1c18;--ink:#efe6d8;--ink2:#b4a893;--card:#2a2621;--line:#3d362d;--sea:#58c3d6}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--sand2);color:var(--ink);font:16px/1.5 ui-rounded,"SF Pro Rounded",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--sea)}
img{max-width:100%;height:auto;display:block}
.top{display:flex;align-items:center;gap:16px;padding:12px max(16px,env(safe-area-inset-left));position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--sand2) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--ink);font-size:20px;letter-spacing:-.01em}
.brand b{color:var(--sea);font-weight:700}
.top nav{display:flex;gap:14px;flex:1;overflow-x:auto;scrollbar-width:none}
.top nav a{color:var(--ink2);text-decoration:none;white-space:nowrap;font-size:15px}
.top nav a:hover{color:var(--ink)}
main{max-width:1180px;margin:0 auto;padding:0 16px 32px}
section{margin:28px 0}
h1{font-size:clamp(28px,5vw,44px);line-height:1.1;margin:0 0 8px;letter-spacing:-.02em}
h2{font-size:20px;margin:0 0 12px;display:flex;align-items:baseline;gap:12px}
h2 a{font-size:14px;font-weight:400}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--sea);color:#fff;border:0;border-radius:999px;padding:11px 20px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer;white-space:nowrap}
.btn:hover{filter:brightness(1.07)}
.btn.ghost{background:transparent;color:var(--sea);box-shadow:inset 0 0 0 2px var(--sea)}
.btn.small{padding:7px 14px;font-size:14px}
.btn.big{padding:14px 26px;font-size:18px}
.chip{display:inline-flex;align-items:center;gap:6px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:7px 14px;font:inherit;font-size:14px;text-decoration:none;cursor:pointer}
.chip span{color:var(--ink2)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.linkish{background:none;border:0;padding:0;font:inherit;color:var(--sea);text-decoration:underline;cursor:pointer}
.hero{position:relative;border-radius:24px;overflow:hidden;margin-top:20px;background:var(--sea)}
.hero-img{width:100%;aspect-ratio:1200/630;object-fit:cover}
.hero-text{position:absolute;inset:auto 0 0 0;padding:28px;background:linear-gradient(transparent,rgba(20,40,50,.72));color:#fff}
.hero-text p{max-width:640px;margin:0 0 14px;font-size:17px}
.hero .btn.ghost{color:#fff;box-shadow:inset 0 0 0 2px #fff}
.cta{display:flex;flex-wrap:wrap;gap:10px}
@media (max-width:640px){.hero-img{aspect-ratio:4/3}.hero-text{position:static;background:var(--card);color:var(--ink)}.hero .btn.ghost{color:var(--sea);box-shadow:inset 0 0 0 2px var(--sea)}.hero{background:var(--card)}}
.grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.card a{display:block;background:var(--card);border-radius:16px;overflow:hidden;text-decoration:none;color:var(--ink);border:1px solid var(--line);transition:transform .15s}
.card a:hover{transform:translateY(-2px)}
.card img{aspect-ratio:480/300;width:100%;object-fit:cover;background:var(--sand)}
.info{display:flex;flex-direction:column;padding:10px 14px 12px;gap:2px}
.info .t{font-weight:650;display:flex;align-items:center;gap:8px}
.info .s{color:var(--ink2);font-size:14px}
.m{display:flex;flex-wrap:wrap;gap:10px;font-size:13px;color:var(--ink2)}
.stars{color:var(--gold);font-weight:600}
.up{color:#3aa66a}
.rank{display:inline-grid;place-items:center;min-width:24px;height:24px;border-radius:999px;background:var(--sand);font-size:13px}
.rank.r1{background:#f3c74d;color:#5a4300}.rank.r2{background:#d4d9de;color:#3b4550}.rank.r3{background:#e2a777;color:#5a3110}
.head{margin-top:28px}
.head p{color:var(--ink2);max-width:680px}
.tabs{display:flex;gap:8px;flex-wrap:wrap}
.tabs a{padding:6px 14px;border-radius:999px;text-decoration:none;color:var(--ink2);border:1px solid var(--line)}
.tabs a[aria-current]{background:var(--ink);color:var(--sand2);border-color:var(--ink)}
.pager{display:flex;gap:10px;justify-content:center;margin-top:20px}
.empty{color:var(--ink2)}
.beach{margin-top:20px}
.pic{position:relative;border-radius:22px;overflow:hidden;background:var(--sea)}
.pic img{width:100%;aspect-ratio:1200/630}
.walk{position:absolute;top:50%;transform:translateY(-50%);width:52px;height:52px;border-radius:999px;display:grid;place-items:center;background:rgba(255,255,255,.85);color:#3c4a57;font-size:34px;line-height:1;text-decoration:none;box-shadow:0 2px 10px rgba(0,0,0,.15)}
.walk.left{left:12px}.walk.right{right:12px}
.about{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px 32px;margin:18px 0 6px}
.about .by{margin:0;color:var(--ink2)}
.about .m{margin:6px 0 0;font-size:15px}
.about .nb{margin:8px 0 0;color:var(--ink2);font-size:15px}
.actions{display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.hint{color:var(--ink2);font-size:14px;margin:4px 0 0}
.share{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px}
.strip{list-style:none;margin:0;padding:4px 0 8px;display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory}
.strip li{flex:0 0 200px;scroll-snap-align:center}
.strip a{display:block;text-decoration:none;color:var(--ink);font-size:14px}
.strip img{border-radius:12px;aspect-ratio:480/300;object-fit:cover}
.strip span{display:block;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.strip .here{display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px dashed var(--sea);border-radius:12px;padding:12px;color:var(--sea);font-weight:600;text-align:center;flex-basis:140px}
.strip .here .dot{width:10px;height:10px;border-radius:50%;background:var(--sea)}
.make,.sharebox{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:22px}
.make p{max-width:620px;color:var(--ink2)}
footer{max-width:1180px;margin:0 auto;padding:20px 16px 40px;color:var(--ink2);font-size:14px;border-top:1px solid var(--line)}
@media (hover:none){.hint.keys{display:none}}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);background:var(--ink);color:var(--sand2);padding:10px 18px;border-radius:999px;opacity:0;transition:.2s;pointer-events:none;font-size:15px}
.toast.on{opacity:1;transform:translate(-50%,0)}
@media (max-width:640px){.top nav{display:none}.top{justify-content:space-between}.walk{width:42px;height:42px;font-size:28px}.about .actions{width:100%}.about .btn.big{width:100%;justify-content:center}}
`;

// share (the phone's share sheet where there is one, else copy), copy, and arrow keys to walk
const SCRIPT = `(()=>{const t=document.querySelector('.toast');let h;const say=m=>{t.textContent=m;t.classList.add('on');clearTimeout(h);h=setTimeout(()=>t.classList.remove('on'),2200)};
const copy=async u=>{try{await navigator.clipboard.writeText(u);say('Link copied')}catch{window.prompt('Copy this link',u)}};
document.addEventListener('click',async e=>{const b=e.target.closest('[data-share],[data-copy]');if(!b)return;
if(b.dataset.copy){copy(b.dataset.copy);return}
const d={title:b.dataset.title,text:b.dataset.text,url:b.dataset.url};
if(navigator.share){try{await navigator.share(d);return}catch(x){if(x&&x.name==='AbortError')return}}
copy(d.url)});
const st=document.querySelector('.strip'),hr=st&&st.querySelector('.here');if(hr)st.scrollLeft=hr.offsetLeft-st.offsetLeft-(st.clientWidth-hr.clientWidth)/2;
document.addEventListener('keydown',e=>{if(e.metaKey||e.ctrlKey||e.altKey||/input|textarea/i.test(e.target.tagName))return;const a=document.querySelector('[data-key="'+e.key+'"]');if(a)location.href=a.href})})();`;
