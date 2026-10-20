-- Sign in with LINE and saved things on every device a reader signs in on
-- (publish/accounts.js; Nan 2026-10-20, C230 (c)). Database motdang-accounts,
-- binding ACCOUNTS — apart from the search index, whose reloads replace its
-- own tables and nothing else.
CREATE TABLE IF NOT EXISTS users (
  id        INTEGER PRIMARY KEY,
  line_sub  TEXT NOT NULL UNIQUE,         -- LINE's user ID for this channel
  name      TEXT NOT NULL DEFAULT '',     -- LINE display name, as LINE sent it
  picture   TEXT NOT NULL DEFAULT '',
  created   TEXT NOT NULL DEFAULT (datetime('now')),
  last      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  hash      TEXT PRIMARY KEY,             -- SHA-256 of the cookie's token; the token itself is not kept
  user_id   INTEGER NOT NULL,
  created   TEXT NOT NULL DEFAULT (datetime('now')),
  expires   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS saved (
  user_id   INTEGER PRIMARY KEY,
  data      TEXT NOT NULL DEFAULT '{}',   -- JSON: {keys: {name: {v, t}}, saved: [...], gone: [...]}
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  ver       INTEGER NOT NULL DEFAULT 0    -- +1 a write; a write from an older read is refused
);
