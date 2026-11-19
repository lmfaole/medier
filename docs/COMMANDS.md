# Commands

The full command list, moved out of `AGENTS.md` so it is not loaded into every session. Read it when you need a command that `AGENTS.md` does not name.

Run from the repository root:

```sh
npm install          # also turns on .githooks/pre-push: lint, typecheck and test before a push
npm run lint         # every package and app, Worker and web/
npm run typecheck    # every package and app; an Astro app's `typecheck` is `tsc -b` for its .ts/.tsx and `astro-check` for its .astro files (TypeScript 6 in `packages/astro-check`, because @astrojs/check needs the JavaScript API that TypeScript 7 lacks), and its `build` runs both first
npm test             # packages/intl, packages/config and every app's node --test suite
npm run build        # every package and app
npm run check        # lint plus each app's data checks, where it has one
npm run ds:bump      # moves every package.json to the latest design system (`-- <sha|v8.16.0>`, `--dry-run`), brings the lockfile and the skills in step; run `verify` and commit after
npm run verify       # the whole "done" gate in one short answer: lint, typecheck, test, build, dupes (clippy and cargo test when Rust changed), generated types committed, no debug calls or commented-out code in the diff; whole logs in .data/tmp/verify/
npm run affected     # lint, typecheck and tests of only what changed (the working tree, or `-- --since <ref>`): the loop between edits
npm run timers       # every timer the schedules ask for is installed with the time they say (`scripts/timers-check.ts`), else the command that fixes it
npm run ship         # rule 7: deploy the apps the last commit changed, 3 at a time, slowest first, forside last and only if the rest succeeded; an app whose built output is the one last deployed uploads nothing (`-- <app>…`, `--dry-run`, `--jobs N`, `--force` to deploy unchanged output too; `--with-shared` when packages/ changed); per-app logs in `.data/tmp/ship/`, a summary table at the end, exit 1 on any failure
npm run data:refresh # the data tools' quickest mode now, apps at the same time (`-- --stale` only apps whose jobs are late, `--dry-run`, or app names): it calls the services' APIs; the media apps read the databases live, `forside` and `work` are published by their timers or `npm run ship`
npm run machine -- status|pull|install|bootstrap [--apply] # the quadlet units and the files in `~/.config` against their copies in git (`docs/MACHINE.md`)
npm run land -- <source> <file|folder>  # an export kept as it came: copied (never moved) to .data/raw/<source>/<date>/, checked, manifest `<date>.sha256`, locked read-only; a different file at a landed place is refused; `--dry-run`, `--import`
npm run data:check   # every database is sound (SQLite's integrity and foreign-key checks) and matches its `db/<domain>.sql` both ways: a table or column in one and not the other is listed
npm run unlabelled   # the format names in the data (`cd`, `xbox one`, `apple tv`) that no page has a word or a logo for: they still show as written, this is the list to read when choosing which get one; reads only, tells nobody
npm run data:rehearse # a new machine's first step tried here: every database restored from `data-dump/` into a temporary folder, checked and counted against the dump; `.data/` is not touched
npm run inbox        # lands and imports what has been dropped in `~/Innboks/<source>/` (spotify, lastfm, trueachievements, pokemon-go, goodreads): `land --import`, then the originals move to `~/Innboks/.landed/`; a systemd path unit runs it on arrival (`node scripts/inbox.ts install`)
npm run audit:deps   # known vulnerabilities (`npm audit`, and `cargo audit` when installed) and packages with a newer version, in `.data/tmp/audit.txt`; the run log gets `weekly-audit`, failed on a high or critical advisory. Nothing is updated. Weekly: `node scripts/audit.ts install`
node scripts/deps-update.ts run   # weekly, Sunday 02:40: Node within its major, then `npm update` in a worktree, `verify` there, and only when green it is fast-forwarded onto main and shipped; otherwise a line for `npm run attention`. `install` writes the timer
node scripts/node-runtime.ts update   # the newest Node of the major in `.node-version` into ~/.local/node (no root; deps-update runs it first); `status` says which is wanted and installed
node scripts/music-digest.ts <keys|send week|send month|test|install>   # music: push notifications at the end of a week (Sunday 20:00) and a month (last day, 20:00) to the devices that switched them on at `/tilbakeblikk`; `keys` once, `test` sends one to every device
node scripts/incident-watch.ts run   # every minute: a monitor of Uptime Kuma that went down starts an incident; `install` writes the timer (stop: `systemctl --user disable --now incident-watch.timer`)
node scripts/incident.ts launch <unit> <title>   # an incident by hand: the unit's log in ~/.local/state/incidents/ and a Claude session on it (Remote Control, the agent homelab-medic in auto mode: it fixes, then reports), at most one per unit in 6 h and 3 an hour, none in the first 10 min after boot, stopped if still working after 60 min; failure-notify starts one for every failed user unit
node scripts/backoffice.ts run    # every half hour (:15 and :45): what `attention` finds becomes a to-do in the Nextcloud Tasks list «Maskinen» (completed when it is gone) and `doctor` the note `Notes/Maskinen.md`. `install` writes the timer
npm run doctor       # timers active, runs fresh, containers up, free disk (and under 90 % full), databases sound (`data:check`), key files in `secrets/`, and from 2026-11-15 a recent backup: one line per problem (`--json`)
npm run page-check -- <app> [<path>…] [--built]  # a page in Chromium, desktop and phone, in a few lines: status, h1, console and page errors, failed requests, serious axe rules, what scripts-off gets; screenshots in .data/tmp/page-check/. Starts the dev server (or `--built`: the built Worker under Wrangler, after snapshot and build) when none answers
npm run repo:map -- <app>  # an app in thirty lines from the tree and its AGENTS.md: pages (Astro's `pages/`), server files, tables, commands; read it before exploring
npm run check:bundles # after a build: no Astro dev toolbar in any app's client or Worker bundle
npm run data:query -- <database> "SELECT …"   # one read-only question to a .data/<database>.db, 50 rows at most; `data:describe -- <database> <table>` for one table's columns
npm run dupes        # jscpd: copied code across apps, packages and crates
npm run dev:all      # every app's Astro dev server and Worker together
cargo clippy --workspace -- -D warnings
cargo test --workspace
npm run generate --workspace @designsystem/content   # the row schemas and types, from the collection specs
npm run clean # clears what can be made again: unused container images, verify and page-check logs older than a week, and `target/` over 8 GB when no build runs; never `.data/raw` or the libraries (`-- --dry-run` says what it would do; weekly from a systemd user timer: `node scripts/clean.ts install`)
npm run reap-idle # ends Claude Code sessions and browsers idle for 3 hours, always leaving the 2 and 1 most recently active, and the tree it runs in (`-- --dry-run` says what it would end; every 30 minutes from a systemd user timer: `node scripts/reap-idle.ts install`)
npm run seen -- list.txt  # what the owner has seen and heard, one per line (`film: Heat (1995)`, `tv: Dark (2017)`, `album: Radiohead - OK Computer`, `artist:`, `song:`; `scripts/seen-list.ts`): into the film and tv logs and `music_heard`, then TMDB, MusicBrainz and Trakt, then the taste profile in `.data/profile/taste.md`; `-- profile` only the profile, `--dry-run` only the list
npm run kino:link # the `Kino` calendar against `.data/film-log.csv`: reports which cinema visits are in the log and which are not; `--ask` settles events that name no film (kept as rules in `~/.config/kino-rules.json`), `--apply` writes the missing viewings and cinemas to the log (then `film-sync import-log` and `trakt` from apps/film)
npm run brettspill:link # the `Brettspill` calendar against `.data/boardgames-log.csv`, as `kino:link` is for film: an event is `Brettspill (Wingspan, Catan)` or the game alone; reports which plays are in the log, `--apply` appends the missing ones (then `boardgames-sync import-log` from apps/boardgames); `~/.config/brettspill-rules.json` settles an event by uid
npm run data:dump    # every database (not the run log) as text under `$DATA_DUMP_DIR/<domain>/<table>.jsonl`, a checkout of the PRIVATE data repository (`data-dump/` here, ignored, without it); a table over 16 MB is a folder of 25 000-row files, so no file nears GitHub's limits and a sync changes only the last; `-- --commit [--push]` commits and pushes the dump's repository; `-- <domain>…` for some
npm run data:restore # a database from its dump and db/<domain>.sql, only where the file does not exist (`-- <domain>…`, `--into <directory>`)
npm run backup       # BACKUP_DIR=/mnt/…: every database as a snapshot under a dated folder, and .data/raw/ as it is, each file once (never deletes there)
npm run snapshot     # in apps/forside and apps/work only: its /api/*.json as static files (the media apps query .data/ live)
npm run deploy       # in apps/forside and apps/work: snapshot, build, checks, wrangler deploy (by hand)
npm run media:build  # the seven media apps, the hub and each home app with a workspace (`SERVED_APPS`, Node build); then `systemctl --user restart media` (docs/MEDIA-SERVER.md)
npm run e2e          # Playwright + axe in Chromium (desktop and phone) against the built apps; e2e:all adds Firefox and WebKit (e2e/README.md)
```

`apps/<name>` is not an npm workspace, only `apps/<name>/web` is (and
`packages/*`); the root scripts reach both halves of an app through
`scripts/run-apps.ts`. Nothing builds or deploys on a push: a Worker (`forside`, `work`) is deployed
with `npm run deploy` in its app, from the machine that has `.data/`, by hand or
by its publish timer (`scripts/publish-timers.ts`, `docs/DATA.md`); the media apps are built with `npm run media:build` and served by the `media` container (`docs/MEDIA-SERVER.md`). `.githooks/pre-push` runs the root `lint`,
`typecheck` and `test` before a push, `.github/workflows/ci.yml` (run by hand)
is the full set with `dupes` and `build`, and `rust.yml` (run by hand) is clippy
and `cargo test`. Cloudflare owns what deploying needs and CI cannot hold:
the Workers, the custom domains and the Workers'
secrets.
