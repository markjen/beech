import type { Db } from './db.js';

/**
 * Schema migrations, applied in order at startup (under an advisory lock, so
 * several Cloud Run instances starting together don't race). Append new
 * entries; never edit an applied one.
 */
const MIGRATIONS: string[] = [
  // 1: accounts, sessions, saved beaches, neighbors
  `
  CREATE TABLE users (
    id UUID PRIMARY KEY,
    provider TEXT NOT NULL,            -- 'google' | 'apple' ('dev' only in local dev)
    provider_sub TEXT NOT NULL,        -- the provider's stable user id
    name TEXT NOT NULL DEFAULT '',     -- first name, for neighbors to see
    neighbor_code TEXT NOT NULL UNIQUE,
    created_at BIGINT NOT NULL,
    UNIQUE (provider, provider_sub)
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,       -- SHA-256 of the bearer token
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions (user_id);

  CREATE TABLE beaches (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    location TEXT NOT NULL,            -- real beach id (src/world/locations.ts)
    nx INTEGER NOT NULL,
    ny INTEGER NOT NULL,
    version INTEGER NOT NULL,
    updated_at BIGINT NOT NULL,
    sand BYTEA NOT NULL                -- src/sim/sandCodec.ts format
  );

  -- the beaches on either side of yours
  CREATE TABLE neighbors (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    side TEXT NOT NULL CHECK (side IN ('left', 'right')),
    neighbor_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, side),
    CHECK (user_id <> neighbor_id)
  );
  CREATE INDEX neighbors_of ON neighbors (neighbor_id);
  `,
];

export async function migrate(db: Db): Promise<number> {
  return db.withLock(7351, async () => {
    await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)`);
    const rows = await db.query<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
    const current = Number(rows[0]?.v ?? 0);
    for (let i = current; i < MIGRATIONS.length; i++) {
      await db.exec(`BEGIN; ${MIGRATIONS[i]}; INSERT INTO schema_migrations (version, applied_at) VALUES (${i + 1}, ${Date.now()}); COMMIT;`);
    }
    return MIGRATIONS.length;
  });
}
