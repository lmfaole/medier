-- podcast_history: what gpoddersync (Nextcloud, fed by AntennaPod on the owner's phone) recorded as
-- episode actions, imported by `podkast-sync` (`apps/podkast/sync-rust`, every four hours) from the newest dump of Nextcloud's database (the Nextcloud repository's `backups/` and `raw/database/<date>/`). Every play, pause, seek and finish, with its position and timestamp, is kept as it came; a
-- reader filters (`completed`) or counts what it needs. Private by nature: this database is not in
-- any app's snapshot by default (see `apps/podkast/web/src/server/api.ts` for the one app that reads it).

-- One row per action gpoddersync recorded: the whole listening log, in the order it happened
-- (`timestamp_epoch`, Unix seconds, when the action was recorded).
CREATE TABLE IF NOT EXISTS episode_actions (
  id INTEGER PRIMARY KEY,                     -- gpoddersync's own action id, kept as-is
  episode_key TEXT NOT NULL,                  -- the episode's guid (prefix stripped) or its normalized URL
  series_key TEXT NOT NULL,                   -- the show's feed URL (or show_name from podcasts.db when known)
  episode_url TEXT,                           -- the episode's media URL as gpoddersync had it
  guid TEXT,                                  -- the raw guid gpoddersync stored, prefix included
  action TEXT,                                -- PLAY, FINISH, ... as the client sent it
  position INTEGER,                           -- seconds into the episode when the action fired
  started INTEGER,
  total INTEGER,                              -- the episode's length in seconds, when known
  timestamp TEXT,                             -- the action's time, ISO 8601, derived from timestamp_epoch when empty
  timestamp_epoch INTEGER,                    -- Unix seconds, the primary sort key
  completed INTEGER NOT NULL DEFAULT 0,       -- 1 when the action marks the episode finished (action or position rule)
  series_title TEXT,                          -- the show's title from podcasts.db, or a label derived from its URL
  episode_title TEXT,                         -- the episode's title from podcasts.db, or a label derived from its URL
  imported_at TEXT NOT NULL                   -- when this row was last imported (RFC 3339), not when it happened
);

CREATE INDEX IF NOT EXISTS idx_actions_episode ON episode_actions (episode_key);
CREATE INDEX IF NOT EXISTS idx_actions_ts ON episode_actions (timestamp_epoch DESC);
