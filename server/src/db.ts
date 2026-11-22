import pg from 'pg';

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
  close(): Promise<void>;
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
  return {
    async query(sql, params = []) {
      return (await pool.query(sql, params)).rows;
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
    close: () => pool.end(),
  };
}

/** PGlite (in-memory, or persisted to `dataDir`). Only for development and tests. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(dataDir);
  await db.waitReady;
  return {
    async query(sql, params = []) {
      return (await db.query(sql, params)).rows as never[];
    },
    async exec(sql) {
      await db.exec(sql);
    },
    withLock: (_key, fn) => fn(), // single connection: nothing to race with
    close: () => db.close(),
  };
}

/** bytea comes back as a Buffer (pg) or Uint8Array (PGlite) */
export function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw new Error('expected binary data');
}
