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
  // 2: inventory. Free items (rocks, driftwood) need no rows; this holds what
  // a person owns of everything else: bought, won from a pull, or given at an
  // event. Rows are only ever written by the server (purchases, pulls).
  `
  CREATE TABLE inventory (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,             -- src/world/items.ts
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    source TEXT NOT NULL CHECK (source IN ('shop', 'event', 'pull', 'gift')),
    acquired_at BIGINT NOT NULL,
    expires_at BIGINT                  -- NULL: yours for good
  );
  CREATE INDEX inventory_user ON inventory (user_id);
  `,
  // 3: pulls (claw machine / mystery boxes). One row per draw; the primary
  // key makes "one free pull per day" hold even with two requests at once.
  `
  CREATE TABLE pulls (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    pool TEXT NOT NULL,
    day TEXT NOT NULL,                 -- UTC date, YYYY-MM-DD
    item_id TEXT NOT NULL,
    rarity TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, pool, day)
  );
  `,
  // 4: favorite beaches (anyone's, found by code or down the shore)
  `
  CREATE TABLE favorites (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    fav_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, fav_id),
    CHECK (user_id <> fav_id)
  );
  `,
  // 5: mutual neighbors on one global beachfront. A link is two rows (my
  // left is you, your right is me); it's made only when the other person
  // accepts a request. Old one-way picks become pending requests.
  `
  CREATE TABLE neighbor_requests (
    from_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    to_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    side TEXT NOT NULL CHECK (side IN ('left', 'right')), -- where to_id would go on from_id's beach
    created_at BIGINT NOT NULL,
    PRIMARY KEY (from_id, side),
    CHECK (from_id <> to_id)
  );
  CREATE INDEX neighbor_requests_to ON neighbor_requests (to_id);
  INSERT INTO neighbor_requests (from_id, to_id, side, created_at)
    SELECT n.user_id, n.neighbor_id, n.side, n.created_at FROM neighbors n
     WHERE NOT EXISTS (SELECT 1 FROM neighbors m
                        WHERE m.user_id = n.neighbor_id AND m.neighbor_id = n.user_id AND m.side <> n.side);
  DELETE FROM neighbors n
   WHERE NOT EXISTS (SELECT 1 FROM neighbors m
                      WHERE m.user_id = n.neighbor_id AND m.neighbor_id = n.user_id AND m.side <> n.side);
  -- nobody is on two people's same side
  CREATE UNIQUE INDEX neighbors_once ON neighbors (neighbor_id, side);
  CREATE INDEX users_created ON users (created_at, id);
  `,
  // 6: the claw machine's wait grows with each go (5 min, doubling, up to a
  // day) instead of one go per day. pull_state holds when you're free next;
  // pulls becomes a plain history.
  `
  CREATE TABLE pull_state (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    pool TEXT NOT NULL,
    count INTEGER NOT NULL,            -- goes so far
    next_at BIGINT NOT NULL,           -- free again at (ms)
    PRIMARY KEY (user_id, pool)
  );
  ALTER TABLE pulls DROP CONSTRAINT pulls_pkey;
  ALTER TABLE pulls ADD PRIMARY KEY (user_id, pool, created_at);
  -- people who already played: carry their count on; their next go follows the new rule
  INSERT INTO pull_state (user_id, pool, count, next_at)
    SELECT user_id, pool, COUNT(*),
           MAX(created_at) + LEAST(86400000, 300000 * POWER(2, COUNT(*) - 1))::bigint
      FROM pulls GROUP BY user_id, pool;
  `,
  // 7: more than one beach (docs/MULTI_BEACH.md). The beach becomes the unit:
  // it has the code, the sand and the neighbor links; the user owns beaches.
  // A person's home beach takes their user id as its id, so every existing
  // link, request and favorite (which held user ids) now names their home
  // beach without moving any data.
  `
  CREATE TABLE beach (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    home BOOLEAN NOT NULL DEFAULT false,
    on_shore BOOLEAN NOT NULL DEFAULT true,
    location TEXT,
    nx INTEGER,
    ny INTEGER,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at BIGINT,
    sand BYTEA,
    items JSONB NOT NULL DEFAULT '{}',  -- how many of each non-free item are on it
    created_at BIGINT NOT NULL
  );
  -- (one home per owner is kept by the app: moving home is a single UPDATE)
  CREATE INDEX beach_owner ON beach (owner_id);
  CREATE INDEX beach_created ON beach (created_at, id);
  INSERT INTO beach (id, owner_id, code, home, location, nx, ny, version, updated_at, sand, created_at)
    SELECT u.id, u.id, u.neighbor_code, true, b.location, b.nx, b.ny, COALESCE(b.version, 0), b.updated_at, b.sand, u.created_at
      FROM users u LEFT JOIN beaches b ON b.user_id = u.id;

  ALTER TABLE neighbors DROP CONSTRAINT neighbors_user_id_fkey;
  ALTER TABLE neighbors DROP CONSTRAINT neighbors_neighbor_id_fkey;
  ALTER TABLE neighbors RENAME COLUMN user_id TO beach_id;
  ALTER TABLE neighbors RENAME COLUMN neighbor_id TO neighbor_beach_id;
  ALTER TABLE neighbors ADD FOREIGN KEY (beach_id) REFERENCES beach (id) ON DELETE CASCADE;
  ALTER TABLE neighbors ADD FOREIGN KEY (neighbor_beach_id) REFERENCES beach (id) ON DELETE CASCADE;

  ALTER TABLE neighbor_requests DROP CONSTRAINT neighbor_requests_from_id_fkey;
  ALTER TABLE neighbor_requests DROP CONSTRAINT neighbor_requests_to_id_fkey;
  ALTER TABLE neighbor_requests RENAME COLUMN from_id TO from_beach;
  ALTER TABLE neighbor_requests RENAME COLUMN to_id TO to_beach;
  ALTER TABLE neighbor_requests ADD FOREIGN KEY (from_beach) REFERENCES beach (id) ON DELETE CASCADE;
  ALTER TABLE neighbor_requests ADD FOREIGN KEY (to_beach) REFERENCES beach (id) ON DELETE CASCADE;

  ALTER TABLE favorites DROP CONSTRAINT favorites_fav_id_fkey;
  ALTER TABLE favorites RENAME COLUMN fav_id TO beach_id;
  ALTER TABLE favorites ADD FOREIGN KEY (beach_id) REFERENCES beach (id) ON DELETE CASCADE;

  -- the old one-beach-per-user table stays one release, unused, then goes
  ALTER TABLE beaches RENAME TO beaches_v1;
  `,
  // 8: purchases. One row per store transaction (unique, so a receipt can't be
  // used twice); the items it granted point back at it, so a refund can take
  // them away again.
  `
  CREATE TABLE purchases (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    store TEXT NOT NULL CHECK (store IN ('apple', 'google', 'dev')),
    transaction_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    environment TEXT NOT NULL,
    purchased_at BIGINT NOT NULL,
    granted_at BIGINT NOT NULL,
    refunded_at BIGINT,
    UNIQUE (store, transaction_id)
  );
  CREATE INDEX purchases_user ON purchases (user_id);
  ALTER TABLE inventory ADD COLUMN purchase_id BIGINT REFERENCES purchases (id) ON DELETE SET NULL;
  `,
  // 9: the leaderboard (BACKEND.md, "Leaderboard"). star_first keeps when
  // each person first starred each beach, and survives un-starring, so
  // un-starring and starring again can't make a star look new on "rising".
  // Existing stars count from when they were made.
  `
  CREATE TABLE star_first (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    beach_id UUID NOT NULL REFERENCES beach (id) ON DELETE CASCADE,
    at BIGINT NOT NULL,
    PRIMARY KEY (user_id, beach_id)
  );
  INSERT INTO star_first (user_id, beach_id, at) SELECT user_id, beach_id, created_at FROM favorites;
  CREATE INDEX favorites_beach ON favorites (beach_id);
  `,
];

/** Apply migrations up to `upTo` (default: all). Tests use `upTo` to check a migration on older data. */
export async function migrate(db: Db, upTo = MIGRATIONS.length): Promise<number> {
  return db.withLock(7351, async () => {
    await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)`);
    const rows = await db.query<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
    const current = Number(rows[0]?.v ?? 0);
    for (let i = current; i < Math.min(upTo, MIGRATIONS.length); i++) {
      await db.exec(`BEGIN; ${MIGRATIONS[i]}; INSERT INTO schema_migrations (version, applied_at) VALUES (${i + 1}, ${Date.now()}); COMMIT;`);
    }
    return MIGRATIONS.length;
  });
}
