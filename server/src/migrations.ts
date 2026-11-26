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

  // 18: multi-provider identities and one-time account link codes (docs/STEAM.md).
  // One beech user can hold Google, Apple, and Steam identities so beaches,
  // inventory, purchases, and neighbors sync across web, mobile, and Steam.
  `
  CREATE TABLE user_identities (
    provider TEXT NOT NULL,
    provider_sub TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (provider, provider_sub)
  );
  CREATE INDEX user_identities_user ON user_identities (user_id);
  INSERT INTO user_identities (provider, provider_sub, user_id, created_at)
    SELECT provider, provider_sub, id, created_at FROM users
    ON CONFLICT DO NOTHING;

  CREATE TABLE account_link_codes (
    code_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  );
  CREATE INDEX account_link_codes_user ON account_link_codes (user_id);
  `,

  // 19: Steam Wallet microtransactions (ISteamMicroTxn, docs/STEAM.md).
  // Steam InitTxn requires a numeric 64-bit orderid (BIGSERIAL). Fulfilment
  // reuses purchases (store = 'steam', transaction_id = trans_id) + inventory.
  `
  ALTER TABLE purchases DROP CONSTRAINT purchases_store_check;
  ALTER TABLE purchases ADD CONSTRAINT purchases_store_check CHECK (store IN ('apple', 'google', 'dev', 'xsolla', 'steam'));

  CREATE TABLE steam_orders (
    order_id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    steam_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    trans_id TEXT UNIQUE,
    sandbox BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'refunded', 'canceled')),
    created_at BIGINT NOT NULL,
    paid_at BIGINT
  );
  CREATE INDEX steam_orders_user ON steam_orders (user_id, created_at DESC);
  `,

  // 20: community item submissions (beechshore.com/submit), approval queue
  // (admin console), and 30% creator royalty credits on purchases.
  // Credits are non-cashable beech account credit (users.credit_cents),
  // logged in credit_ledger as 'creator_royalty'. creator_royalties enforces
  // idempotency per purchase_ref so retries never double-pay.
  `
  ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_kind_check;
  ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_kind_check
    CHECK (kind IN ('gift_card', 'spend', 'creator_royalty', 'creator_royalty_refund'));
  ALTER TABLE users ADD COLUMN creator_credit_debt_cents INTEGER NOT NULL DEFAULT 0 CHECK (creator_credit_debt_cents >= 0);

  CREATE TABLE item_submission_sessions (
    token_hash TEXT PRIMARY KEY,
    session_hash TEXT NOT NULL REFERENCES sessions (token_hash) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
  );
  CREATE INDEX item_submission_sessions_expiry ON item_submission_sessions (expires_at);
  CREATE INDEX item_submission_sessions_parent ON item_submission_sessions (session_hash);

  CREATE TABLE item_submissions (
    id UUID PRIMARY KEY,
    submitter_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    submitter_beach_code TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    behavior TEXT NOT NULL CHECK (behavior IN ('fixed', 'tumble', 'float', 'rock')),
    size_min DOUBLE PRECISION NOT NULL CHECK (size_min > 0),
    size_max DOUBLE PRECISION NOT NULL CHECK (size_max >= size_min),
    fixed_size BOOLEAN NOT NULL DEFAULT true,
    proposed_price_cents INTEGER NOT NULL CHECK (proposed_price_cents >= 0 AND proposed_price_cents <= 99999),
    proposed_frequency TEXT NOT NULL CHECK (proposed_frequency IN ('shop', 'limited', 'common', 'uncommon', 'rare', 'legendary', 'unique')),
    frequency_note TEXT NOT NULL DEFAULT '',
    asset_format TEXT NOT NULL CHECK (asset_format IN ('beech-json', 'glb', 'gltf', 'ts')),
    asset_filename TEXT NOT NULL,
    asset_mime TEXT NOT NULL,
    asset_bytes BYTEA NOT NULL,
    asset_size INTEGER NOT NULL CHECK (asset_size > 0),
    asset_summary JSONB NOT NULL DEFAULT '{}',
    preview_mime TEXT,
    preview_bytes BYTEA,
    terms_accepted BOOLEAN NOT NULL CHECK (terms_accepted = true),
    terms_version TEXT NOT NULL,
    terms_accepted_at BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_price_cents INTEGER CHECK (approved_price_cents IS NULL OR approved_price_cents >= 0),
    approved_frequency TEXT CHECK (approved_frequency IS NULL OR approved_frequency IN ('shop', 'limited', 'common', 'uncommon', 'rare', 'legendary', 'unique')),
    product_id TEXT UNIQUE,
    item_id TEXT,
    approved_item JSONB,
    replacement_filename TEXT,
    replacement_bytes BYTEA,
    admin_note TEXT NOT NULL DEFAULT '',
    reviewed_by TEXT,
    reviewed_at BIGINT,
    sales_count INTEGER NOT NULL DEFAULT 0 CHECK (sales_count >= 0),
    total_credit_earned_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_credit_earned_cents >= 0),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE INDEX item_submissions_status ON item_submissions (status, created_at DESC);
  CREATE INDEX item_submissions_user ON item_submissions (submitter_user_id, created_at DESC);

  CREATE TABLE creator_price_history (
    id BIGSERIAL PRIMARY KEY,
    submission_id UUID NOT NULL REFERENCES item_submissions (id) ON DELETE CASCADE,
    price_cents INTEGER CHECK (price_cents > 0),
    changed_at BIGINT NOT NULL
  );
  CREATE INDEX creator_price_history_at ON creator_price_history (submission_id, changed_at DESC, id DESC);

  ALTER TABLE web_orders ADD COLUMN creator_submission_id UUID REFERENCES item_submissions (id) ON DELETE SET NULL;
  ALTER TABLE steam_orders ADD COLUMN creator_submission_id UUID REFERENCES item_submissions (id) ON DELETE SET NULL;
  CREATE INDEX web_orders_creator_submission ON web_orders (creator_submission_id) WHERE creator_submission_id IS NOT NULL;
  CREATE INDEX steam_orders_creator_submission ON steam_orders (creator_submission_id) WHERE creator_submission_id IS NOT NULL;

  CREATE TABLE creator_royalties (
    id BIGSERIAL PRIMARY KEY,
    submission_id UUID NOT NULL REFERENCES item_submissions (id) ON DELETE CASCADE,
    creator_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    buyer_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    product_id TEXT NOT NULL,
    purchase_ref TEXT NOT NULL UNIQUE,
    store_purchase_id BIGINT UNIQUE REFERENCES purchases (id) ON DELETE SET NULL,
    sale_price_cents INTEGER NOT NULL CHECK (sale_price_cents >= 0),
    credit_cents INTEGER NOT NULL CHECK (credit_cents >= 0),
    refunded_at BIGINT,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX creator_royalties_creator ON creator_royalties (creator_user_id, created_at DESC);

  CREATE TABLE credit_shop_orders (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    product_id TEXT NOT NULL,
    promo_code TEXT,
    paid_cents INTEGER NOT NULL CHECK (paid_cents >= 0),
    discount_cents INTEGER NOT NULL CHECK (discount_cents >= 0),
    PRIMARY KEY (user_id, request_id)
  );
  `,

  // 21: resident beach pets, wild-feeding bond progress, and visitor feed log
  // (docs/ANIMALS.md, Phase 3). Kept out of the BCH3 sand blob so visitors
  // feeding a pet never race with the owner's device saving sand.
  `
  CREATE TABLE beach_pets (
    beach_id UUID PRIMARY KEY REFERENCES beach (id) ON DELETE CASCADE,
    species TEXT NOT NULL DEFAULT 'crab',
    name TEXT NOT NULL DEFAULT '',
    variant SMALLINT NOT NULL DEFAULT 0,
    source TEXT NOT NULL CHECK (source IN ('befriended', 'shop')),
    last_fed_at BIGINT NOT NULL,
    last_fed_by UUID REFERENCES users (id) ON DELETE SET NULL,
    fed_count INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE wild_feed_progress (
    beach_id UUID NOT NULL REFERENCES beach (id) ON DELETE CASCADE,
    species TEXT NOT NULL DEFAULT 'crab',
    feed_count INTEGER NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (beach_id, species)
  );

  CREATE TABLE pet_feed_log (
    id BIGSERIAL PRIMARY KEY,
    beach_id UUID NOT NULL REFERENCES beach (id) ON DELETE CASCADE,
    feeder_id UUID REFERENCES users (id) ON DELETE SET NULL,
    feeder_name TEXT NOT NULL DEFAULT '',
    fed_at BIGINT NOT NULL
  );
  CREATE INDEX pet_feed_log_beach_time ON pet_feed_log (beach_id, fed_at DESC);
  `,

  // 22: item catalog on beechshore.com (/items): one vote per person per
  // item, and signed-in comments on each item's page. Votes are a toggle
  // (the primary key makes one vote per person hold even with two requests
  // at once). Comments are plain text, newest first; only their author can
  // delete one (there is no admin delete from the game server — admin
  // identity lives in the separate admin console).
  `
  CREATE TABLE item_votes (
    item_id TEXT NOT NULL,             -- src/world/items.ts
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (item_id, user_id)
  );
  CREATE INDEX item_votes_user ON item_votes (user_id);

  CREATE TABLE item_comments (
    id UUID PRIMARY KEY,
    item_id TEXT NOT NULL,             -- src/world/items.ts
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX item_comments_item ON item_comments (item_id, created_at DESC, id DESC);
  `,

  // 23: the beach guide and invites (docs/INVITES_GUIDE.md). guide_steps:
  // which steps of the guide each person has done (once each; the gift goes
  // with the insert). referrals: who joined through whose invite link; when
  // the friend settles in, the referral takes the inviter's next rank, and
  // UNIQUE (inviter_id, reward_rank) keeps two friends settling at once from
  // taking the same rung. Rewards are inventory rows with source 'reward'.
  `
  ALTER TABLE inventory DROP CONSTRAINT inventory_source_check;
  ALTER TABLE inventory ADD CONSTRAINT inventory_source_check CHECK (source IN ('shop', 'event', 'pull', 'gift', 'reward'));

  CREATE TABLE guide_steps (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    step TEXT NOT NULL,
    done_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, step)
  );

  CREATE TABLE referrals (
    invitee_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    inviter_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code TEXT NOT NULL,                  -- the code the link carried
    created_at BIGINT NOT NULL,
    qualified_at BIGINT,                 -- when the friend settled in
    reward_rank INTEGER,                 -- 1 = the inviter's first settled friend
    reward_item TEXT,                    -- what the inviter got (NULL past the cap)
    UNIQUE (inviter_id, reward_rank),
    CHECK (invitee_id <> inviter_id)
  );
  CREATE INDEX referrals_inviter ON referrals (inviter_id, created_at);
  `,

  // 24: visitors, the inbox and notifications (docs/INBOX_NOTIFICATIONS.md).
  // notes: what visitors write (private to the beach's owner; a deleted
  // sender's notes stay, unsigned). ratings: one per visitor per beach, in
  // shells. blocks: who can't reach you. reports: notes reported to the
  // admin. inbox: one row per thing that happened to you, written in the
  // same statement as the thing itself; stars and note-less ratings fold
  // into one row per beach per day (the partial unique index).
  `
  CREATE TABLE notes (
    id BIGSERIAL PRIMARY KEY,
    from_id UUID REFERENCES users (id) ON DELETE SET NULL,
    to_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    beach_id UUID REFERENCES beach (id) ON DELETE SET NULL,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
    quick BOOLEAN NOT NULL DEFAULT false,
    hidden_at BIGINT,                   -- hidden by the admin after a report
    created_at BIGINT NOT NULL
  );
  CREATE INDEX notes_from ON notes (from_id, created_at);

  CREATE TABLE ratings (
    rater_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    beach_id UUID NOT NULL REFERENCES beach (id) ON DELETE CASCADE,
    shells INTEGER NOT NULL CHECK (shells BETWEEN 1 AND 5),
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (rater_id, beach_id)
  );
  CREATE INDEX ratings_beach ON ratings (beach_id);

  CREATE TABLE blocks (
    blocker_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
  );

  CREATE TABLE reports (
    id BIGSERIAL PRIMARY KEY,
    reporter_id UUID REFERENCES users (id) ON DELETE SET NULL,
    note_id BIGINT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    reason TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    resolved_at BIGINT,
    resolution TEXT CHECK (resolution IN ('hidden', 'dismissed')),
    resolved_by TEXT
  );
  CREATE INDEX reports_open ON reports (created_at) WHERE resolved_at IS NULL;
  CREATE UNIQUE INDEX reports_once ON reports (reporter_id, note_id);

  CREATE TABLE inbox (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('visit', 'gift', 'neighbor_request', 'neighbor_linked', 'star', 'rating', 'invite_joined', 'invite_settled', 'system')),
    actor_id UUID REFERENCES users (id) ON DELETE SET NULL,
    beach_id UUID REFERENCES beach (id) ON DELETE CASCADE,
    item_id TEXT,
    shells INTEGER,
    note_id BIGINT REFERENCES notes (id) ON DELETE SET NULL,
    count INTEGER NOT NULL DEFAULT 1,
    day TEXT,                           -- batched rows: their UTC day
    payload JSONB NOT NULL DEFAULT '{}',
    created_at BIGINT NOT NULL,
    read_at BIGINT
  );
  CREATE INDEX inbox_user ON inbox (user_id, id DESC);
  CREATE INDEX inbox_unread ON inbox (user_id) WHERE read_at IS NULL;
  CREATE UNIQUE INDEX inbox_batch ON inbox (user_id, kind, beach_id, day) WHERE day IS NOT NULL;
  `,

  // 25: one active edit session per person (docs/EDIT_SESSIONS.md). A tab,
  // device or app claims an edit token when it opens your beach for
  // editing; a new claim replaces the token, fencing every older instance,
  // so only one instance can save at a time. One row per user: the token
  // itself is the lease, and last_seen_at is when the holder last proved
  // it is still there (the heartbeat; never used to expire a token — an
  // offline instance that is still the holder may save when it reconnects).
  `
  CREATE TABLE edit_sessions (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    last_seen_at BIGINT NOT NULL
  );
  `,

  // 26: live beaches (docs/LIVE_SIM.md). The sea keeps working while nobody
  // has a beach open: the server catches it up when it's next read.
  // simulated_until: the sand is as the sea left it up to then (a save, or
  // the last catch-up). here_until: the owner's app has the beach open and
  // is simulating it itself (a heartbeat), so no catch-up meanwhile.
  // owner_seen_at: the owner last opened it ("while you were away").
  // beach_events: one row per catch-up that changed something. A 'tide'
  // checkpoint: the beach just before a long catch-up ("Before the tide"),
  // one per beach, not counted toward the limits.
  `
  ALTER TABLE beach ADD COLUMN simulated_until BIGINT;
  ALTER TABLE beach ADD COLUMN here_until BIGINT;
  ALTER TABLE beach ADD COLUMN owner_seen_at BIGINT;
  ALTER TABLE beach ADD COLUMN viewed_until BIGINT;    -- someone else is looking at it (the owner's app saves more often)

  CREATE TABLE beach_events (
    id BIGSERIAL PRIMARY KEY,
    beach_id UUID NOT NULL REFERENCES beach (id) ON DELETE CASCADE,
    from_at BIGINT NOT NULL,             -- the gap it covered (ms)
    to_at BIGINT NOT NULL,
    tides INTEGER NOT NULL,              -- high tides in the gap
    sand_moved REAL NOT NULL,            -- m3
    lost INTEGER NOT NULL DEFAULT 0,     -- owned things the sea took (back in the bag)
    brought INTEGER NOT NULL DEFAULT 0,  -- strays it washed up
    checkpoint UUID REFERENCES checkpoints (id) ON DELETE SET NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX beach_events_beach ON beach_events (beach_id, created_at);

  ALTER TABLE checkpoints DROP CONSTRAINT checkpoints_kind_check;
  ALTER TABLE checkpoints ADD CONSTRAINT checkpoints_kind_check CHECK (kind IN ('named', 'auto', 'tide'));
  CREATE UNIQUE INDEX checkpoints_one_tide ON checkpoints (from_beach) WHERE kind = 'tide';
  `,

  // 27: the beach snack that's out on the sand (one per beach). Picking it
  // back up (by hand or with the vacuum) returns it to the bag and undoes
  // what tossing it did: the wild-bond count, or the pet's feed.
  `
  CREATE TABLE beach_snacks (
    beach_id UUID PRIMARY KEY REFERENCES beach (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    inventory_id BIGINT,               -- the bag row the snack came from
    tossed_at BIGINT NOT NULL,
    wild_species TEXT,                 -- counted toward befriending (no pet)
    pet_prev_fed_at BIGINT             -- the pet's feed before this one (pet fed)
  );
  `,

  // 28: "not for sale" is its own choice on an approved creator item, so a
  // price of 0 can mean free. Until now a blank or 0 price both meant
  // "out of the shop"; those keep that meaning here.
  `
  ALTER TABLE item_submissions ADD COLUMN for_sale BOOLEAN NOT NULL DEFAULT true;
  UPDATE item_submissions SET for_sale = false WHERE approved_price_cents IS NULL OR approved_price_cents = 0;
  `,

  // 29: remember a checkpoint's source even after the beach reference is cleared.
  `
  ALTER TABLE checkpoints ADD COLUMN origin_beach_id UUID;
  UPDATE checkpoints SET origin_beach_id = from_beach WHERE from_beach IS NOT NULL;
  `,
  // 30: copying a beach on the shore onto one of your own (docs/COPY_BEACH.md).
  // A copy remembers where it came from; beach_copies counts each person
  // once per source ("copied N times") and is the key for the owner's one
  // inbox row per copier. A copy kept as a checkpoint has source 'copy'.
  `
  ALTER TABLE beach ADD COLUMN copied_from UUID REFERENCES beach (id) ON DELETE SET NULL;
  ALTER TABLE beach ADD COLUMN copied_from_code TEXT;
  ALTER TABLE beach ADD COLUMN copied_version INTEGER;
  CREATE TABLE beach_copies (
    source_beach UUID NOT NULL REFERENCES beach (id) ON DELETE CASCADE,
    copier UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    first_at BIGINT NOT NULL,
    PRIMARY KEY (source_beach, copier)
  );
  ALTER TABLE checkpoints DROP CONSTRAINT checkpoints_source_check;
  ALTER TABLE checkpoints ADD CONSTRAINT checkpoints_source_check CHECK (source IN ('beach', 'import', 'copy'));
  ALTER TABLE inbox DROP CONSTRAINT inbox_kind_check;
  ALTER TABLE inbox ADD CONSTRAINT inbox_kind_check CHECK (kind IN ('visit', 'gift', 'neighbor_request', 'neighbor_linked', 'star', 'rating', 'invite_joined', 'invite_settled', 'system', 'copied'));
  `,
  // 31: sand bucks and trade-ins (docs/SAND_BUCKS.md). The balance stays in
  // users.credit_cents at 10 cents a sand buck, always a whole number of
  // bucks: balances round up to the next buck, debt down. Each bag row can
  // carry its trade-in value per unit (unit_cents; NULL = its list value).
  // creator_credit_debt_cents is now the debt of any clawback (a refunded
  // pack whose bucks were spent), not only creator royalties.
  `
  UPDATE users SET credit_cents = ((credit_cents + 9) / 10) * 10 WHERE credit_cents % 10 <> 0;
  UPDATE users SET creator_credit_debt_cents = (creator_credit_debt_cents / 10) * 10 WHERE creator_credit_debt_cents % 10 <> 0;
  ALTER TABLE inventory ADD COLUMN unit_cents INTEGER CHECK (unit_cents IS NULL OR unit_cents >= 0);
  CREATE TABLE trade_ins (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    inventory_id BIGINT REFERENCES inventory (id) ON DELETE SET NULL,
    item_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    value_cents INTEGER NOT NULL CHECK (value_cents >= 0),
    created_at BIGINT NOT NULL
  );
  CREATE INDEX trade_ins_user ON trade_ins (user_id, created_at DESC);
  CREATE INDEX trade_ins_inventory ON trade_ins (inventory_id);
  ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_kind_check;
  ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_kind_check
    CHECK (kind IN ('gift_card', 'spend', 'creator_royalty', 'creator_royalty_refund', 'pack', 'pack_refund', 'trade_in', 'trade_in_refund'));
  `,

  // 32: the creator royalty a bag row's unit earned, carried with it when
  // it's gifted, so trading the gift in takes the right royalty back
  // (PR #118 review). NULL: the row's own ('credit:<id>', or 'store:<purchase>').
  `
  ALTER TABLE inventory ADD COLUMN royalty_ref TEXT;
  `,

  // 33: push notifications (docs/INBOX_NOTIFICATIONS.md, "Push"; the model
  // is specs/tla/Push.tla). push_subscriptions: one per device, tied to the
  // session that made it, so signing out (or the session expiring) takes it
  // with it. push_state: one row per player, the push lock (the sender holds
  // it FOR UPDATE when claiming and again when sending) and the time of
  // the last push claim. notify_prefs: which kinds may be pushed (all on
  // without a row). inbox.pushed_at: the row has been through a push claim (sent,
  // folded into one, or skipped); rows from before push are marked done.
  `
  CREATE TABLE push_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    session_hash TEXT NOT NULL REFERENCES sessions (token_hash) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
    endpoint TEXT NOT NULL UNIQUE,      -- web: the push service URL; ios/android: the device token
    p256dh TEXT,                        -- web only: the browser's key and auth secret
    auth TEXT,
    tz TEXT NOT NULL DEFAULT 'UTC',     -- the device's time zone, for quiet hours
    created_at BIGINT NOT NULL
  );
  CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);
  CREATE INDEX push_subscriptions_session ON push_subscriptions (session_hash);

  CREATE TABLE push_state (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    last_push_at BIGINT NOT NULL DEFAULT 0
  );

  CREATE TABLE notify_prefs (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    gifts BOOLEAN NOT NULL DEFAULT true,
    neighbors BOOLEAN NOT NULL DEFAULT true,
    invites BOOLEAN NOT NULL DEFAULT true
  );

  ALTER TABLE inbox ADD COLUMN pushed_at BIGINT;
  UPDATE inbox SET pushed_at = created_at;
  CREATE INDEX inbox_unpushed ON inbox (user_id)
    WHERE pushed_at IS NULL AND kind IN ('visit', 'gift', 'neighbor_request', 'neighbor_linked', 'invite_settled');
  `,

  // 34: piers (docs/PIERS.md, specs/tla/Piers.tla). One row per placed pier,
  // at most one per beach. The pier itself is a bag item ('pier'); a row
  // counts as one placed, so the bag shows owned minus these. Whether it
  // shows is derived from the beach's links, never stored. Deleting the
  // beach deletes the row, which puts the pier back in the bag.
  `
  CREATE TABLE beach_piers (
    beach_id UUID PRIMARY KEY REFERENCES beach (id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    placed_at BIGINT NOT NULL
  );
  CREATE INDEX beach_piers_owner ON beach_piers (owner_id);
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
