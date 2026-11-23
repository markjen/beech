// The root app: the game API under /api plus the built web app, the user
// guide, the beech.games landing page (landingSite.ts) on its own hosts, and
// the beechshore.com public shore site (shoreSite.ts) on its own hosts.
//
// Extracted from server.ts (which still owns the process: opening the
// database, migrating, listening) so the routing can be tested without
// starting a server — importing server.ts opens the database and serves.

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import fs from 'node:fs';
import path from 'node:path';

import { guideHtml, releaseNotesHtml } from './guide.js';
import { httpLogger } from './observability.js';
import { landingHtml } from './landingSite.js';
import { createSharePageHandler } from './shareMeta.js';
import { createShoreSite } from './shoreSite.js';
import type { Db } from './db.js';

export interface ShoreOptions {
  /** hosts that are the shore site itself (beechshore.com, www.beechshore.com) */
  hosts: string[];
  /** the shore's public origin, https://beechshore.com */
  url: string;
  /** the game, for the shore's "visit" and "build" links */
  gameUrl: string;
}

export const DEFAULT_SHORE: ShoreOptions = {
  hosts: ['beechshore.com', 'www.beechshore.com'],
  url: 'https://beechshore.com',
  gameUrl: 'https://play.beech.games',
};

export interface LandingOptions {
  /** hosts that are the landing site itself (beech.games, www.beech.games) */
  hosts: string[];
  /** the landing page's public origin, https://beech.games */
  url: string;
  /** the game, for the landing page's "Play" links */
  gameUrl: string;
}

export const DEFAULT_LANDING: LandingOptions = {
  hosts: ['beech.games', 'www.beech.games'],
  url: 'https://beech.games',
  gameUrl: 'https://play.beech.games',
};

/** Both sites' options; each defaults to its DEFAULT_* when omitted. */
export interface RootAppOptions {
  shore?: ShoreOptions;
  landing?: LandingOptions;
}

/**
 * Build the root app. `api` is the game API (createApp), mounted under /api.
 * The public shore site (shoreSite.ts) answers every path on its own hosts,
 * and lives under /shore on every other host. The landing page
 * (landingSite.ts) answers every path on its own hosts, and lives under
 * /landing on every other host. The two host sets do not overlap, so each
 * middleware passes through for hosts it does not own.
 */
export function createRootApp(db: Db, api: Hono<any, any, any>, publicDir: string, opts: RootAppOptions = {}): Hono {
  const shore = opts.shore ?? DEFAULT_SHORE;
  const landing = opts.landing ?? DEFAULT_LANDING;
  const root = new Hono();
  // One structured log line per request, including static files and /healthz.
  root.use('*', httpLogger);
  root.get('/healthz', (c) => c.text('ok'));
  const shoreHosts = new Set(shore.hosts.map((h) => h.toLowerCase()));
  const apex = new URL(shore.url).host.toLowerCase();
  const shoreHere = createShoreSite(db, { base: '', gameUrl: shore.gameUrl, publicUrl: shore.url });
  const shoreUnder = createShoreSite(db, { base: '/shore', gameUrl: shore.gameUrl });
  root.use('*', async (c, next) => {
    const host = (c.req.header('host') ?? '').toLowerCase().replace(/:\d+$/, '');
    if (!shoreHosts.has(host)) return next();
    // www (and any other alias) → the one canonical host, so shared links agree
    if (host !== apex.replace(/:\d+$/, '')) {
      const u = new URL(c.req.url);
      return c.redirect(`${shore.url.replace(/\/$/, '')}${u.pathname}${u.search}`, 301);
    }
    return shoreHere.fetch(c.req.raw);
  });
  // the shore under /shore on the game's own host (and in development)
  root.use('*', async (c, next) => {
    const p = c.req.path;
    if (p === '/shore/') return c.redirect('/shore', 301);
    if (p === '/shore' || p.startsWith('/shore/')) return shoreUnder.fetch(c.req.raw);
    return next();
  });
  const landingHosts = new Set(landing.hosts.map((h) => h.toLowerCase()));
  const landingApex = new URL(landing.url).host.toLowerCase();
  const landingPage = (c: Context) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(landingHtml(landing.gameUrl));
  };
  root.use('*', async (c, next) => {
    const host = (c.req.header('host') ?? '').toLowerCase().replace(/:\d+$/, '');
    if (!landingHosts.has(host)) return next();
    // www (and any other alias) → the one canonical host, so shared links agree
    if (host !== landingApex) {
      const u = new URL(c.req.url);
      return c.redirect(`${landing.url.replace(/\/$/, '')}${u.pathname}${u.search}`, 301);
    }
    // the guide, and the landing page's own icon, still answer on this host;
    // everything else here is the landing page (including /api — the game
    // API is not served on the landing hosts)
    const p = c.req.path;
    if (
      p === '/guide' || p === '/guide/' || p.startsWith('/guide/') ||
      p === '/help' || p === '/releases' ||
      p.startsWith('/icons/') || p === '/favicon-32.png' || p === '/apple-touch-icon.png'
    ) return next();
    return landingPage(c);
  });
  // the landing page under /landing on the game's own host (and in
  // development) — this works before the domain does
  root.get('/landing', landingPage);
  root.get('/landing/', (c) => c.redirect('/landing', 301));
  root.route('/api', api);
  // the user guide, help and release notes (the game itself shows no notes);
  // rendered per request so this week's vending set and the odds are current
  const guide = (html: () => string) => (c: Context) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(html());
  };
  root.get('/guide', guide(() => guideHtml(Date.now())));
  root.get('/guide/', guide(() => guideHtml(Date.now())));
  root.get('/guide/releases', guide(releaseNotesHtml));
  root.get('/help', (c) => c.redirect('/guide', 301));
  root.get('/releases', (c) => c.redirect('/guide/releases', 301));
  // a shared beach link (?visit=CODE) gets Open Graph tags for that beach, so
  // the link shows a preview where it's pasted; everything else passes through
  const indexHtml = path.join(publicDir, 'index.html');
  root.get('/', createSharePageHandler(db, indexHtml));
  root.use(
    '/*',
    serveStatic({
      root: path.relative(process.cwd(), publicDir) || '.',
      onFound: (p, c) => {
        // hashed bundles never change; the page and service worker must revalidate
        c.header('Cache-Control', p.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );
  // single-page app: anything else gets the page — except unknown /api
  // paths, which are JSON 404s. The API sub-app's own notFound never fires
  // for GETs, because this catch-all matches first and serves index.html.
  root.get('*', (c: Context) => {
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
    if (!fs.existsSync(indexHtml)) return c.text('web app not built (npm run build in the repo root)', 404);
    c.header('Cache-Control', 'no-cache');
    return c.html(fs.readFileSync(indexHtml, 'utf8'));
  });
  // non-GETs never reach the catch-all above: unknown /api paths get the
  // same JSON 404 (the sub-app's notFound doesn't fire once mounted here),
  // everything else keeps Hono's default plain-text 404.
  root.notFound((c) => {
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
    return c.text('404 Not Found', 404);
  });
  return root;
}
