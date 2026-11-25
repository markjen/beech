import { createPgDb, createPgliteDb, type Db } from '../src/db.js';
import { migrate } from '../src/migrations.js';

interface WorkerDbState {
  db: Db;
  truncateSql: string;
  schema: string;
}

const STATE_KEY = Symbol.for('beech.test.workerDb');
const MIG_PG_KEY = Symbol.for('beech.test.workerMigPg');

function workerId(): string {
  return (process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '1').replace(/[^a-z0-9_]/gi, '_');
}

function getGlobal<T>(key: symbol): T | undefined {
  return (globalThis as Record<symbol, unknown>)[key] as T | undefined;
}

function setGlobal<T>(key: symbol, value: T): void {
  (globalThis as Record<symbol, unknown>)[key] = value;
}

function borrowed(db: Db, onClose?: () => Promise<void>): Db {
  return {
    query: (sql, params) => db.query(sql, params),
    exec: (sql) => db.exec(sql),
    withLock: (key, fn) => db.withLock(key, fn),
    withTransaction: (fn) => db.withTransaction(fn),
    stats: db.stats ? () => db.stats!() : undefined,
    close: onClose ?? (() => Promise.resolve()),
  };
}

async function ensureWorkerDb(): Promise<WorkerDbState> {
  const existing = getGlobal<WorkerDbState>(STATE_KEY);
  if (existing) return existing;

  const url = process.env.TEST_DATABASE_URL;
  let db: Db;
  let schema: string;
  if (url) {
    schema = `test_w${workerId()}`;
    db = createPgDb({ url, schema, synchronousCommitOff: true, allowExitOnIdle: true });
    await db.exec(`DROP SCHEMA IF EXISTS "${schema}" CASCADE; CREATE SCHEMA "${schema}";`);
  } else {
    schema = 'public';
    db = await createPgliteDb();
  }
  await migrate(db);

  const tables = await db.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename <> 'schema_migrations' ORDER BY tablename`,
    [schema],
  );
  // On real Postgres, TRUNCATE creates & fsyncs new relfilenodes for every
  // table + index (~1.5s/file on Docker overlayfs). DELETE in one transaction
  // (deleting users first so ON DELETE CASCADE clears child rows, then any
  // remaining standalone tables) takes ~5ms. PGlite is in-memory so TRUNCATE
  // is instant and also resets BIGSERIAL sequences.
  let truncateSql = '';
  if (tables.length) {
    if (url) {
      const names = tables.map((t) => t.tablename);
      const rest = names.filter((n) => n !== 'users');
      // Delete users first (cascades most tables), then child-less / standalone tables
      const ordered = names.includes('users') ? ['users', ...rest] : rest;
      truncateSql = `BEGIN; ${ordered.map((n) => `DELETE FROM "${n}";`).join(' ')} COMMIT;`;
    } else {
      truncateSql = `TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`;
    }
  }

  const state: WorkerDbState = { db, truncateSql, schema };
  setGlobal(STATE_KEY, state);
  return state;
}

/**
 * Returns a clean, fully-migrated test database for the current Vitest worker.
 * Against TEST_DATABASE_URL, each worker uses its own Postgres schema so files
 * run in parallel; against PGlite, one WASM instance is booted & migrated once
 * per worker and truncated between files.
 */
export async function openTestDb(): Promise<Db> {
  const state = await ensureWorkerDb();
  if (state.truncateSql) await state.db.exec(state.truncateSql);
  return borrowed(state.db);
}

/**
 * Returns an empty (unmigrated) schema for migration upgrade tests, reusing
 * the worker's underlying Postgres or PGlite instance instead of booting a new
 * WASM PGlite per test.
 */
export async function openEmptyTestDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL;
  const migSchema = `test_mig_${workerId()}`;
  if (url) {
    let pgDb = getGlobal<Db>(MIG_PG_KEY);
    if (!pgDb) {
      pgDb = createPgDb({ url, schema: migSchema, synchronousCommitOff: true, allowExitOnIdle: true });
      setGlobal(MIG_PG_KEY, pgDb);
    }
    await pgDb.exec(`DROP SCHEMA IF EXISTS "${migSchema}" CASCADE; CREATE SCHEMA "${migSchema}";`);
    return borrowed(pgDb);
  }
  // PGlite: reuse the worker's single WASM instance on a scratch schema.
  const state = await ensureWorkerDb();
  await state.db.exec(`DROP SCHEMA IF EXISTS "${migSchema}" CASCADE; CREATE SCHEMA "${migSchema}"; SET search_path TO "${migSchema}";`);
  return borrowed(state.db, async () => {
    await state.db.exec(`SET search_path TO "${state.schema}"; DROP SCHEMA IF EXISTS "${migSchema}" CASCADE;`);
  });
}
