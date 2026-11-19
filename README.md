# medier

The public half of lmfaole.party: the media apps (music, podkast, film, tv, games, books, boardgames and their hub `medier`), the front page
`forside` and the CV `work`, with the packages, Rust crates and database schemas they share. The design system is `@lmfaole/designsystem`, a
repository of its own.

What is private stays in a private repository: the keys, the copy of the data, the home apps (money, network, mail) and the scripts that run the
machine. No data is in this repository: it lives on the owner's machine, in `.data/`, and the code here reads it there.

## The goal: this machine is home for the data about me

Everything that is about the owner is meant to live on this machine, as files
and SQLite databases under `.data/` and in self-hosted services (Immich, Nextcloud and RomM, each set up in its own repository: `docs/MACHINE.md`).
It arrives by the source's API wherever one exists, by the source's own export
where it does not, and is only *read* from an API where it is public. Cloudflare
carries the code and snapshots of the two public apps, not the record. Several sources are not
here yet; `docs/DATA.md` lists what is. There is no backup
yet, which is a known and accepted risk.

## The stack

Every app is one directory: a Node server entry (the seven media apps, all in one server on this machine, `docs/MEDIA-SERVER.md`) or a Cloudflare Worker serving a snapshot (`forside`, `work`), reading a local SQLite file, a page
built for the browser in `web/`, and — where an app ingests data offline — a
Rust binary. The pieces are shared, not copied:

- **TypeScript** for the browser, the Workers and the scripts; **Rust** for
  offline ingest, sync and the source of the data types (generated into the
  web app with ts-rs).
- **Astro, rendering on the server** as the frontend framework, with React 19 islands
  where a page needs a browser; a page reads its data with `readApi`, parsed by a valibot schema.
- **SQL in one `db/<domain>.sql` per database**, applied to its local `.data/<domain>.db`.
- UI only through the design system (`@lmfaole/designsystem`, shadcn/ui on Tailwind 4) and
  `packages/ui`, configuration
  through `packages/config`, formatting through `packages/intl`, and data
  through `crates/shared-data`.
- `forside` and `work` public (no login), the seven media apps and their hub `apps/medier` private (the owner's Nextcloud login) and built together with `npm run media:build`; `music`
  is unlisted from search engines and `work` is indexable.

Anything that would be duplicated in two apps moves into the shared packages
and crates instead of being copied, and an app never imports another app's
source.

### Why these choices

- **Content is described once** (`packages/content`) and lives in the shared
  database; the Workers share that description, and the row types and tables are
  generated from it. **Rust** owns the offline tools (music's sync, the GitHub and podcast tools) and
  the types of what they write, which ts-rs generates into the web app.
- **Rows are validated where they are read** (`queryRows` with a valibot
  schema), because a database hands back untyped rows by nature.
- **Pages are rendered on the server, and JavaScript may be required**: Astro renders each page on the server (the media server reads the local databases, the Workers of `forside` and `work` the snapshot in the asset store), so the first paint has the content.
  Only the parts that need a browser are islands.
  There is no promise that a page works with scripts off.
- **One `db/<domain>.sql` per database**, applied to its local file on every
  run, so a new table is an empty list and not a missing table. A changed column is
  a numbered migration in `db/migrations/<domain>/` (`docs/DATA.md`). No Worker
  has a database.
- **Serving stays in TypeScript, Rust stays offline.** The Worker, the pages
  and the scripts are I/O-bound and share one language; Rust is used where
  its cost pays — ingest, sync and the source of the data types — never for
  the UI, per the root `AGENTS.md`.

## Structure

| Path | What it is |
| --- | --- |
| `apps/music` | `sky.lmfaole.party/apps/medier/musikk`, a personal listening-history dashboard |
| `apps/forside` | `lmfaole.party`, the front page (a name, a sentence and links) and `/medier`, which lists the media apps; public and indexable |
| `apps/work` | `lmfaole.party/cv`, the CV, with the projects and their latest commit: public, indexable, outside the personal apps |
| `packages/ui` | What the apps share on top of the design system: registry, layouts, media pages (the design system is `@lmfaole/designsystem`, a repository of its own) |
| `packages/config` | Shared tsconfig, oxlint config, Astro preset and the Worker pipeline |
| `packages/intl` | Shared `Intl`-based date, number and plural formatting |
| `crates/shared-data` | Shared local-SQLite client and plumbing used by the Rust sync/crawl binaries |
| `AGENTS.md` | Rules for coding agents across every app; `CLAUDE.md` imports it, each app's own `AGENTS.md` adds what is specific to it |
| `docs/DATA.md` | Where the data lives, how it arrives and how it is published |
| `docs/MEDIA-SERVER.md` | Runbook of the media server: start, update, logs, health, rollback |
| `docs/CONVENTIONS.md` | Cross-repo naming, structure, refactor-on-contact and "Cloudflare holds no data" rules |
| `docs/CSS-LAYOUT.md` | The grid-over-flex, named-grid-areas convention every app follows |
| `docs/UI-COMPONENTS.md` | The Button Group convention for grouping related actions, and the modal-for-explanation pattern |

## Getting started

```sh
npm install
npm run build                 # builds every shared package and every app (Worker + web)
npm run lint                  # lints every shared package and every app (Worker + web)
npm run typecheck              # typechecks every shared package and every app
npm run check                  # lint plus each app's data sync checks, where it has one
npm test                       # packages/intl and every app's node --test suite
npm run dev:all                # every app's Astro dev server and Worker together
npm run dev:<app>              # one app's dev server, e.g. dev:music
cargo build --workspace        # builds crates/shared-data and apps/*/sync-rust
```

`apps/<name>` (the Worker, Rust data sync and data scripts) is deliberately not
an npm workspace — only `apps/<name>/web` is. The root scripts above reach
both halves of every app regardless, via `scripts/run-apps.ts`; see that
file's comment for why.

See `packages/ui/README.md` and `docs/CSS-LAYOUT.md` for the reasoning behind each
shared piece.
