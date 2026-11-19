# Podcasts are not music

Moved out of `apps/music/AGENTS.md`; read it when touching `split-podcasts`, the podcast feeds or `scope.rs`.

ListenBrainz and Last.fm also hold podcast plays (NRK's «Dagsnytt 18», TrueAnon, news
clips scrobbled with their headline as the artist). They do not stay in `listens`:
`split-podcasts` (`sync-rust/src/podcasts.rs`, the second job of the daily and weekly
timers) moves them to their own database, `.data/podcasts.db` (`db/podcasts.sql`), table
`podcast_listens`. A listen is a podcast's when its artist is a row of `podcast_shows`
there (ListenBrainz names the show as the artist, Last.fm as the track, with the episode as the other), or when it has no album and no MusicBrainz recording and lasts ten minutes or more.

- After a manual `import-lastfm`, `import-spotify` or `listens`, run `split-podcasts` before
  the recompute chain, or a podcast play is counted until the next scheduled run.
- A new show: `INSERT OR IGNORE INTO podcast_shows (artist_name) VALUES ('Name')` in
  `.data/podcasts.db`, with the name as ListenBrainz has it, then `split-podcasts` and the
  recompute (`daily-plays all`, `summaries all|years`; the daily jobs
  only touch the current year).
- `db/podcast-shows.sql` is the list found on 2026-10-08, applied once.
- What the shows are: `podcast-feeds` (`sync-rust/src/podcast_feeds.rs`, `--refresh` to look everything up again) finds each show with
  three or more plays in Apple's directory (storefronts no, us, gb, the title must equal the show's), lands the
  directory's answer and the show's RSS feed unchanged under `.data/raw/podcast-feeds/<date>/`, and writes the show, its
  episodes and the people the feed names (`podcast:person`) to `podcast_show_info`, `podcast_feed_episode` and
  `podcast_person` in `podcasts.db`. A show not found is in `podcast_lookup` and not asked for again until `--refresh`.
  `podcast-countries` asks Wikidata (country of origin) for the shows with three plays and no country, landing its answers under `.data/raw/wikidata/<date>/`; a hand-written row is never replaced. `podcast_show_country` is by hand (`db/podcast-countries.sql`, applied once; a row whose note starts with «Guess» is a guess and shows as one): no feed says where a show is made. `podcast_feed_choice` (`db/podcast-feeds.sql`) is the owner's choice of feed where Apple has several shows of a name or none: the job takes that feed and asks no directory, and an empty feed leaves the show alone. Candidates are best judged by how many of the played episodes a feed has.
- `scope.rs` keeps the clip half of the condition as a guard for a clip that arrived since the
  last split. The same condition is `MUSIC_ONLY_SQL` in `packages/contracts/src/music-tables.ts`
  for the Workers; `contracts.test.ts` holds the two equal.
