-- More for a reader signed in with LINE (publish/me.js; Nan 2026-10-20: "many
-- more personalization and convenience features … offer some kind of newsletter
-- or offer to people who opt in at signup"; her pick: the week on LINE each
-- Monday and a free Gold month). Database motdang-accounts.
ALTER TABLE users ADD COLUMN friend    INTEGER NOT NULL DEFAULT 0;  -- a friend of @964yxgnk when last asked
ALTER TABLE users ADD COLUMN weekly    INTEGER NOT NULL DEFAULT 0;  -- 1: the week on Mot Dang on LINE
ALTER TABLE users ADD COLUMN weekly_at TEXT;                        -- the first yes
ALTER TABLE users ADD COLUMN gold_code TEXT;                        -- the Gold month, a code in motdang-pages' gift table
