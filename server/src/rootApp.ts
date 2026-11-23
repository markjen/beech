// The root app: the game API under /api plus the built web app.
//
// Extracted from server.ts (which still owns the process: opening the
// database, migrating, listening) so the routing can be tested without
// starting a server — importing server.ts opens the database and serves.

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import fs from 'node:fs';
import path from 'node:path';

import { httpLogger } from './observability.js';
import { createSharePageHandler } from './shareMeta.js';
import type { Db } from './db.js';

/** Build the root app. `api` is the game API (createApp), mounted under /api. */
export function createRootApp(db: Db, api: Hono<any, any, any>, publicDir: string): Hono {
  const root = new Hono();
  // One structured log line per request, including static files and /healthz.
  root.use('*', httpLogger);
  root.get('/healthz', (c) => c.text('ok'));
  root.route('/api', api);
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
