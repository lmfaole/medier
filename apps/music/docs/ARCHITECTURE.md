# Architecture

## Why the sync runs outside the Worker

Cloudflare Workers on the Free plan have a fixed 10ms CPU-time limit per
request, and the plan does not allow raising it (`wrangler deploy` refuses a
`limits` block on Free). A `GROUP BY` over years of listening history to
recompute "top artists this year" would not reliably fit in that budget, but
reading one already-computed row does.

So the expensive work — pulling new listens from ListenBrainz and
recomputing the summary tables — runs in `sync-rust/`, on the owner's machine, which has no such
CPU limit. The Worker (`web/src/server.ts`, its API in `web/src/pages/api/`) only ever answers from the
precomputed tables.

This mirrors the sibling apps that precompute their API as
static JSON for the same reason, just scheduled instead of built once.

## When a sync fails or does not run

GitHub starts scheduled workflows late, and sometimes not at all. That
costs freshness, not data: the next run fetches everything newer than the
bookmark in `sync_state`, and `INSERT OR IGNORE` on `listens`' primary key
makes fetching a listen twice harmless. The walk goes oldest first
(`min_ts`, the 1000 listens right after the bookmark), and the bookmark is
written after every page, so an interrupted run resumes from the last page
it wrote; a full-history backfill gets further with each run. A full page
re-reads its last second, in case several listens share it
(`listenbrainz::next_cursor`). Each period's summary, clock and
coverage rows are replaced in one D1 batch, so a failed recompute leaves
the previous numbers in place rather than an empty period.

A listen older than the bookmark, such as a Last.fm import into
ListenBrainz, is never fetched by a normal run. To pull those in, set
`sync_state.last_listened_at` to 0 and run the workflow; it jumps to the
user's first listen (ListenBrainz answers nothing for a `min_ts` long before
it), walks forwards and skips what is already there.

## Data flow

```
ListenBrainz API  --(sync-rust, scheduled)-->  D1: listens, sync_state
ListenBrainz metadata  --(same run)-->         D1: recording_metadata,
                                                   recording_genres
                                                    |
                                                    v  (sync-rust, same run)
                                      D1: summary_periods, top_items, top_item_covers,
                                          breakdowns,
                                          metadata_coverage
                                                    |
                                                    v  (cheap reads only)
                                       Cloudflare Worker  -->  React dashboard
```

1. `sync-rust` applies `db/schema.sql` (every statement is idempotent), so a
   new table never needs a manual `db:schema` before the code using it.
2. It reads the bookmark from `sync_state`, fetches every listen newer than
   it from the public ListenBrainz API, and inserts them into `listens`.
3. `enrich` asks ListenBrainz' `/1/metadata/recording` (50 per request,
   within the rate limit, at most 3000 per run) about the recordings of the
   listens added since the last run, tracked by a rowid cursor in
   `enrich_state`, so it never rescans the history: first release year,
   length, the first credited artist's area and type, cover art IDs, and up
   to three genres. A recording ListenBrainz knows nothing about still gets an
   empty row. A first backfill of a long history is spread over several runs,
   each continuing at the cursor.
4. Summaries are recomputed per `Target` (`sync-rust/src/target.rs`), by a
   separate job each, because listens are only appended and D1's free plan
   caps rows read per day. `summaries <target>` writes `summary_periods`,
   `top_items` (top 25, and their album covers in `top_item_covers`),
   `breakdowns` (genre, decade, artist area, month) and `metadata_coverage` for the periods of the target:
   `current-year` (and the year before in January) daily, `all` weekly,
   `years` only after a backfill. `rolling` (`last-7-days`, `-30-`, `-90-`,
   `-365-`, top lists only) runs daily. `daily-plays <target>` rewrites
   `daily_plays` and `daily_listening_time` (milliseconds, so days add up
   exactly) from the target's start on, and `all-time-totals` refreshes the
   all-time listen count, minutes and streaks from those two tables (about a
   thousand rows each) so they stay current between the weekly runs of `all`.
   The minutes are left alone until every day has a listening time, so
   `daily-plays all` (weekly, or by hand) backfills the table first.