# music

A personal dashboard for my own listening history, at
[sky.lmfaole.party/apps/medier/musikk](https://sky.lmfaole.party/apps/medier/musikk/) — not indexed, not linked
from anywhere, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#keeping-the-dashboard-unlisted).

- **Data**: [ListenBrainz](https://listenbrainz.org), free and open.
- **Sync**: `sync-rust/`, run by hand, writes to the local database
  (`.data/music.db`) and recomputes the summary stats.
- **Serving**: the media server on the owner's machine (`docs/MEDIA-SERVER.md`) reads the local database, read-only, behind the Nextcloud login. (Until 2026-11 a Cloudflare Worker served a snapshot; that code is in git history.)
- **Frontend**: Vite, React, [shadcn/ui](https://ui.shadcn.com).

See [AGENTS.md](AGENTS.md) for commands and structure,
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for why it is built this way, and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for deploying.

## Structure

```text
music/
├── db/
├── docs/
│   ├── ARCHITECTURE.md      <- why aggregation runs outside the Worker
│   └── DEPLOYMENT.md        <- deploying and unlisted-dashboard details
├── sync-rust/
│   ├── Cargo.toml           <- Rust package for the sync job
│   └── src/                 <- sync entry point, ListenBrainz client, ingestion, aggregation, models
├── web/
│   ├── public/              <- static assets plus `robots.txt`
│   ├── src/pages/           <- one Astro page per route, the snapshot endpoint and the 404 (`views/` are the React islands)
│   ├── src/server/          <- the Worker: API queries, album covers, the shared pipeline
│   ├── src/server.ts        <- the Worker's entry
│   └── astro.config.ts      <- one build for page and Worker (`createAstroConfig`)
├── package.json             <- app scripts for dev, sync, schema, and deploy
└── wrangler.jsonc           <- Worker entrypoint, assets, and custom domain
```

## How it fits together

```text
ListenBrainz API -> sync-rust -> .data/music.db (`listens`, `sync_state`,
                                 `summary_periods`, `top_items`)
                              -> npm run snapshot -> static `/api/*.json`
                              -> Cloudflare Worker -> React dashboard
```

The expensive work happens in `sync-rust/`, run by hand, so the Worker only
serves precomputed files.

## Commands

```sh
npm install                 # from the repository root
npm run dev                 # page and Worker on http://localhost:5173, serving the snapshot (npm run snapshot first)
npm run dev:worker          # production build, then `astro preview` in workerd
npm run lint                # oxlint on web/
npm run typecheck           # TypeScript check for page and Worker
npm run build               # web/dist/client (page) and web/dist/server (Worker)
npm run sync -- <job>       # run one `sync-rust/` job in release mode, e.g. `listens` or `summaries all`
npm run snapshot            # the API as static files, from .data/music.db
npm run deploy              # snapshot, build and `wrangler deploy`
```

`npm run sync` needs `LISTENBRAINZ_USERNAME` in the environment and nothing
from Cloudflare; see [Deploy](#deploy) below for publishing.

## Routes and API

| Path | What it serves |
| --- | --- |
| `/` | The all-time totals and charts, with the recent and the loved listens. |
| any page `?open=artist/<slug>` | Opens an artist, album (`album/<slug>`) or song (`song/<slug>`) in a sheet over the page. |
| `/api/periods.json` | The available periods with precomputed summary data. |
| `/api/summary.json?period=...` | One period's summary: summary counts, streaks and breakdowns. |
| `/api/entities.json`, `/api/entity.json` | Everything that has a sheet (artists, albums, songs), and one of them (`?kind=&slug=`). |
| `/covers/...` | Album covers, proxied and edge-cached. |

## Not indexed

This dashboard stays unlisted through the same three layers described in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#keeping-the-dashboard-unlisted):
`<meta name="robots">` from the shared `Document` layout (`@designsystem/ui/layouts/document`), `web/public/robots.txt`, and
`X-Robots-Tag` from `@designsystem/config/security-headers`. The Worker also blocks known crawlers
before serving content.

## Deploy

> Superseded: music is built with `npm run media:build` at the repository root and served by the `media` container (`docs/MEDIA-SERVER.md`); there is no `wrangler deploy`, route or snapshot any more. The text below describes the retired Worker deployment.

`wrangler.jsonc` points the Worker at `web/src/server.ts`, serves static
assets from `./web/dist/client` (the build writes its own copy of the config
to `web/dist/server/wrangler.json`, which `wrangler deploy` uses), enables `run_worker_first` so headers and crawler blocking
also apply to asset requests, and the
`sky.lmfaole.party/apps/medier/musikk/*` route (the app is mounted under that path: Vite `base`, the router's basepath and `withBasePath` in the Worker all follow it). The deployed Worker has no database binding.

Music is deployed by hand: `npm run deploy` in `apps/music` writes the
snapshot of its API (one file per request the pages make, listed in
`web/src/server/snapshot.ts`), builds the app and runs `wrangler deploy`
(`scripts/deploy-app.ts`). Run a sync first to publish new listens.
