// Open the database the environment names. Shared by the game server
// (server.ts) and the admin console (adminServer.ts), which use the same
// database.
//   DATABASE_URL                               postgres://...
//   DB_SOCKET, DB_USER, DB_PASSWORD, DB_NAME   Cloud SQL unix socket (Cloud Run)
//   PGLITE_DIR                                 embedded PGlite (dev only; "memory" for in-memory)

import { createPgDb, createPgliteDb, type Db } from './db.js';
import { logEvent } from './observability.js';

export async function openDbFromEnv(env: NodeJS.ProcessEnv, defaultPgliteDir: string): Promise<Db> {
  if (env.DATABASE_URL) return createPgDb({ url: env.DATABASE_URL });
  if (env.DB_SOCKET) return createPgDb({ socket: env.DB_SOCKET, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
  if (env.NODE_ENV === 'production') throw new Error('no database configured (DATABASE_URL or DB_SOCKET)');
  const dir = env.PGLITE_DIR ?? defaultPgliteDir;
  logEvent('database', { mode: 'pglite', dir: dir === 'memory' ? 'memory' : dir });
  return createPgliteDb(dir === 'memory' ? undefined : dir);
}
