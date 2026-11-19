# apps

Each subdirectory here is a standalone personal project in this monorepo,
sharing `packages/ui`, `packages/config` and `crates/shared-data` instead of
carrying its own copy of them. Every app keeps its own `package.json`,
`wrangler.jsonc` and deploy pipeline — they are deployed independently, not as
one combined site.

Common shape, shared across all of them:

- **Frontend**: `<app>/web/` — Astro rendering on the server, with React 19 islands,
  built on `@designsystem/ui`, `@lmfaole/designsystem` and `@designsystem/config`.
- **Data sync/import**: a Rust binary (`sync-rust/`) that
  writes to the local SQLite file of its domain (`.data/music.db`, `.data/github.db`),
  using the shared `shared-data` crate instead of a hand-rolled client. Not
  every app has one. Either way the writing
  happens offline on this machine: no app writes its own data, and the data
  about the owner is meant to live here (`docs/DATA.md`).
- **Serving**: a Cloudflare Worker (`web/src/server.ts`) answers API requests
  and serves the built frontend as static assets, per `wrangler.jsonc`.
- Public, no login: every app is readable by anyone, so what its snapshot holds is
  what the owner publishes. `music` stays out of search indexes and
  crawlers; see each app's own README.

The home apps (`innboks`, `hjem`, `penger`, `miniflux`) are being moved here from Nextcloud's hjemmeserver app (`docs/HOME-APPS-MIGRATION.md`); all four have code now (a `web/` workspace each, built by `npm run media:build`).

## Projects

| App | Domain | Data source | What it does |
| --- | --- | --- | --- |
| [`music`](music/README.md) | `sky.lmfaole.party/apps/medier/musikk` | [Last.fm](https://www.last.fm) API and Spotify's streaming-history export, synced by the Rust tool into `.data/data.db` (on systemd timers once installed, `scripts/sync-timers.ts`) | A personal listening-history dashboard |
| [`forside`](forside/README.md) | `lmfaole.party` | none | The front page: a name, a sentence and links; public and indexable |
| [`work`](work/README.md) | `lmfaole.party/cv` | `.data/cv.db` and the project commits of `.data/github.db`, as a snapshot of named columns | The CV, with the projects and their latest commit; public and indexable |

## Removed apps

budget, cv, accounts, photos, places and podcast lost their frontends and Workers on
2026-10-15. Their tables stay in their own files under `.data/`; their code, including the podcast and
photos Rust tools, was deleted on 2026-10-15 and is in git history.
