import pg from 'pg';

import { createDbStats, logEvent, type DbStats, type DbStatsSnapshot } from './observability.js';

/**
 * The little database surface the app needs. Production uses Postgres (Cloud
 * SQL) through `pg`; local development and tests use PGlite, a real Postgres
 * compiled to WebAssembly, so no database server is needed to work on this.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** run several statements (migrations) */
  exec(sql: string): Promise<void>;
  /** run fn holding a session-level advisory lock (one migrator at a time) */
  withLock<T>(key: number, fn: () => Promise<T>): Promise<T>;
  /** run fn inside one transaction (COMMIT on success, ROLLBACK on error).
      fn receives a Db bound to that transaction; a nested call joins the
      same transaction instead of opening another. */
  withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** query counters + latency percentiles (null pool fields for PGlite) */
  stats?: () => DbStatsSnapshot;
}

export interface PgConfig {
  /** postgres://user:pass@host:5432/db */
  url?: string;
  /** Cloud SQL unix socket directory, e.g. /cloudsql/project:region:instance */
  socket?: string;
  user?: string;
  password?: string;
  database?: string;
}

export function createPgDb(cfg: PgConfig): Db {
  const pool = new pg.Pool(
    cfg.url
      ? { connectionString: cfg.url, max: 5 }
      : { host: cfg.socket, user: cfg.user, password: cfg.password, database: cfg.database, max: 5 },
  );
  const stats = createDbStats(() => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }));
  return {
    async query(sql, params = []) {
      // Timed for the db_summary log and the slow-query / error lines.
      // The SQL text and params are never logged: they can hold user data.
      const start = performance.now();
      try {
        const rows = (await pool.query(sql, params)).rows;
        stats.record(performance.now() - start, true);
        return rows;
      } catch (e) {
        const ms = performance.now() - start;
        stats.record(ms, false);
        logEvent('db_error', { duration_ms: Math.round(ms), code: String((e as { code?: unknown })?.code ?? 'unknown') }, 'ERROR');
        throw e;
      }
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async withLock(key, fn) {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [key]);
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => {});
        client.release();
      }
    },
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: Db = {
          query: async (sql, params = []) => {
            // Same timed wrapper as the pool query above, bound to this
            // transaction's client instead of the pool.
            const start = performance.now();
            try {
              const rows = (await client.query(sql, params)).rows;
              stats.record(performance.now() - start, true);
              return rows;
            } catch (e) {
              const ms = performance.now() - start;
              stats.record(ms, false);
              logEvent('db_error', { duration_ms: Math.round(ms), code: String((e as { code?: unknown })?.code ?? 'unknown') }, 'ERROR');
              throw e;
            }
          },
          exec: async (sql) => {
            await client.query(sql);
          },
          withLock: async (key, f) => {
            await client.query('SELECT pg_advisory_lock($1)', [key]);
            try {
              return await f();
            } finally {
              await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => {});
            }
          },
          withTransaction: (f) => f(tx),
          close: () => Promise.resolve(),
          stats: () => stats.snapshot(),
        };
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
    stats: () => stats.snapshot(),
  };
}

/** PGlite (in-memory, or persisted to `dataDir`). Only for development and tests. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(dataDir);
  await db.waitReady;
  const stats: DbStats = createDbStats();
  const timedQuery = (conn: Pick<typeof db, 'query'>): Db['query'] => async <T>(sql: string, params: unknown[] = []) => {
    const start = performance.now();
    try {
      const rows = (await conn.query<T>(sql, params)).rows;
      stats.record(performance.now() - start, true);
      return rows;
    } catch (e) {
      const ms = performance.now() - start;
      stats.record(ms, false);
      logEvent('db_error', { duration_ms: Math.round(ms), code: String((e as { code?: unknown })?.code ?? 'unknown') }, 'ERROR');
      throw e;
    }
  };
  const pgliteDb: Db = {
    query: timedQuery(db),
    async exec(sql) {
      await db.exec(sql);
    },
    withLock: (_key, fn) => fn(), // single connection: nothing to race with
    async withTransaction(fn) {
      // PGlite's transaction owns the connection until commit or rollback.
      return db.transaction((connection) => {
        const tx: Db = {
          query: timedQuery(connection),
          exec: async (sql) => { await connection.exec(sql); },
          withLock: (_key, f) => f(),
          withTransaction: (f) => f(tx),
          close: () => Promise.resolve(),
          stats: pgliteDb.stats,
        };
        return fn(tx);
      });
    },
    close: () => db.close(),
    stats: () => stats.snapshot(),
  };
  return pgliteDb;
}

/** bytea comes back as a Buffer (pg) or Uint8Array (PGlite) */
export function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw new Error('expected binary data');
}
