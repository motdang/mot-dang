-- What people tap on /find (publish/findlearn.js). Beside the index in
-- motdang-search, so the ranking reads it in the same database. load.py never
-- touches these tables: an in-place reload replaces pages/keys/fts rows, a
-- --beside reload swaps only its own tables. Keyed by page ADDRESS, not id —
-- ids are renumbered by every reload.
--   npx wrangler d1 execute motdang-search --remote --file=fleetsearch/learn.sql
CREATE TABLE IF NOT EXISTS learn (
  qk       TEXT NOT NULL,              -- learnKey(query): folded, sorted words
  url      TEXT NOT NULL,
  shown    INTEGER NOT NULL DEFAULT 0, -- impressions (ranked above the deepest tap, or top 3)
  taps     INTEGER NOT NULL DEFAULT 0,
  pogo     INTEGER NOT NULL DEFAULT 0, -- back on the results within 10 s of a tap
  via      INTEGER NOT NULL DEFAULT 0, -- tapped after this query was rephrased into another
  rank_sum INTEGER NOT NULL DEFAULT 0, -- sum of the ranks it was tapped at
  dwell_ms INTEGER NOT NULL DEFAULT 0, -- time away before coming back, capped at 10 min a visit
  dwell_n  INTEGER NOT NULL DEFAULT 0,
  up       INTEGER NOT NULL DEFAULT 0, -- a person marked it ✓ for these words (findJudge)
  down     INTEGER NOT NULL DEFAULT 0, -- … ✕
  last     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (qk, url)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS learn_q (
  qk     TEXT PRIMARY KEY,
  views  INTEGER NOT NULL DEFAULT 0,   -- results pages left by a person
  tapped INTEGER NOT NULL DEFAULT 0,   -- … of which a result was tapped
  reform INTEGER NOT NULL DEFAULT 0,   -- … rephrased within five minutes with no tap
  last   TEXT NOT NULL DEFAULT (datetime('now'))
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS learn_pair (
  qk   TEXT NOT NULL,                  -- the query asked first
  next TEXT NOT NULL,                  -- the one asked next, in the same tab, within five minutes
  n    INTEGER NOT NULL DEFAULT 0,
  last TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (qk, next)
) WITHOUT ROWID;
-- learn.up / learn.down came 2026-10-20, after the live table was made; the
-- live one got them by ALTER TABLE learn ADD COLUMN.
-- One row per send from the "not it / good" line on /find (findJudge).
CREATE TABLE IF NOT EXISTS judged (
  id      INTEGER PRIMARY KEY,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  qk      TEXT NOT NULL,                -- learnKey(q)
  q       TEXT NOT NULL,                -- the words as typed
  verdict TEXT NOT NULL,                -- good | bad
  why     TEXT NOT NULL DEFAULT '',     -- comma list: missing kind far closed buried words
  yes     TEXT NOT NULL DEFAULT '[]',   -- JSON: addresses marked ✓
  no      TEXT NOT NULL DEFAULT '[]',   -- JSON: addresses marked ✕
  want    TEXT NOT NULL DEFAULT '',     -- the reader's words for what they were after
  snap    TEXT NOT NULL DEFAULT '',     -- JSON: the page as built (judgePanel)
  who     TEXT NOT NULL DEFAULT '',     -- classify(): human, ai, search, …
  agent   TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  lang    TEXT NOT NULL DEFAULT '',
  seen    TEXT                          -- set by fleetsearch/judged.py once pulled
);
CREATE INDEX IF NOT EXISTS judged_qk ON judged(qk);
