# AGENTS.md — boardgames

> **Serving (changed 2026-11):** this app is no longer a Cloudflare Worker with a published snapshot. It is Astro on Node, one of the eight media apps in the single server on the owner's machine (`scripts/media-server.ts`, the `media` container, `docs/MEDIA-SERVER.md`): dynamic server rendering, the database opened read-only, behind the owner's Nextcloud login (so "public" below means "behind that login"). Built with `npm run media:build`, live after `systemctl --user restart media`. There is no `<app>-publish` timer, no `npm run deploy` and no `wrangler.jsonc` any more; where this file says snapshot, publish or Worker for this app, read it as the server's live read of `.data/`. The sync timers stay.

`sky.lmfaole.party/apps/medier/brettspill`: the board games the owner has played (which ones, not each round), from the log, and what the register BoardGameGeek says about them, a snapshot of `.data/boardgames.db`. Public and not indexed (the three
layers, as music). Rules shared with every app are in the root `AGENTS.md`; the counting, the lists and the pages
themselves are `@designsystem/shelf`, shared with the other two shelf apps (games, books), except a game's own page, which board games write themselves because BoardGameGeek has far more to say about a game (`web/src/components/board-game-page.tsx`).

**The log is the record**: `.data/boardgames-log.csv`, written by hand and added to by a service
(`date,title,year,status,rating,amount,note,ext_id,source,format`, `#` starts a comment; an empty `date` is a line whose day is
not known; `rating` is 0.5 to 5 in half steps). `status` is `played` (an empty status is `played`); `amount` is not used. `ext_id` is the register's number (it settles a wrong
match), `source` the service's own number for the line (it is how a pull knows it has added it, so never edit it away). `format` is what the owner has (`cd`, `vinyl`, `digital`, `blu-ray`, `steam`, a platform; free text, lowercase, several with commas) and is shown as «Eier» on the work's page and in the library.
`boardgames-sync import-log` makes `boardgame_entry` exactly the log's lines; a line changed or deleted in the log is changed or deleted in the

**The library is the collection and the log together**: `.data/boardgames-collection.csv` (the log's columns; `status` is `owned` or `want`, empty means `owned`) is made the collection table by `boardgames-sync import-collection`, so a work needs no line in the log to be in the library or to have a page; the log counts only what was played or read. 
database. `boardgames-sync add <title> <year> <date> <rating>` (`-` for none) appends a line and imports.
The `note` of a line stays in the database: it is never read for a page, so it is never published.

| Where | What |
| --- | --- |
| `sync-rust/src/bgg.rs` | `boardgames-sync bgg`: looks each title the log names up on BoardGameGeek (`BGG_TOKEN`: since the fall of 2025 every request needs a token from a registered application, boardgamegeek.com/applications, approved by hand), lands the answers under `.data/raw/bgg/<date>/` and stores the game (`boardgame_item`: designers, year, description, cover address; `boardgame_genre`: its categories) and, from the same `thing` answer asked with `stats=1`, everything else it says: `boardgame_detail` (players, playing time, age, ratings, weight, counts of who owns or wants it, a thumbnail), `boardgame_link` (every designer, artist, publisher, mechanic, family and related game, by the register's link type), `boardgame_name`, `boardgame_player_poll` and `boardgame_rank`. A stored game with no `boardgame_detail` is fetched again on the next run, so `bgg` fills in games fetched before the tables existed. A title no search matches is kept in `boardgame_match` with its candidates; settle it by writing BGG's number in the log's `ext_id` |
| `crates/shared-data/src/shelf.rs` | The log, the register tables and the search, shared by the three tools: reading and checking a line (a wrong line is refused with its line number), `import`, `append`, `append_new`, `resolve`, `fetch_items`, and the `main` every tool has (`Tool`) |
| `packages/contracts/src/shelf-tables.ts` | The tables the pages read and `shelfLinesSql`: a line and the work matched to it (the log's number first, else the match for its title and year) |
| `web/src/server/api.ts`, `details.ts`, `snapshot.ts`, `responses.ts` | The shared API files plus `details.json` (the register's figures) and `entity.json?slug=` (the shared page plus `details`, read from the tables above); the counting is `packages/shelf/src/shelf.ts`. `responses.ts` is `SHELF_RESPONSES` with the two schemas boardgames adds, checked against the loaders |
| `web/src/pages/*.astro`, `views/boardgames.tsx` | Astro pages: `/brettspill/[slug]` hydrates its chart `client:visible`, `/bibliotek` is `client:idle`, `/` and `/historikk` (a year at a time, `?year=YYYY`; an old `?month=` link lands on its year) are plain HTML. `views/boardgames.tsx` closes `words.ts` over the shelf views and adds the two that carry BoardGameGeek's side (a game's page, the card); `read-card.ts` reads the card with this app's entity schema, since the shared one would drop `details`. `/minner` is not edge cached (it shows today) |
| `packages/contracts/src/boardgame-tables.ts` | The five detail tables, checked against `db/boardgames.sql` |
| `packages/shelf/src/pages/` | Overview, the list (`/history`) and a work's own page, with BoardGameGeek's credit (`Credit`) |
| `scripts/fetch-shelf-covers.ts` | After the snapshot: lands the covers it names under `.data/raw/shelf-covers/boardgames/` and copies them to `web/public/covers/` (only from a register's own host: `packages/shelf/src/covers.ts`) |

Commands from `apps/boardgames`: `cargo run -p boardgames-sync -- import-log | add <title> <year> <date> <rating> | bgg [--everything]`, `npm run snapshot`, `npm run deploy`.
Timers: `schedule.json` runs `import-log` and `bgg` daily, `bgg --everything` on Sundays (`node scripts/sync-timers.ts boardgames install`, with `BGG_TOKEN` in `~/.config/boardgames-sync.env`, mode 600), and `node scripts/publish-timers.ts boardgames install` publishes after the Sunday refresh.
The statuses are in two places that have to agree: `SHELF` in `sync-rust/src/main.rs` and the config in `web/src/server/api.ts`.
