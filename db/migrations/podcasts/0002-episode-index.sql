-- The scrobble-against-Spotify check of `PODCAST_PLAYS_SQL` looks a play up by its episode name and time.
CREATE INDEX IF NOT EXISTS idx_podcast_plays_episode ON podcast_plays (episode_name, started_at);
