# Running the music sync on a timer

What runs and when is `schedule.json` next to this file; `scripts/sync-timers.ts` does the rest for any app.

The sync writes to `.data/music.db` on this machine, so it can only run here.
The root script `scripts/sync-timers.ts` runs it with systemd user timers (`schedule.json`): `frequent` every three hours
(the new plays and everything counted from them, about a minute and a half), `backlog` an hour before each `frequent` (the
rate-limited lookups at MusicBrainz, Spotify and Deezer that work down what is not yet known, up to half an hour) and
`weekly`; by default
nothing is scheduled, and `npm run sync -- <job>` in `apps/music` runs a job
by hand.

One-time setup:

1. Create `~/.config/music-sync.env`, mode 600, with one line:

   ```
   LISTENBRAINZ_USERNAME=...
   ```

2. `node scripts/sync-timers.ts music install` from the repository root

Then `systemctl --user list-timers 'music-sync-*'` shows the next runs and
`journalctl --user -u music-sync-frequent` the last one. `npm run data:status` (repository root)
lists the last run of every job from the `sync_runs` table and marks one older than 36 hours as STALE. `Persistent=true` makes a
timer catch up after the machine was off, and the sync resumes from
`sync_state.last_listened_at`, so a missed day costs nothing. To run by hand:
`node scripts/sync-timers.ts music run daily`. Timers installed by the old `install.sh` point at a script that is gone: run `install` again. To stop the timers:
`systemctl --user disable --now music-sync-frequent.timer music-sync-backlog.timer music-sync-weekly.timer`.
Publishing the result is still `npm run deploy` in `apps/music`.

## Last.fm (one-time import)

Plays from Last.fm are not on a timer. With `LASTFM_USER` and `LASTFM_API_KEY` in
`~/.config/music-sync.env` (the key is free, from last.fm/api/account/create; it is never
written to a landed page):

```sh
export $(grep -v '^#' ~/.config/music-sync.env | xargs)      # or set the two variables by hand
cd apps/music
cargo run -p music-sync -- fetch-lastfm                       # lands .data/raw/lastfm/<today>/page-*.json, read-only
cargo run -p music-sync -- import-lastfm ../../.data/raw/lastfm/<today> --dry-run
cargo run -p music-sync -- import-lastfm ../../.data/raw/lastfm/<today>
```

A scrobble is skipped when `listens` already has the same track started within six minutes
(the rule `import-spotify` uses), so a re-run adds nothing. Last.fm's MusicBrainz ids are kept.
Recompute afterwards: `daily-plays all`, `all-time-totals`, `summaries all`, `facts all`,
`memories`, `capsules`, `entities`. Write the manifest beside the landed folder
(the rule is in `scripts/land.ts`).
