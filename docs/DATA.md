# Data: one local SQLite file per domain, read live by the media server, published as a snapshot for forside and work

**The goal is that this machine is home for all data about the owner.** What is
in `.data/` today is the start of that, not all of it: see
the table below for the sources that are here (API first, export second, hand entry last). The processed data has a copy in git (`data-dump/`, below); there is **no
backup of `.data/raw/` yet**, so what exists nowhere else is never deleted or rebuilt
from a guess.

**No app has a connection to a database outside this machine.** Every data
domain is one SQLite file of its own, `.data/<domain>.db`, whose schema is
`db/<domain>.sql` (the only copy). The domains are `music`, `podcasts`, `podcast_history`, `film`, `tv`, `games`, `books`, `boardgames`, `github`,
`cv`, `accounts`, `photos`, `site` and `platform` (when each tool
last ran). Until 2026-10-16 they were one shared `data.db`; it is archived as
`.data/archive/data-before-domains.db`. The pictures are plain files in each app's `web/public/media/` and
`web/public/og/`. The seven media apps run in one Node server on this machine (`docs/MEDIA-SERVER.md`) and read the databases
live, read-only (`readOnly` SQLite, WAL readers need `-shm`, so `.data/` top level is mounted writable into the container but no table is written).
The Workers of `forside` and `work` have no database or bucket binding; they serve a
**snapshot**: the answer of every `/api/<file>.json`, built from the local file
by `npm run snapshot` and shipped with the deploy as static assets. The only
network traffic left is calls to external APIs (ListenBrainz, Ente, archive.org
covers, met.no, GitHub).

| What | Database | Owner |
| --- | --- | --- |
| Listens and everything computed from them, loved tracks, and what is owned or wanted (`music_collection`, from `music-collection.csv` and Discogs: `music-sync discogs`) | `music.db`: `listens`, `summary_periods`, `top_items`, `recording_feedback`, … | the Rust sync (`apps/music/sync-rust`) |
| Podcasts: plays, shows, episodes | `podcasts.db` | the sync (`split-podcasts`) |
| Podcasts: every action the player recorded (play, pause, finish) from gpoddersync | `podcast_history.db`: `episode_actions` | `podkast-sync import` (`apps/podkast/sync-rust`) |
| Film: what was watched, what is owned or wanted, and the register's facts | `film.db` | `film-sync` (`import-log`, `import-collection`, `import-cinemas`, `tmdb`) |
| TV: the episodes watched, the series owned or wanted, and the register's facts about each series | `tv.db` | `tv-sync` (`import-log`, `import-collection`, `add-season`, `tmdb`) |
| Games: the log, the collection (what is owned or wanted, Steam's library), and the register's facts | `games.db` | `games-sync` (`import-log`, `import-collection`, `add`, `steam`, `igdb`) |
| Books: the log, the collection (owned or wanted), what Hardcover has shelved, and the register's facts | `books.db` | `books-sync` (`import-log`, `import-collection`, `add`, `hardcover`, `openlibrary`) |
| Board games: the games played, the collection (owned or wanted), and the register's facts | `boardgames.db` | `boardgames-sync` (`import-log`, `import-collection`, `add`, `bgg`) |
| The CV, accounts, photos, page previews, the glossary | `cv.db`, `accounts.db`, `photos.db`, `site.db`: one table per collection, written from the specs in `packages/content` | whoever changes the rows, with SQL |
| GitHub: repositories, pull requests, issues, contribution days | `github.db`: `github_repos`, `github_items`, `github_days`, `github_project_commits` | the Rust sync (`apps/work/sync-rust`); private repositories are in it, so never in a snapshot |
| When each tool last ran | `platform.db` | `scripts/sync-timers.ts` |
| Pictures and artwork | `apps/<app>/web/public/media/`, `web/public/og/` | files, named `<hash>-<w>x<h>.<ext>` |

`.data/` and every `web/public/api/` are git-ignored. They hold real listening
and reading data, so never paste their rows outside this machine.

**`data-dump/` is committed.** `npm run data:dump` writes every database (not the run log `platform`) as one
text file per table, `data-dump/<domain>/<table>.jsonl`: the columns on the first line and a JSON array per row, exact
enough that `npm run data:restore` gives back the same values (NULL, a whole real, a big integer, a blob). Run it after the data
changes and commit the result; the repository is private, so keep it so. `data:restore` never touches a database
that exists. The dump is the processed data, not the raw exports: those stay in `.data/raw/` and are too big for git. `budget` and `places`
were dropped as projects on 2026-10-22 (database files deleted 2026-10-21, definitions removed from `db/`).

## Reading and changing

```sh
npm run data:describe                       # tables, row counts and columns of every .data/<domain>.db
node --no-warnings -e '…'                   # or any SQLite tool: the file is plain SQLite
```

Content is changed with SQL on its file (`.data/cv.db` and so on); there is no editing UI. The
columns of the content tables keep the keys the apps read (`tittel`,
`arbeidsgiver`, …), and each column's comment in `db/<domain>.sql` says what it is.
A list or an object is JSON text: `json_extract(brukernavn, '$[0].handle')` reads into it. Rows are
checked against the collection's row schema when the snapshot is built; a row
that breaks it makes `npm run snapshot` skip that file and say why.

No app shows cv, accounts or photos since their frontends were removed (2026-10-15); the tables stay in their own files.

## Publishing

The media apps are not published: they read `.data/` live behind the Nextcloud login, deployed by `npm run media:build` and a restart of the
`media` container (`docs/MEDIA-SERVER.md`). Only `forside` and `work` are published:

```sh
cd apps/forside && npm run deploy           # snapshot, build, check, wrangler deploy (the same in apps/work)
npm run snapshot                            # only the snapshot, into web/public/api/
```

A snapshot is a copy of that data as static assets at Cloudflare, readable by
anyone. So it holds only what the owner would publish, and a private source reaches a snapshot
only as an allowlisted aggregate (git history, `docs/plans/2026-10-14-data-platform.md` Task 3 at `fd5bd26`). Location,
health, mail, messages and money are never snapshotted (a media app, behind the login on this machine, may read what its database holds). The one mail source is the owner's cinema ticket mails: Proton Mail
Bridge serves the mailbox on this machine only, `scripts/mail-ingest.ts` lands each ticket mail under `.data/raw/mail/`, and
only the film, the cinema and the times leave it (to the Kino calendar and the film log, `apps/film/AGENTS.md`). The same goes for
concert receipts of Ticketmaster (`mail:concerts`: the Konserter calendar, `music_concert_event` and `music_concert`, `apps/music/AGENTS.md`) and stay
confirmations of Booking.com (`mail:stays`: the Generelt calendar). The receipts of Vy and Entur are landed but not read: the
journey is in the PDF, not in the mail. Bolt rides are not kept. Receipts of games (Nintendo eShop, itch.io) and audiobooks (Audible) are
read for their title only (`mail:purchases`) and added to the games and books collections as owned (`purchases` in each sync).
`mail:tidy` moves read mail out of the inbox on Sundays 05:00: one-time codes (login and verification codes, at once, read or not),
notifications and newsletters, Apple and platform mail (Google,
Microsoft) and the notices of social and service senders go to the archive, and receipts and invoices (the shops, the rides, Apple's
and Google Play's) to the folder *Kvitteringer*; each rule has its sender list and an age (7 to 90 days) in `mail-tidy-plan.ts`. It
never deletes, never touches an unread mail (but a one-time code), a personal provider (iCloud, Gmail) or a protected sender (banks, Klarna, the tax office,
NAV, health services, the landlord), and its log (`.data/tmp/mail-tidy.log`) has no sender or subject.
`mail:tag` puts labels on mails (Faktura, Kvittering, Billett, Reise, Levering, Sikkerhet, Abonnement, Nyhetsbrev, Jobb, Skole, Bolig,
Frist, Dataeksport, Økonomi, Spill, Utvikling, Arrangement) by their sender and subject only, never the body, as Proton labels (`Labels/<tag>`): nothing is moved, deleted or marked
read. `mail-ingest` tags each new mail as it arrives (`mail-tag-new.ts`); `mail:tag -- --apply` tags what is already there.
`npm run attention` lists what the machine could not decide and the owner must (titles a register found no single answer for, cinemas missing
from `film_cinema`, an undated viewing beside a dated one, Kino events that name no film, the mail service down); a daily timer (06:30) tells it on
the desktop once per set. It reads only, and `doctor` is the machine's health (timers, freshness, disk, backup). `calendar:link` links the Kino and Brettspill calendars to their logs
every night (04:00, after `calendar:export`), the Nextcloud repository's `event-albums` makes an Immich album of each concert and stay
(04:30), and `scripts/notify.ts` tells the owner on the desktop when a ticket mail cannot be read, Bridge cannot be reached or a timer fails.

`deploy` runs where `.data/` is, so it is run from this machine: by hand, or by the app's publish timer.
`node scripts/publish-timers.ts <forside|work> install` writes a systemd user timer (forside at :55 every three hours, work 04:20) that runs `npm run deploy` only when the latest sync of the app's data finished well and the
snapshot differs from the one last published (`.data/published/<app>.sha256`); a run is a row in `platform.db`.
Wrangler has to be signed in for this user. The checks of `deploy` are the same, so nothing private reaches a snapshot.
No build service can run it: the data files are on this machine only. A file the snapshot could not build (an empty
CV, a collection with a bad row) is left out and its URL answers a JSON 404.
A request with parameters has its own file (`/api/memories.json?day=2024-03-05` is
`/api/memories/day=2024-03-05.json`); music's `server/snapshot.ts`
list which ones.

## One file per domain, and the originals

Every domain has the same four things: `db/<domain>.sql` for its schema,
`.data/<domain>.db` (`<DOMAIN>_DB` names another file, `PODCAST_DB` for podcasts),
`db/migrations/<domain>/0001-….sql`, and an entry in `DATABASES` in both
`scripts/data.ts` and `crates/data-migrate/src/main.rs`; `scripts/repo-layout.test.ts`
fails when one is missing or the two lists differ. That way a corrupt or oversized source
cannot take the rest with it, and one domain can be rebuilt without touching another. An app
names the databases its API reads in `DOMAINS` (`server/api.ts`): the snapshot opens the first
and attaches the rest under their own names (`github.github_days`).

The original of every pull (an export, a fetched page of an API) is landed unchanged
in `.data/raw/<source>/<YYYY-MM-DD>/` first (`shared_data::raw::landing_dir`, `DATA_RAW`
names another root). A tool never edits, reuses or deletes a landed folder, and
refuses to land into a dated folder that already holds files: a second pull is a new
date. There is no backup, so these folders are the only copy a rebuild can start from.

## Serving from this machine

The media apps are served from this machine (`docs/MEDIA-SERVER.md`): one Node server in the `media` container, read-only on `.data/`, behind the Nextcloud login. Before that,
for a while an app could be a **home app**: its Worker asked this machine
for each `/api/*.json` through a Workers VPC binding and a tunnel instead of serving a
snapshot, so data that must not sit at Cloudflare could still be shown. No app needs it
since the budget app was removed (2026-10-15), so the origin, the unit, the tunnel and
the Worker side were deleted (the code is in git history before that date; the design and
its reasons are in git history, `docs/plans/2026-10-14-data-platform.md` Task 3 and Task 5 at `fd5bd26`). Data that
must stay private (location, health, mail, money) has no app until that is built again.

## Changing the shape

A field or a collection is changed in its spec, `packages/content/src/collections/*.ts`,
then `npm run generate --workspace @designsystem/content` writes the row types
(`generated/rows.ts`) and the four content schemas (`db/cv.sql`, `accounts.sql`,
`photos.sql`, `site.sql`). Tests fail when any of them is stale.
`snapshot` and the Rust sync apply a domain's `db/<domain>.sql` with `CREATE TABLE IF NOT
EXISTS`, so a new table appears by itself. A changed, renamed or dropped column
is a **migration**: a file `db/migrations/<domain>/NNNN-name.sql`, numbered 1, 2, 3 … without gaps, with the new shape also written
into `db/<domain>.sql`. The version is SQLite's `PRAGMA user_version`. A tool
migrates an existing file when it opens it (before the schema is applied), an
empty file gets the schema and is stamped at the latest version, and
`npm run data:migrate` does the same for every file at once. `snapshot` refuses
a database that is behind and says so. Each migration runs in one transaction.

The databases run in WAL mode, so beside `music.db` you may see `music.db-wal` and
`music.db-shm`: they are part of it. Copy all three, or none, and only while no
tool is running.

## Spotify export and the podcast database

Spotify's "Extended streaming history" (a zip from the privacy page, unpacked to a folder of
`Streaming_History_Audio_*.json`) is imported by music-sync into `listens`:

```sh
cd apps/music   && cargo run -p music-sync   -- import-spotify <folder> [--dry-run]   # tracks → listens
```

Music adds plays of 30 s or more unless ListenBrainz already has the same track starting within six minutes
(a re-run adds nothing), then recompute with `daily-plays all`, `all-time-totals`, `summaries all`, `facts all`, `memories`, `capsules`, `entities` and `quiz`.
Imported listens have no MusicBrainz ids, so they carry no genre, decade or area.
Everything about podcasts is one database: `.data/podcasts.db`
(`PODCAST_DB` names another file), schema `db/podcasts.sql`. It holds the plays of Spotify's export (`podcast_plays`, every
play, skips included; its importer, `apps/podcast/sync-rust`, was removed on 2026-10-15 and is in git history), the plays
ListenBrainz and Last.fm scrobbled (`podcast_listens`), the shows that tell those from music (`podcast_shows`) and the episodes
written by hand (`podcast_episode`). music-sync's `split-podcasts` moves the plays out of `listens` and keeps it
music only. `podcast_show_info`, `podcast_feed_episode` and `podcast_person` say what the shows are (from Apple's directory and the shows' own RSS feeds, landed under `raw/podcast-feeds/`), `podcast_show_country` where they are made (by hand). Read by `apps/podkast` (`sky.lmfaole.party/apps/medier/podkast`), whose snapshot holds counts and titles of what was played. Like every database it is git-ignored and private.

## Apple Music export

Apple's "Apple Media Services" data export (privacy.apple.com, two zips) is landed whole with
`npm run land -- apple-media <zip>` (originals under `.data/raw/apple-media/<date>/`, never rewritten). The music is in
`Apple_Media_Services.zip`, folder `Apple Music Activity`; unpack its `Library Tracks` and `Library Playlists` `.json.zip` next to the CSVs and run:

```sh
cd apps/music && cargo run -p music-sync -- import-apple "<…/Apple Music Activity>" [--dry-run]
```

It keeps `apple_track` (the library, by Apple's id), `apple_play` (every finished play, `Apple Music Play Activity.csv`: exact start, device,
where it was played from, skips included), `apple_favorite` and `apple_playlist` + `apple_playlist_track`. The log's IP address and position columns are not read.
A listening becomes a `listens` row only when it reaches 30 % of the track (at least 30 s; Last.fm's own rule is half the track or four minutes, which left out a third of what was heard). Plays of one song that a pause or a scrub split, up to ten minutes apart, are put together first; a play that starts at 0 is the song played again and a listen of its own, so a repeat counts. Each stored scrobble is the twin of one play only (nearest first), and one play the export reports twice is one. Its song and album must name one artist
in the library, no listen of the same track starts within six minutes, and its hour holds fewer stored listens than Apple has plays; a second run adds nothing.
The same export's video and podcast files go to their own domains, from the unpacked `Apple_Media_Services` folder:
`cd apps/tv && cargo run -p tv-sync -- import-apple <folder>` keeps what Apple TV and Apple TV+ played in `apple_tv_play` (`tv.db`, one row per span watched, unmatched to TMDB, apart from the hand-kept `tv_watch`),
and `cd apps/music && cargo run -p music-sync -- import-apple-podcasts <folder>` keeps `apple_podcast_feed` (followed and merely played feeds) and `apple_podcast_state` (what the Podcasts app remembers of each episode, by GUID) in `podcasts.db`.
Games and books come from the same landed zips (`npm run land -- apple-media <zip>`, both parts): `cd apps/games && cargo run -p games-sync -- apple-games` (Game Center's games and the days Apple Arcade games were played) and `cd apps/books && cargo run -p books-sync -- apple` (books and audiobooks bought in Apple Books). The Nextcloud repository's `npm run import:apple <Apple_Media_Services>` puts the followed podcasts into gpoddersync, the playlists in `Musikk/Apple Music/` and the wish list in a note.
Not imported: rented films (a rental does not say it was watched), the subscription history and the list of apps (money and not media; a new local domain would be needed), Apple Music Click Activity, payments, addresses and device ids.
The other files (Daily Tracks, Top Content, container and statistics files, the Import_* Spotify transfer, Activity, Siri, purchases and billing) stay as raw originals only:
sums of the play log, copies of Spotify, or not listening. Then recompute as after the Spotify import. Nothing here is in a snapshot.

## Likes: Spotify and Last.fm

`spotify-likes` replaces `spotify_saved` with the tracks saved on Spotify (pages landed under `.data/raw/spotify-saved/`); `feedback` also keeps `lastfm_loved`, every love with or without a MusicBrainz id. `likes-plan` lists what is in one and not the other, matching songs by artist and title, where a collaboration (Last.fm writes one string, Spotify lists the artists) and a featured guest in the title count as the same song; `likes-push` adds the missing ones on each side and **never removes a like**. Spotify needs a development-mode app whose owner has Premium (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI` in `~/.config/music-sync.env`, then `likes-auth spotify` once, or `spotify-login-start` and `spotify-login-finish <address>` when the browser is not on this machine); Last.fm needs `LASTFM_API_SECRET` (the shared secret of an API account, shown only when it is created) and `lastfm-login-start`, approve, `lastfm-login-finish` once. The daily run ends with `spotify-recent` (Spotify remembers only the last 50 plays, so it runs every three hours), `spotify-likes` and `likes-push 50`, and the weekly one with `spotify-library`. None of them holds back a publication when it fails (`ignoring` in `scripts/publish-schedule.ts`): a lapsed Spotify sign-in does not keep the snapshot from going out. A song that was pushed, or that Spotify could not find, is not tried again (`like_pushed`, `like_unmatched`); `likes-ignore <artist> <track>` keeps one out both ways (`like_ignore`). Nothing here is in a snapshot.

`spotify-library` keeps the rest of the Spotify library the same way, replacing `spotify_album_saved`, `spotify_playlist` + `spotify_playlist_track` (the owner's own and shared lists, with their tracks; other lists only as a row) and `spotify_followed_artist` (pages landed under `.data/raw/spotify-library/`). It needs the playlist and follow scopes, so `likes-auth spotify` is run again after they were added. Run by hand; not in a timer. Nothing here is in a snapshot.

`spotify-recent` adds the last 50 plays Spotify remembers (`user-read-recently-played`) to `spotify_play`: time, track and the context it was played from (playlist, album, artist). Spotify keeps nothing older, so a play missed between two runs is lost; the scrobblers stay the record of what was listened to and this is only where the context is kept (raw under `.data/raw/spotify-recent/`). Nothing here is in a snapshot.

## The Rust sync

`apps/music/sync-rust` fetches from ListenBrainz and writes to `.data/music.db`
(`MUSIC_DB` names another file). Run it from `apps/music`; nothing schedules it:

```sh
cargo run -p music-sync -- listens && cargo run -p music-sync -- enrich
cargo run -p music-sync -- summaries current-year   # see apps/music/docs for the other jobs
```

## What the content is

`.data/data.db`, now split by domain, was filled once from an export of the old production database
(9 October 2026): every content table, budget's and music's, with the same
counts as the old content store held (cv: 3 positions, 4 educations, 6
projects, 3 links; accounts: 37 platforms in 7 categories; photos: 9 groups, 78
pictures; podcast: 29 episodes; 17 page previews; 12 glossary terms; 71 128
listens). The 78 pictures were files in `apps/photos/web/public/media/` (removed
2026-10-15, in git history); podcast artwork and avatars were already files. Nothing is
lost, and nothing fetches from anywhere: the apps and their tools reach no
database, bucket or content service outside this machine.
