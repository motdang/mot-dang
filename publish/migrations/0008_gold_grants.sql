-- One Gold month per LINE account (publish/me.js goldFor): kept when the account
-- is deleted, so deleting and signing in again brings back the same code.
-- mark = SHA-256 of "gold:" + the LINE user ID. Database motdang-accounts.
CREATE TABLE IF NOT EXISTS gold_grants (
  mark  TEXT PRIMARY KEY,
  code  TEXT NOT NULL,
  at    TEXT NOT NULL DEFAULT (datetime('now'))
);
