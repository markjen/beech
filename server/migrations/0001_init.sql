-- Accounts and saved beaches. We keep as little about people as possible:
-- the sign-in provider's stable user id and a display name. No email, no photo.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,          -- 'google' (later 'apple'); 'dev' only in local dev
  provider_sub TEXT NOT NULL,      -- the provider's stable subject id
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_sub)
);

-- Opaque bearer sessions; only a SHA-256 of the token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- One beach per person: which real beach, the grid size it was saved at,
-- and the compressed sand (see src/sim/sandCodec.ts in the app).
CREATE TABLE beaches (
  user_id TEXT PRIMARY KEY,
  location TEXT NOT NULL,
  nx INTEGER NOT NULL,
  ny INTEGER NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sand BLOB NOT NULL
);
