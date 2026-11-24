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
  // 9: gifts. Who gave what to whom (for the rate limit and for disputes);
  // the transfer itself lives in the inventory rows (source 'gift').
  `
  CREATE TABLE gifts (
    id BIGSERIAL PRIMARY KEY,
    from_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    to_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX gifts_from ON gifts (from_id, created_at);
  `,
  // 10: the leaderboard (BACKEND.md, "Leaderboard"). star_first keeps when
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
  // 11: digging finds (docs/DIGGING_FINDS.md). One row per person: how many
  // buried items they dug up today (UTC), and when they last rolled, so a
  // fast client can't spin the roll. The finds themselves are logged in
  // `pulls` (pool 'dig') and granted in `inventory` (source 'pull').
  `
  CREATE TABLE dig_state (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    day TEXT NOT NULL,                 -- UTC date of the last roll, YYYY-MM-DD
    finds INTEGER NOT NULL DEFAULT 0 CHECK (finds >= 0),
    last_roll_at BIGINT NOT NULL DEFAULT 0
  );
  `,

  // 12: gift cards, promo codes and account credit (docs/GIFT_CARDS_PROMOS.md).
  // A gift card is prepaid credit: redeeming it moves its whole value into
  // the player's account credit, which buys products server-side. The card
  // code is a bearer credential, so only its HMAC (under GIFT_CODE_PEPPER)
  // is stored — never the code itself. Promo codes are public marketing
  // codes, so they are stored as typed (normalized upper case).
  `
  ALTER TABLE users ADD COLUMN email TEXT;
  ALTER TABLE users ADD COLUMN credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0);

  CREATE TABLE gift_cards (
    id UUID PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,      -- HMAC-SHA-256 of the code; the code itself is never stored
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'disabled')),
    issued_by UUID REFERENCES users (id) ON DELETE SET NULL,  -- NULL: issued by the CLI token
    issued_at BIGINT NOT NULL,
    expires_at BIGINT,                   -- NULL: never expires
    redeemed_by UUID REFERENCES users (id) ON DELETE SET NULL,
    redeemed_at BIGINT,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX gift_cards_status ON gift_cards (status, issued_at DESC);

  CREATE TABLE promo_codes (
    code TEXT PRIMARY KEY,               -- normalized upper case, e.g. LAUNCH20
    kind TEXT NOT NULL CHECK (kind IN ('percent', 'fixed')),
    value INTEGER NOT NULL CHECK (value > 0),  -- percent 1-100, or USD cents off
    applies_to TEXT,                     -- NULL: any product; otherwise one product id
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
    active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES users (id) ON DELETE SET NULL,  -- NULL: created by the CLI token
    created_at BIGINT NOT NULL,
    expires_at BIGINT                    -- NULL: never expires
  );

  CREATE TABLE promo_uses (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL REFERENCES promo_codes (code),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
    created_at BIGINT NOT NULL
  );
  CREATE INDEX promo_uses_code ON promo_uses (code, created_at DESC);

  -- every movement of account credit, so a balance can always be explained
  CREATE TABLE credit_ledger (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('gift_card', 'spend')),
    amount_cents INTEGER NOT NULL,       -- signed: +credit in, -credit out
    ref TEXT NOT NULL,                   -- gift card id, or product id
    created_at BIGINT NOT NULL
  );
  CREATE INDEX credit_ledger_user ON credit_ledger (user_id, created_at DESC);

  -- who did what in the admin console / CLI (never holds a code value)
  CREATE TABLE admin_audit (
    id BIGSERIAL PRIMARY KEY,
    actor TEXT NOT NULL,                 -- admin user id, or 'cli-token'
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}',
    created_at BIGINT NOT NULL
  );
  CREATE INDEX admin_audit_created ON admin_audit (created_at DESC);
  `,


  // 13: checkpoints (docs/CHECKPOINTS.md): named copies of your beaches,
  // restorable onto any of them if your bag covers the things on it. The
  // epoch goes up on each restore, so a device still showing the old sand
  // can't save it back over the restored beach.
  `
  CREATE TABLE checkpoints (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('named', 'auto')),   -- auto: "before restoring"
    source TEXT NOT NULL CHECK (source IN ('beach', 'import')),
    from_beach UUID REFERENCES beach (id) ON DELETE SET NULL,
    from_name TEXT NOT NULL DEFAULT '',
    location TEXT,
    nx INTEGER NOT NULL,
    ny INTEGER NOT NULL,
    sand BYTEA NOT NULL,                                    -- src/sim/sandCodec.ts format
    bytes INTEGER NOT NULL,
    items JSONB NOT NULL DEFAULT '{}',                      -- counted by the server
    objects INTEGER NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX checkpoints_owner ON checkpoints (owner_id, created_at DESC);
  CREATE UNIQUE INDEX checkpoints_one_auto ON checkpoints (from_beach) WHERE kind = 'auto';
  ALTER TABLE beach ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0;
  `,

  // 14: the admin console is its own app (adminServer.ts): it signs in with
  // Google itself and keeps its own sessions (an HttpOnly cookie holding a
  // random token; only its SHA-256 is stored), separate from players'
  // sessions. The email is checked against ADMIN_EMAILS on every request, so
  // taking someone off the list locks them out at once. From here on
  // admin_audit.actor is the admin's email ('cli-token' for the CLI).
  `
  CREATE TABLE admin_sessions (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  );
  CREATE INDEX admin_sessions_expires ON admin_sessions (expires_at);
  `,

  // 15: web checkout through Xsolla (docs/WEB_PAYMENTS.md). One row per
  // checkout attempt, so every web payment traces back to a player, a
  // product and a price. Fulfilment reuses purchases + inventory: a paid
  // order becomes a purchases row (store 'xsolla', transaction_id = Xsolla's
  // order id), so the UNIQUE (store, transaction_id) guard makes a retried
  // webhook grant nothing the second time, and refunds go through the same
  // refund() as the app stores.
  `
  ALTER TABLE purchases DROP CONSTRAINT purchases_store_check;
  ALTER TABLE purchases ADD CONSTRAINT purchases_store_check CHECK (store IN ('apple', 'google', 'dev', 'xsolla'));

  CREATE TABLE web_orders (
    id UUID PRIMARY KEY,                 -- ours; Xsolla's settings.external_id
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),  -- the server's USD price
    currency TEXT NOT NULL DEFAULT 'USD',
    provider TEXT NOT NULL DEFAULT 'xsolla',
    provider_order_id TEXT UNIQUE,       -- Xsolla's order id, from the token response
    sandbox BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'refunded', 'canceled')),
    created_at BIGINT NOT NULL,
    paid_at BIGINT
  );
  CREATE INDEX web_orders_user ON web_orders (user_id, created_at DESC);
  `,

  // 16: unique items: one owner in the whole game (BACKLOG "Unique items").
  // A draw claims the item here first; if someone already owns it, the draw
  // gives something else. Gifting moves the owner. found_by is the first
  // finder's name, shown on the item. Existing ones are recorded earliest
  // first (anyone who already has one keeps it).
  `
  CREATE TABLE unique_items (
    item_id TEXT PRIMARY KEY,
    owner_id UUID REFERENCES users (id) ON DELETE SET NULL,  -- NULL: findable again
    found_by TEXT NOT NULL,
    found_at BIGINT NOT NULL
  );
  INSERT INTO unique_items (item_id, owner_id, found_by, found_at)
  SELECT DISTINCT ON (i.item_id) i.item_id, i.user_id, u.name, i.acquired_at
    FROM inventory i JOIN users u ON u.id = i.user_id
   WHERE i.item_id IN ('nautilus') AND i.quantity > 0
   ORDER BY i.item_id, i.acquired_at;
  `,

  // 17: partial indexes for beechshore.com lists, place pages, counts and
  // sitemap at scale (docs/SHORE_SITE.md, "Not done yet").
  `
  CREATE INDEX IF NOT EXISTS beach_public_updated
    ON beach (updated_at DESC, id)
    WHERE on_shore AND sand IS NOT NULL;
  CREATE INDEX IF NOT EXISTS beach_public_location
    ON beach (location, updated_at DESC, id)
    WHERE on_shore AND sand IS NOT NULL;
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
