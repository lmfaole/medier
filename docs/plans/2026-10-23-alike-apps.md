# Plan: the media apps show the same things, at the same depth

> **For agentic workers:** use superpowers:executing-plans (inline). One task per commit; every task ends with
> `npm run verify`, the browser test of rule 4 for each app it touches (desktop, phone, scripts off) and a deploy of those
> apps (rule 7). Read `docs/UI-COMPONENTS.md` and `packages/ui/src/components/stats-overview.tsx` first.

**Goal:** film, tv, games, books, boardgames, podkast and music answer the same questions on the same pages with the same
building blocks. What differs is the data an app has (a game has no cast; a podcast has no genre), never the *shape* of
the page. A reader who knows one app finds everything in the same place in the next.

## Where they differ today (2026-10-23)

Read from `pages/*` and `packages/{watch,shelf}`; ✔ = there, – = not there, ◐ = there in another form.

**Front page**

| Block | film, tv (`watch`) | games, books, boardgames (`shelf`) | podkast | music |
| --- | --- | --- | --- | --- |
| Four totals | ✔ | ✔ | ✔ | ✔ |
| Per year (or per month) | ✔ year | ✔ year | ✔ year | ◐ month |
| Running total | ✔ | – | – | – (removed 2026-10-23) |
| Per weekday | ✔ | – | – | – (removed) |
| Per hour of the day | – | – | ✔ | – (removed) |
| Genres, decades, countries | ✔ ✔ ✔ | ✔ ✔ – | – | ✔ ✔ area |
| Who leads (people, creators) | ✔ actors, places | ✔ creator | – | – |
| Best rated | ✔ | ✔ | – | – |
| Latest | ✔ | ✔ | ✔ | ✔ |
| Loved / owned | ◐ collection | ◐ collection | – | ✔ loved |

**Top lists:** film 11 lists, tv 9, shelf 4 (best, creators, genres, decades), podkast 2, music 3 (a board, not lists).

**One item's page:** watch has hero, four tiles, sentence cards (seen, cast, crew, keywords, when); shelf has hero, five
tiles, one fact list, the log, the collection, achievements (games), and `WorkExtras`; podkast has hero, four tiles, a
sentence per kind; music has hero, 5–7 tiles, genres, years, rows and a collection card.

**Month, day, history, library:** all on shared shells already (`CapsulePage`, `MemoriesPage`, `HistoryPage`,
`LibraryPage`), but the *content* inside differs (music lists artists/tracks/new/quiet; watch lists best/lead/new; shelf lists best/creators).

## The standard

One definition of a **media app page**, in `packages/ui`, that every app fills in. Three levels, each with a fixed set of
blocks and a rule for what an app does without the data:

1. **Front page** = `StatsOverview` + *Time* (per year; and per month when the log has two years or more) + *Cumulative*
   + *Rhythm* (weekday, and hour of the day when the data has times) + *What it is made of* (up to three breakdowns, an app
   picks from genre, decade, country/area, creator) + *Who leads* (people or creators) + *Best* + *Latest*. A block with no
   data in an app is left out, never replaced by something else.
2. **Top lists** = the same set of lists as the front page's breakdowns, ranked, plus *Best* and *Seen again/Played
   again*, for a period. Always `RankedList` or `RankedBarChart`, never an app's own board.
3. **An item's page** = hero, the same four tiles (*played/seen*, *time*, *first*, *last*) + *rating* and *owned*, a
   facts list, *when* (the dated plays), *collection*, then the app's `extras`. One `EntityView` for every kind.

## Tasks

- [ ] **1. Decide the data.** Inventory made 2026-10-23 from the databases and the snapshots (`NN / total` = lines that
  have it). **Confirmed by the owner 2026-10-23, with one change: a block without data is left out, not replaced by a sentence.**

  | | film | tv | games | books | boardgames | podkast | music |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Lines in the log | 334 | 2 958 | 27 | 16 | 9 | 153 actions | 157 000 listens |
  | Dated (a day) | 52 | 2 073 | 10 | 2 | 0 | all (with time) | all (with time) |
  | Rated | 0 | 0 | 0 | 2 | 0 | – | – |
  | Minutes or an amount | ✔ minutes | ✔ minutes | ✔ hours | ✔ pages (0 so far) | – | ✔ minutes | ✔ minutes |
  | Hour of the day | – | – | – | – | – | ✔ | ✔ |
  | Genre | ✔ | ✔ | ✔ | ✔ | – (mechanics instead, from BGG) | – | ✔ |
  | Decade | ✔ | ✔ | ✔ | ✔ | – | – | ✔ |
  | Country / area | ✔ | ✔ | – | – | – | – | ✔ (area) |
  | Creator who leads | director | creators | developer | author | designer | (the show) | artist |
  | People (cast) | ✔ | ✔ | – | – | – | – | – |
  | Places | cinemas | networks | – | – | – | – | – |
  | Loved / owned | owned | owned | owned | owned | owned | – | loved, owned |

  What this says: **the apps differ in how much is *dated*, not in what *kind* of data they have.** Film, tv, podkast and
  music have enough dated lines for time blocks (year, month, weekday, running total); games, books and boardgames have
  10, 2 and 0 dated lines, so a per-year chart there is a single bar or nothing. Ratings are 0 in most of the apps, so
  *Best rated* is empty until the owner rates. **Rule (decided):** a block is *in the standard* for every app, and an app shows it when it has at least two
  buckets with data (two years, two weekdays, two genres); otherwise it is left out. The page is the same shape wherever
  the data allows it, and never has an empty chart.
- [x] **2. One front page (done 2026-10-23).** `MediaOverview` in `packages/ui/src/components/media-overview.tsx`, blocks decided by `lib/media-blocks.ts` (`enough`: two buckets with data). A separate per-month chart was dropped: months with no plays are missing from the data, so it spiked; years (from `years`, or summed from `months`) and the running total carry the time.  Build `MediaOverview` in `packages/ui` from the blocks above; `watch`'s `OverviewPage` and
  `shelf`'s are replaced by it, and `music` and `podkast` use it directly. The weekday, cumulative and hour blocks come
  back for music as shared blocks (their API is `summary` rows the sync no longer writes: see Task 3).
- [x] **3. (done) Give the data back where a block needs it.** Music's weekday and clock tables were removed on 2026-10-23
  because nothing read them. They did *not* come back as tables: `rhythm.json` is read from `listens` when the snapshot
  is written (a deployed Worker never reads it), and podkast got `months` and `weekdays` in `overview.json`. Likewise a running total for shelf and podkast is derived on the page from months (no sync change).
- [x] **4. (done) One top-lists page** (`@designsystem/ui/components/top-lists-page`; sections are given as a render prop). `TopListsPage` takes a list of sections (as `watch` does with `words.lists`); shelf,
  podkast and music supply theirs. Retire music's `chart-board` (`.css` and `.tsx`, 320 lines) in favour of the shared
  `RankedList`, with a cover on each row.
- [x] **5. (done, smaller than written) One tile set for the item page**: `LogTiles` (`@designsystem/ui/components/log-tiles`) gives count, time, first, last, rating and owned in that order, leaving out what is not known; watch, shelf, podkast and music use it. The bodies themselves stay per kind (a film has a cast, a song has hours): merging them into one `EntityView` would have been a union of branches, so only the shared part is shared.  `EntityView` for all of it; the shelf and watch pages become two sets of `extras`; music's
  three bodies and podkast's two become `extras` too. The tile set is fixed in the shared page.
- [x] **6. (done, in the part the data allows) One month page**: `MonthSections` (`@designsystem/ui/components/month-sections`) fixes the order (summary, what led, who made it, what was new, what went quiet); each app fills the parts it has. Every app now has «new» and «gone quiet»: `monthMovers` (`@designsystem/intl/month-movers`) counts them from the log for film, tv, the shelf apps and podkast (a name is the one who made it: director, creator, developer, author, designer, show; quiet = last month this one, at least 3 plays, and 3 months before the newest); music keeps its Rust version (at least 15 plays). Day and history were already on shared shells.  Each lists *Best*, *What led*, *What was new*, *Who went
  quiet* where the data has them, in that order.
- [x] **7. (done) A test that holds it**: `scripts/media-apps.test.ts` fails when a media app lacks a standard route, draws its own front page or top lists, or has a stylesheet of its own.  `scripts/media-apps.test.ts` loads each app's page set and fails when an app adds its
  own block outside the standard (an unregistered chart, a page with its own board), the way `motion-rules.test.ts` does.

## Not done, and why

- Making the data equal: a podcast has no genre and will not get one. The standard leaves the block out; it does not invent it.
- `work` and `forside`: public, one page each, outside the media registry.
- Merging the `watch` and `shelf` packages (decided against in `2026-10-23-one-log-layer.md`): the counting differs; this
  plan changes what is *shown*, not how it is counted.

## Verification

Each task: `npm run affected`, `npm run verify`, the pages of every app it touches at 390 and 1280 px and with scripts
off (`npm run page-check`, then the browser), and `npm run e2e` for Tasks 4–7. A final screenshot set of one page per
app side by side, compared by eye.

**Status 2026-10-23: tasks 1–7 done.** Left open, by decision: the item page bodies stay per kind (Task 5).
