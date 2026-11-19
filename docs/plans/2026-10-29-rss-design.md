Flyttet 2026-11-11: RSS eies nå av nextcloud-repoet (scripts/rss-*.ts)

# RSS: the feeds kept, and a curated front page (design)

Status 2026-10-29: built and deployed (sync, snapshot, three pages, hourly pull, publish every three hours). Revised to match; where the first design differs from the code, the text below is the code. Open: tuning the weights against real data.

## Intent

The owner reads RSS in a self-hosted Miniflux (`rss.lmfaole.party`, stack in the
`nextcloud` repository). Android clients (Readrops) show an endless unread list
and nothing lifts the important stories. This adds an app, `rss`, at
`lmfaole.party/rss`: every item ever fetched, a ranked list of the top stories and
statistics, built like the media apps. The page is public; nothing private is in it.

Success: `/rss` lists all items newest first, `/rss/toppsaker` shows a short,
believable list of what mattered, `/rss/statistikk` shows counts per source and
month, and the data is kept here even when Miniflux prunes it.

## Decisions already made

- A new app under `lmfaole.party/rss` (Worker route `lmfaole.party/rss` and
  `lmfaole.party/rss/*`, Vite `base` `/rss/`, own Worker name), a sibling of
  `/medier/*`; `forside` keeps the rest of the domain.
- The whole history is kept, read and unread.
- Rules, not an LLM, rank the stories.
- The importer is Rust (a sync tool), the schema is `db/rss.sql`, ranking and
  statistics are TypeScript at snapshot time.

## What is published

Only title, source, category, published time and link of an item. Never the item's
text, never read state, never stars, never which items were opened. Read and star
state are stored in `.data/rss.db` but enter a snapshot only as aggregate counts
(for example "items per source and month"), proved by a test like the other
allowlisted aggregates.

## Components

1. **`rss-sync` (Rust, `apps/rss/sync-rust`)**. Reads `/v1/feeds`, `/v1/categories` and pages
   through `/v1/entries` (`limit`, `offset`, `order=id`, `direction=asc`). The first
   run takes everything; later runs use `changed_after` with an overlap and upsert by
   Miniflux entry id, so running twice changes nothing. The raw API answer of the
   first full run is landed unchanged under `.data/raw/miniflux/<date>/`. Item text
   (`content`) is not stored in the database.
2. **`db/rss.sql` and its migrations folder**, a registry entry for the new domain.
   Tables: `rss_feed` (id, title, site url, feed url, category), `rss_entry` (id,
   feed id, title, url, published at, read, starred, reading time, hash), and
   `rss_source_weight` (feed id, weight) for the hand-set weights. A table another
   app reads goes in `packages/contracts/rss-tables.ts`; none is read yet.
3. **`packages/rss` (TypeScript)**. `rank.ts`: score = source weight x freshness
   decay x what the title is worth (a major version 3, a minor 1, a patch or helper package 0) x (1 + 0.5 per extra feed with the same story). Same story means normalised title word
   overlap across different feeds inside a time window. `sections.ts` sorts a feed into
   releases, articles, news or commit feeds; each kind has its own half-life and its
   own list on `/toppsaker` (6, 10, 10 items), and commit feeds are not ranked. A cap per feed
   (not per category) keeps one source from taking a list. The category «Artister i nyhetene»
   is kept out of the pages and read only by music (`mentions.ts`). `stats.ts`: counts per source, category and month. Pure functions with
   tests for the branches (grouping, decay, cap).
4. **`apps/rss`**. `server/api.ts` holds the SQL (named constants) and `queryRows`
   with valibot row schemas; `appApiHandler` answers `GET /api/*.json`; snapshot
   files are per month for items (so no file is large) plus `toppsaker.json` and
   `statistikk.json`. Pages: `/` (all items, newest first, category filter as a
   search param via `validateSearch`, plain links for paging), `/toppsaker`,
   `/statistikk` (counts with the shared chart components). Page links come from
   `appPages('rss')` in `packages/ui/src/lib/apps.ts`, which also gets the app
   entry (id in `APP_IDS`, a `group`, description, pages), its port in
   `scripts/apps.ts`, its colour in `theme.css` and rows in `og-pages.json`.
5. **Secrets**. The Miniflux API key is copied into this repository's `secrets/`
   like the other tools' keys (`npm run machine -- pull`), kept in step with
   `~/.config`. The existing read key `secrets/miniflux-export.env` in the
   nextcloud repository is the model; a separate read-only key is preferable.
6. **Timer**. The sync runs hourly with the other sync timers; the snapshot and
   deploy follow the usual publish timer.

## Data flow

Miniflux API -> `rss-sync` -> `.data/rss.db` (and `.data/raw/miniflux/`) ->
`npm run snapshot` (SQL, ranking, statistics, allowlisted aggregates) ->
`/api/*.json` static files -> deployed Worker -> server-rendered page. Pages work
without JavaScript; nothing here needs a script.

## Errors

- API unreachable or 401: the tool exits non-zero with `anyhow` context naming the
  call; nothing partial is committed (one transaction per page of items).
- A malformed item is skipped with a count in the run log (`platform`), not fatal.
- A feed removed in Miniflux keeps its stored items; a feed row stays so old items
  keep their source name.
- Empty snapshot (no rows): the pages show an empty state, never an error.

## Tests

- `rank.test.ts` and `stats.test.ts`: decay, same-story grouping, category cap,
  release bonus, ties.
- Importer idempotency in Rust: the same fixture twice gives the same rows.
- Snapshot allowlist test: no read, star or content field can reach a snapshot.
- `contracts.test.ts` and the repository layout tests as for any new app, plus a
  `e2e` row in `pages.ts` and `e2e/no-js.spec.ts` coverage.

## Not done, on purpose

- No LLM summaries or ranking (cost, an external service, and rules come first).
- No write back to Miniflux (apps read, they do not write).
- No item text published (copyright, and not needed to read titles and links).
- No private variant behind Cloudflare Access; the page is public by decision.
- Ranking weights are first guesses and need tuning after a week of real data.

## Open

- Tuning: `FEED_WEIGHTS` are hand-set by feed title. Ideas, none decided: weights from
  what is read and starred (`rss_source_weight` exists for it), a weight per category for
  new feeds, a capped bonus for a story many feeds repeat, and a looser same-story match
  for Norwegian compounds.
- Settled since the first design: the key is a read-only one in `secrets/rss-sync.env`;
  the first weights are in `packages/rss/src/weights.ts`.
