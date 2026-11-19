# Plan: one layer for the log apps, instead of two parallel packages

> **For agentic workers:** use superpowers:executing-plans (inline). Steps use `- [ ]`. Read `packages/watch/src/routes.tsx`,
> `packages/shelf/src/routes.tsx` and `docs/UI-COMPONENTS.md` before Task 1. One task per commit; `npm run verify` and the
> browser test of rule 4 for every app a task touches; deploy each app the commit changed (rule 7).

**Goal:** film and tv (`packages/watch`) and games, books and boardgames (`packages/shelf`) stop carrying two copies of
the same page plumbing, so a new log app is words and links, not a package, and a change to a page is made once.

## What the two packages really share

Measured on 2026-10-23 (`npm run dupes` at 0.72 %, `diff` of the page files):

| Part | watch | shelf | Same? |
| --- | --- | --- | --- |
| `routes.tsx` | route options per page | same, other names | the loader/pending/component wiring is identical; only the page components and the query set differ |
| `pages/{day,history,library,month,top-lists}.tsx` | 28–48 lines each | 22–54 lines each | the *shells* are already shared (`CapsulePage`, `SentenceCard`, `history-page`, `library-page` in `packages/ui`); the sentences differ |
| `pages/overview.tsx`, `pages/entity.tsx` | 122, 201 lines | 88, 72 lines | no: a *viewing* has people, places and rewatches, a *work* has a status, a rating and one creator |
| counting (`viewing.ts` 710, `shelf.ts` 422) | per viewing | per work | **no, and it should stay two**: the data models differ, a merge would be a union type with branches in every function |
| words (`words.ts`) | page sentences | nouns and labels | same idea, other fields |
| `SlugLink`, `countedItems` | in `watch` | `shelf` imports `@designsystem/watch/lists` | one is already borrowed from the other |
| Rust log (`shared-data` `watch_log.rs` 503, `shelf.rs` 669) | `Watch`, `Log` | `Entry`, `Shelf` | `read_file`, `replace`, `parse_*` are the same three functions |
| contracts | `watch-tables.ts` | `shelf-tables.ts` | repeated column groups |
| `tmdb.rs`, `trakt.rs` | film | tv | 295 changed lines of 493 in `tmdb.rs`, so mostly shared already; `trakt.rs` 211 vs 112 |

**Decision:** do not merge `watch` and `shelf` into one package. Pull the *seams* out instead: the route wiring, the
small shared types, the Rust log helpers, and the cross-app copies that need no new package. Counting stays per model.

## Tasks

- [x] **1. The small copies between apps.** Done for the board game page: it is the shared work page
  (`@designsystem/shelf/entity`, `WorkExtras`) with the register's facts added. Left as they are, on purpose:
  `baseline.ts` of music and podkast (the wiring of each app's own pages and queries: sharing it needs the same object
  passed in) and `links.tsx` of film and tv (`to="/film/$slug"` is typed against each app's own routes; a shared
  component loses that). Both are structural, not logic. `.jscpd.json` is at 0.7 %.
- [x] **2. `SlugLink` and `ItemLink` into `@designsystem/ui/components/item-link`, `readOnce` into
  `@designsystem/config/d1-read-once`**, so `shelf` no longer depends on `watch`. `countedItems` stayed: only `watch`
  uses it.
- [x] **3. One route factory (done smaller than written: `baselineRoutes` already held the generic wiring, so only the front page and the slug page moved, to `@designsystem/ui/lib/log-routes`).** `watchRoutes` and `shelfRoutes` take page components as arguments; the generic part (loader
  `ensureQueryData`, `pendingComponent`, the three search/param shapes) moves to `@designsystem/config/app-shell/log-routes`,
  and each package passes its pages. The five apps' route files do not change.
- [x] **4. Rust: `shared_data::log_file`** holds reading the file, appending checked lines and replacing the table, which
  `watch_log.rs` and `shelf.rs` each had. The parsers were already shared. `tmdb.rs` and `trakt.rs` of film and tv stay
  apart: what looked like copies is imports, and the Trakt push differs in what a play is (a film, an episode).
- [x] **5. Contracts.** Already split into shared fragments (`lineHead`, `collectionRowTail`); what `npm run dupes` still
  reports is a few like-named fields. Left.
- [x] **6. Music and work in Rust.** The clones are test set-up (`database()`, the schema test) and `use` blocks, not
  logic. Left.

**Status 2026-10-23: finished.** What this plan found worth sharing is shared; the rest are copies of shape, not of
behaviour.

## Not done, and why

- Merging `viewing.ts` and `shelf.ts`: different data models, see above. Revisit only if a fourth log kind shows up that
  fits neither.
- A generator for new apps (`npm run new-app`): worth it after Tasks 1–3, when what a new app needs is only words, links
  and a registry entry. Out of scope here.
- The per-app files TanStack Start requires (`router.tsx`, `__root.tsx`, `routes/api/$.ts`, `server.ts`, `tsconfig.json`):
  they are 6–13 lines and byte-identical, but the file-based router needs them in each app. Left as they are.

## Verification

Each task: `npm run affected` between edits, `npm run verify` at the end (build is red for an unrelated reason: three
packages have no `build` script; say so rather than hide it), `npm run dupes` lower than before, the apps it touches opened
at phone and desktop width and with scripts off, `cargo clippy --workspace -- -D warnings && cargo test --workspace` for
Tasks 4 and 6.
