// Entry point for the admin console: its own process and, in production, its
// own Cloud Run service (`beech-admin`), separate from the game. It shares
// the game's database. Nothing loads without a Google sign-in by an
// allowlisted account (adminApp.ts). docs/GIFT_CARDS_PROMOS.md.
//
// Environment:
//   PORT                 default 8080
//   DATABASE_URL | DB_SOCKET, DB_USER, DB_PASSWORD, DB_NAME | PGLITE_DIR   (dbEnv.ts)
//   GOOGLE_CLIENT_ID     the web OAuth client id. Its Authorized JavaScript
//                        origins must include this service's URL.
//                        (Falls back to the first of GOOGLE_CLIENT_IDS.)
//   ADMIN_EMAILS         comma-separated verified Google emails allowed in.
//                        Empty: nobody (the console stays shut).
//   ADMIN_API_TOKEN      the CLI's credential (Secret Manager). Hashed at
//                        startup; the raw value is never kept.
//   GIFT_CODE_PEPPER     gift card code pepper (Secret Manager). Must match
//                        the game server's, or issued cards won't redeem.
//   BEECH_APP_URL        the game's URL, for "open this beach" links

import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAdminApp } from './adminApp.js';
import { hashToken } from './auth.js';
import type { Db } from './db.js';
import { openDbFromEnv } from './dbEnv.js';
import { migrate } from './migrations.js';
import { httpLogger, logEvent } from './observability.js';

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Serve the admin console on env.PORT, over an open database. */
export async function startAdminServer(db: Db, env: NodeJS.ProcessEnv): Promise<ServerType> {
  const adminEmails = list(env.ADMIN_EMAILS);
  const adminTokenHash = env.ADMIN_API_TOKEN ? await hashToken(env.ADMIN_API_TOKEN) : undefined;
  const codePepper = env.GIFT_CODE_PEPPER ?? '';
  const googleClientId = env.GOOGLE_CLIENT_ID || list(env.GOOGLE_CLIENT_IDS)[0] || null;
  if (!codePepper && env.NODE_ENV === 'production')
    logEvent('admin_config', { warning: 'GIFT_CODE_PEPPER is not set: gift card codes are hashed without a pepper' }, 'WARNING');
  logEvent('admin_config', { admin_token: !!adminTokenHash, admin_emails: adminEmails.length, code_pepper: !!codePepper, google: !!googleClientId });

  const admin = createAdminApp(db, {
    googleClientId,
    adminEmails,
    adminTokenHash,
    codePepper,
    appUrl: env.BEECH_APP_URL || undefined,
  });
  const root = new Hono();
  root.use('*', httpLogger);
  root.route('/', admin);
  const port = Number(env.PORT ?? 8080);
  return serve({ fetch: root.fetch, port, hostname: env.HOST ?? '0.0.0.0' }, () => logEvent('admin_server_start', { port }));
}

// run directly (node build/adminServer.js): open the database and serve
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const env = process.env;
  if (env.DEV_AUTH === '1') throw new Error('DEV_AUTH has no meaning for the admin console; unset it');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const db = await openDbFromEnv(env, path.join(here, '..', '.data'));
  logEvent('database_ready', { schema: await migrate(db) });
  const server = await startAdminServer(db, env);
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
      server.close();
      void db.close().finally(() => process.exit(0));
    });
  }
}
