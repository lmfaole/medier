# AGENTS.md

Instructions for coding agents anywhere in this repository, **which is public**: never commit a key, a token, a password or the data.
The private half (the keys under `secrets/`, the copy of the data `data-dump/`, the home apps and the machine's own scripts) is the private
repository `lmfaole/monorepo`. For humans:
`README.md`. Each app has its own `apps/<name>/AGENTS.md` with what is
specific to it (its data flow, its files, its commands); this file holds the
rules every app shares, so they live in one place and cannot drift apart.

## UI work follows the design system's skills

Before building or changing anything a person sees, use the skills in `.claude/skills/` (installed from the design system with
`npm run skills`, checked by `npm run skills:check` in `verify`; do not edit them here, change them in the design system; `npm run ds:bump` moves every app to a newer design system and installs its skills): `designsystem-ux` (levels, the front page as a digest,
navigation, breadcrumbs, subpages), `-ui`, `-hierarchy` (one reading column, order is priority), `-accessibility`, `-content`, `-components` and
`-review` (run before UI work is called done). The model for navigation is `docs/NAVIGATION.md`.

## What this repository is

What the apps share on top of the design system (`packages/ui`; the design system itself is `@lmfaole/designsystem`, a repository of its own), tooling config (`packages/config`),
formatting helpers (`packages/intl`), the counting every watch-log app shares (`packages/watch`) and the one the shelf apps share (`packages/shelf`),
Rust data plumbing (`crates/shared-data`)
and the apps built on them (`apps/music`, `apps/podkast`, `apps/film`, `apps/tv`, `apps/games`, `apps/books`, `apps/boardgames`, `apps/medier`, `apps/work`, `apps/forside`), each a page in
`web/` on Astro with React islands, rendering on the server. The seven media apps (music, podkast, film, tv, games, books, boardgames) are Astro on Node and run
in **one server on this machine** (`scripts/media-server.ts`, the `media` container, `docs/MEDIA-SERVER.md`), with their hub `apps/medier`, which lists them and shows the latest entry of all of them in one timeline (the loader is `packages/timeline`, shared with forside's `/medier`); `forside` and `work` stay Cloudflare Workers. RSS (Miniflux, the sync and the top stories) is no longer here: it lives in the nextcloud repository (`scripts/rss-*.ts`), and `/apps/rss` and `/apps/medier/rss` only redirect to the Miniflux page.
**There is no connection to a database outside this machine.** The data is one
local SQLite file per data domain under `.data/` (`db/<domain>.sql`, `docs/DATA.md`):
`music`, `podcasts`, `film`, `tv`, `games`, `books`, `boardgames`, `github`, `cv`, `accounts`, `photos`, `site` and
`platform` (the run log). The content that is edited by hand (cv, accounts, photos, page
previews, the glossary) is one table per collection, described once in `packages/content`,
which writes the four content files. The media server opens the databases read-only and answers `/api/*.json` from them live; a deployed Worker (`forside`, `work`) has no database or bucket binding:
`npm run snapshot` writes its `/api/*.json` as static files from the local files
and the deploy, run by hand or by a publish timer, ships them. The pictures are files in
`web/public/media/`.

## Names that look alike

`@lmfaole/designsystem` is **the design system**, a repository of its own that every app pins by commit (`npm run ds:bump`). `@designsystem/*` (`ui`, `config`, `intl`, `content`, `watch`, `shelf`, `contracts`, `timeline`) are **this repository's** workspace packages, named before the design system moved out; they are not the design system and are not published. A component that knows nothing about these apps goes in the design system, one that does goes in `@designsystem/ui`. A rename would touch every import, so it waits until it earns that.

Times: the design system's `Time` and `describeTime` tell a time relative to a `now` they are given (rounding to the nearest unit); `@designsystem/intl/time` writes models' times in fixed styles and `formatSince` floors. The two are kept apart on purpose until their rounding is chosen once; do not add a third.

## The goal

This machine is meant to be **home for all data about the owner**: fetched from
each source's API where one exists, imported from the source's own export where
it does not, self-hosted where that is worth running (Immich, Nextcloud and RomM: each has its own repository, `docs/MACHINE.md`; this repository only reads what they expose), and only
*read* from an API where the data is public. Cloudflare holds the code and snapshots of the two public apps,
not the record. Not every source is here yet; what each source is and how it arrives is
`docs/DATA.md`. **The processed data has a second copy in git, in the private repository**: `data-dump/<domain>/<table>.jsonl`, written by `npm run data:dump`
and read back by `npm run data:restore`; it is ignored here and is never committed to this public repository. **The raw originals under `.data/raw/` have no backup unless one is run**
(`npm run backup` with `BACKUP_DIR` on another disk; it has no default): treat `.data/` as irreplaceable, never delete or rewrite a landed
original, and say so when a change could lose data.

## Keeping token use low

- Start with `npm run repo:map -- <app>`; read a file by line range (`offset`/`limit`) when you know where, not whole.
- Never open or grep `data-dump/`, `.data/`, `target/`, lockfiles or `packages/content/src/generated/` (denied in `.claude/settings.json`, skipped by `.rgignore`). Ask the database with `data:query`, or read the collection spec instead of the generated rows.
- Run `npm run affected` between edits and `npm run verify` once at the end; read the short answer, open a log in `.data/tmp/verify/` only for a failure.
- Do the work inline. Spawn a subagent only for a search that would otherwise read many files, and say what it must return.
- Keep this file and the memory index short: a fact the code, git or a `docs/` page already holds is linked, not repeated.

## Commands

Run from the repository root. The full list, with every flag, is `docs/COMMANDS.md`; read it when you need a command that is not here.

```sh
npm run repo:map -- <app>  # an app in thirty lines from the tree and its AGENTS.md; read it before exploring
npm run affected     # lint, typecheck and tests of only what changed: the loop between edits
npm run verify       # the whole "done" gate in one short answer; whole logs in .data/tmp/verify/
npm run page-check -- <app> [<path>…] [--built]  # a page in Chromium, desktop and phone, in a few lines
npm run data:query -- <database> "SELECT …"      # one read-only question to .data/<database>.db, 50 rows at most
npm run ship         # rule 7: deploy the apps the last commit changed (`-- <app>…`, `--dry-run`)
npm run data:dump    # every database as text under data-dump/: commit it after a change to the data
npm run land -- <source> <file|folder>  # an export kept as it came, under .data/raw/ (never moved, never overwritten)
npm run generate --workspace @designsystem/content   # row schemas and types from the collection specs
cargo clippy --workspace -- -D warnings && cargo test --workspace   # when Rust changed
```

`apps/<name>` is not an npm workspace, only `apps/<name>/web` is (and `packages/*`); the root scripts reach both halves of an app through `scripts/run-apps.ts`. Nothing builds or deploys on a push: the media apps are built with `npm run media:build` and served by restarting the `media` container (`docs/MEDIA-SERVER.md`); a Worker (`forside`, `work`) is deployed with `npm run deploy` in its app, from the machine that has `.data/`.

## MCP servers

`.mcp.json` connects Claude Code to documentation only; no server reaches a
database, a bucket or Worker logs, and the apps read no service outside this
machine (the media server asks the owner's own Nextcloud on this machine to check a login):

- `cloudflare-docs`: current Workers documentation, instead of recall.
- `context7`: version-matched library documentation.
- `tanstack`: TanStack Charts/Virtual/Table docs search. Needs an API key
  from tanstack.com/account/api-keys in `TANSTACK_API_KEY`.

GitHub goes through the `gh` CLI, which is already authenticated.

## Rules

- **English for code, everywhere.** Identifiers, comments, commit messages,
  docs. On-screen text is Norwegian (bokmål, `lang="nb"`, `nb-NO` for dates and numbers); the
  generated shadcn components in the design system's `src/components/ui/` keep their English sr-only text. Existing
  Norwegian identifiers are a backlog. See `docs/CONVENTIONS.md`.
- **Refactor on contact.** A file you are already editing that breaks a rule
  here gets fixed in the same change, scoped to that file. Same doc.
- **One job per file.** New code goes in the file that already owns the
  job; if none does, create one. No barrel or `index` re-export files. An
  app's `web/src/server/api.*` holds the SQL and `web/src/pages/api/[...file].ts` the
  one endpoint, never the other way round.
- **One language per layer.** TypeScript (`.ts`/`.tsx` only, no `.js`,
  `.mjs` or hand-written `.d.ts`) for the browser, Workers, scripts and
  packages. Rust for offline tools that sync or fetch (music's sync,
  the GitHub and podcast tools); it owns the types of what it writes to the local database. SQL in
  one `db/<domain>.sql` per database at the repository root. No workers-rs/Wasm and no
  Rust UI: serving is I/O-bound and Astro would be lost. Scripts stay TS
  because CI and the apps run them without cargo. The one known exception is
  `packages/config/cloudflare-workers.d.ts`, which stands in for
  `@cloudflare/workers-types`; nothing new is added to it.
- **Types are checked at every boundary, never asserted.** Database rows go
  through `queryRows` (`@designsystem/config/d1-query`) with a valibot
  schema; static JSON from the asset store through `assetJson`. Content
  has its row schemas, types and tables generated from the collection
  specs (`packages/content/src/generated/rows.ts`, committed, never
  hand-edited: change the spec and run `npm run generate`), and every row a
  Worker reads is parsed with them. A type that exists in both Rust and TS is
  generated from Rust with ts-rs into `web/src/generated/`, and the schema
  `satisfies` it. music has no Rust struct per table, so its schemas are the
  source.
- **Data about the owner is kept, not just shown.** A new source lands its
  original unchanged under `.data/raw/<source>/<date>/`, is imported by an
  idempotent Rust job, and is written to the database of its domain under `.data/`
  (a new domain is a new `db/<domain>.sql`, its migrations folder and a registry entry). API first, export
  second, hand entry last. Location, health, mail, messages and money, and
  anything that names other people, are **never** in a snapshot shipped to
  Cloudflare, so `forside` and `work` never show them. A media app runs on this machine
  behind the Nextcloud login and may show them, but only when it is asked for and
  decided in its own AGENTS.md.
- **Pages are rendered on the server, and JavaScript may be required.** Astro renders each page on the server (a media app in the Node server, reading the local database; `forside` and `work` in the Worker, reading the snapshot in the asset store), so the first paint
  and the HTML crawlers see have the content. A page is HTML and only what needs a browser is an island, hydrated with the
  narrowest directive (`client:visible`, `client:idle`); the island scripts are allowed in the CSP by hash (`inline-script-hashes.ts`). Nothing promises that a page works with scripts off: no `<noscript>`
  fallbacks, no hidden-without-script markers. A first render must match on server and browser (no clock or random
  in it); `e2e/smoke.spec.ts` fails on a hydration message. The theme follows the device (`prefers-color-scheme`),
  and counting up is CSS.
- **Apps read; they do not write.** For a visitor. A page asks its own server for
  `/api/<file>.json`, and a media app answers from the local database, opened read-only
  (`readOnly` SQLite; no table is written by anything the server serves); `forside` and `work` answer from the snapshot of those same files once deployed,
  where the Worker has no database binding at all. Nothing an app serves writes to a table here:
  the data is written offline, by the Rust sync tools and `packages/content`'s
  seed. A write a page needs goes to the API of whoever owns the data, never to
  a table in `.data/`. So an app's whole data layer is its `server/api.ts` and
  `appApiHandler` (`@designsystem/config/app-shell/api`) — one handler, and it
  is a `GET`.
- **One schema through the stack.** The row schema types the server's
  `API` map; `ApiResponses` is `ApiResponsesOf<typeof API>`, and the app's `server/responses.ts` holds a valibot
  schema per API file (`RESPONSES`) that `satisfies` it. A page reads with `readApi(url, file, RESPONSES.<file>)`
  (or `readPage` for the standard pages) and gets the parsed value; its `?query=` goes through a valibot schema
  (`lib/*-search.ts`, `slug-params.ts`); a link to a thing is `pageHref` (its page, `/<kind>/<slug>`).
  Nothing is cast between those layers.
- **No copied code.** The same logic in two apps goes in `packages/*` or
  `crates/shared-data`; a component in two apps goes in the design system (`@lmfaole/designsystem`) when it is generic and in `packages/ui` when it knows about these apps. An
  app never imports another app's source — that is what the shared packages
  and crates are for, and `scripts/cross-app-imports.test.ts` fails on any
  import that leaves an app. `npm run dupes` fails above the threshold in
  `.jscpd.json` (0.5 %); lower it when a change removes copies, never raise
  it to make room for one.
- **Cross-app data has one owner and one contract.** Content is
  described once, in a collection spec in `packages/content`; whatever reads
  it (any Worker) imports that, never a copy. In a database, a table
  another app reads has its SQL and valibot schema in
  `packages/contracts/<owner>-tables.ts`, imported by owner and readers, and
  `contracts.test.ts` checks it against the owner's `db/<owner>.sql`. In Rust, an
  app whose data another reads exposes its models from a `lib.rs`.
- **Apps reach UI primitives only through `packages/ui` and `@lmfaole/designsystem`.** oxlint's
  `no-restricted-imports` blocks `radix-ui`, `@radix-ui/*`, `class-variance-authority` and
  `lucide-react` in `apps/*/web`; icons come from `@lmfaole/designsystem/lib/icons`. Charts are `column-chart`,
  `ranked-bar-chart` and `area-chart` (`@lmfaole/designsystem/components/`), on TanStack Charts,
  themed through `chart-frame.tsx`.
- **SQL lives in named constants**, not inline in functions.
- **Comments explain why, never what, in at most three lines** inside code.
  Module comments (`/** … */`, Rust `//!`) may be longer. Never comment out
  code; delete it.
- **Rust errors** use `anyhow::Result` and `.context(...)` at the call site
  that knows what failed.
- **Motion comes from the design system.** `motion.css` there (imported by its `theme.css`) holds the durations and easings, the `--motion-*` tokens; entrances move and never fade text, and everything is
  off under `prefers-reduced-motion`. See `docs/MOTION.md`;
  `scripts/motion-rules.test.ts` fails on a literal duration or an own
  `@keyframes` in an app.
- **Hooks start literally with `use`**; oxlint's `react/rules-of-hooks`
  depends on it.
- **CSS layout: grid with named areas before flex.** See
  `docs/CSS-LAYOUT.md`.
- **An app has no styling of its own.** No `className`, `class`, `style` or stylesheet under `apps/*/web/src`: a page is put together from `packages/ui` and design system components, and `scripts/design-system.test.ts` fails on anything else. See `docs/UI-COMPONENTS.md`.
- **Shared UI goes in the right place.** Generic UI (anything that knows nothing about this repository's apps or data) goes in the design system repository (`lmfaole/designsystem`) and arrives through a new tag; what is specific to these apps goes in `packages/ui`. Page chrome is `AppLayout` and
  `PageHeader`; theme and data hooks are
  `@designsystem/ui/lib/*`. Do not hand-roll a copy in an app. See
  `docs/UI-COMPONENTS.md`.
- **Navigation comes from the registry.** Which apps exist, their groups and
  pages are `lib/apps.ts` and nothing else (the library, `/bibliotek`, is optional: an app has it only if it lists `library` in its `features`): an app's front-page links are built from it, and a group's page of `forside` (`/media`) lists its apps. There is no header, no sidebar and no tab or bottom bar; the one piece of chrome is the breadcrumbs at the top of a media app's page (`AppBreadcrumbs`: Medier, the app, the page), and no app draws its own `<nav>` or menu. See `docs/NAVIGATION.md`.
- **Every app is read-only for visitors; the owner writes in Nextcloud's own apps.** `work` (`lmfaole.party/cv`; `jobb.lmfaole.party` only redirects there) and `forside` (`lmfaole.party`, `PUBLIC_APPS` in
  `scripts/apps.ts`) are public, indexable and stand outside the personal registry; the
  media apps sit behind the Cloudflare Access login with Nextcloud, check the owner's Nextcloud login themselves (the server answers nothing but `/healthz` without it) and are unlisted. Treat what a snapshot of `forside` or `work` holds as publishable,
  so nothing goes into a snapshot that the owner would not publish, and a private source
  (a private repository, location, health, mail, money) reaches one only as an allowlisted
  aggregate that a test proves. The deploy of `forside` and `work` refuses a `wrangler.jsonc` or built config that
  binds a database, bucket or key-value store (`forbiddenBindings`,
  `@designsystem/config/bindings-config`), and `workers_dev` and `preview_urls` stay
  `false`, so an app has one address. The media apps have no Worker and no `wrangler.jsonc` to guard. A preference that should follow the reader is
  `localStorage`: there is no user to key it by.
  **Owner input** is not built into the media apps or the public ones: a page that must take something from the owner would have to write from a public origin. What the owner enters by hand goes into a Nextcloud app (Forms for the film log) and the machine reads it (`npm run film:inbox`). The one exception is the home apps below. See `docs/CONVENTIONS.md`.
- **The home apps (innboks, hjem, penger, rss) live in the private repository**, and the rules below are theirs; the media server here mounts one
  when its `apps/<id>/web/src/server/api.ts` is on disk, so this repository builds and serves none of them. **They are owner-input UIs behind the login, and the one place a page writes.** They are moving here from the hjemmeserver app of Nextcloud (`docs/HOME-APPS-MIGRATION.md`; `HOME_APPS` in `packages/ui/src/lib/apps.ts`, mounted by the media server at the same addresses, `/apps/hjemmeserver/<id>`, so installed PWAs keep their identity). They read JSON files that the Nextcloud repository's exporters write (`Apper/*.json`, `APPER_DIR`, `docs/MEDIA-SERVER.md`), through the same `server/api.ts` seam as a media app but with `DOMAINS: []`. **A home app may WRITE only from the browser, straight to Nextcloud (WebDAV/OCS, with the owner's own session) or to the Miniflux proxy of the hjemmeserver app: the data owner's API, never through the Node server.** The server gains no write route for them (the `write` hook of `MountedApp` stays music's push alone), and nothing here copies what they write into `.data/`. Money, mail and network data (subscriptions, the AdGuard log, the devices at home) **may be shown in them**, because they are behind the login on this machine, and **are never in a snapshot** or any file shipped to Cloudflare. An app has `apps/<id>/web` (a workspace) only once it has code; until then it is an `AGENTS.md` alone.
- **Error pages are shared.** 404 and 500 come from the design system
  (`@lmfaole/designsystem/components/not-found-page` and `server-error-page`) and
  `@designsystem/config/error-pages`; see `docs/UI-COMPONENTS.md`.
- **`src/components/ui/` of the design system repository is generated shadcn/ui, and holds only
  what an app uses** (button, button-group, card, native-select, separator,
  skeleton, table). Add another there with `npx shadcn@latest add <component>` when an
  app needs it, delete one when nothing does; never hand-edit one.
- **TypeScript, and the compiler holds the line.** `strict` and
  `noImplicitReturns` are on in all three shared tsconfigs, and every app
  extends one, so a new app gets them for free. `oxlintrc.json` bans `any`, the
  non-null assertion, `@ts-expect-error` and `console.log`. Two consequences:
  prefer deriving a value over asserting it (`const x = y ?? default`, not
  `y!`), and never widen a type to make an error go away. The one documented
  exception is the generated shadcn directory, listed as an `override` in
  `oxlintrc.json` with the reason.
- **Tests** are `*.test.ts` next to the module, run with `node --test`
  (Node strips the types itself, no build step). They are typechecked with
  the code they test, under the same rules. Worker test doubles (the asset store, the edge cache,
  `fetchPath`) come from `@designsystem/config/worker-test-kit`, never a local
  copy. **Test the logic, not the change that made it.** What earns a test is a
  parser or a calculation with branches, a boundary that keeps access or data
  safe (what a snapshot may hold, a name that must be refused), an import or a sync that
  must be idempotent and lose nothing, and a contract between two layers that
  nothing else checks. What does not: configuration, wording, CSS text, the
  shape of the repository, a second test of what one already pins, and a test
  that exists only because a bug or a feature once did. One test per behaviour,
  in the module that owns it; the browser suite (`e2e/`) is for what only a
  browser shows.

## What not to change without saying so

- Secrets. This repository is public: no key, token or password is ever committed, and `secrets/` and `data-dump/` are in `.gitignore`.
  The sync tools read their keys from `~/.config` on the machine; their copies are kept in the private repository. A Cloudflare API token or
  anything else for a workflow is a GitHub Actions secret.
- The home apps' addresses: `/apps/hjemmeserver/innboks`, `/apps/hjemmeserver/hjem`, `/apps/hjemmeserver/penger` and `/apps/hjemmeserver/miniflux` (RSS), each installed as its own PWA with `id`, `start_url` and `scope` equal to that address (`pwa: 'app'` in its `astro.config.ts`); changing one breaks the installed copies. None needs a tunnel change: the tunnel's one rule (`TUNNEL_PATH_REGEX`, `docs/MEDIA-SERVER.md`) sends the whole `/apps/hjemmeserver/` prefix here, the server serves what it mounts and proxies the rest to Nextcloud (`scripts/media-proxy.ts`).
- An app's address: `/apps/medier/musikk` for music, `/apps/medier/podkast` for podkast, `/apps/medier/film` for film, `/apps/medier/tv` for tv, `/apps/medier/spill` for games, `/apps/medier/boker` for books, `/apps/medier/brettspill` for boardgames, and the hub at `/apps/medier`, all on `sky.lmfaole.party` (the tunnel's one rule `^/apps/(medier|hjemmeserver|musikk|podkast|film|tv|spill|boker|brettspill|rss)(/|$)` (`TUNNEL_PATH_REGEX`, never added to) to `http://media:3000` and the `base` in the app's `astro.config.ts` have to match it; the old `/apps/<slug>` addresses are answered 301 to the new ones by the media server, and `/apps/medier/rss` and `/apps/rss` (RSS left the media apps) 301 to the RSS page of the hjemmeserver app, `/apps/hjemmeserver/miniflux/` (`RETIRED_BASES` in `scripts/media-registry.ts`)), `lmfaole.party/*` for forside (its `wrangler.jsonc` route), `lmfaole.party/cv` and `lmfaole.party/cv/*` for work (more specific routes; the custom domain `jobb.lmfaole.party` stays only to redirect there), and the Worker `name` of forside and work. A
  database or bucket binding must not come back outside the `local` env;
  `scripts/repo-layout.test.ts` fails when one does.
- `sky.lmfaole.party` is behind Cloudflare Access (Nextcloud). The media apps and the hub are paths of that host (`/apps/medier/<slug>`, `/apps/medier`), served by the `media` container through the tunnel, so they sit behind the same Access login as Nextcloud (and the server's own Nextcloud login check) and are private to the owner; there is no Bypass rule and none is needed (`forside` and `work` are on other hosts and stay public). Because of the login the manifest link is `crossorigin="use-credentials"` (a manifest is fetched without credentials otherwise, and Access answers 302). There is one installed PWA, the hub's (`pwa: 'hub'` in `apps/medier/web/astro.config.ts`, scope `/apps/medier/`): every media app is inside its scope and is a shortcut in its manifest; the media apps register the hub's service worker (`docs/NAVIGATION.md`). `forside` and `work` are not installable apps.
- Any one of the three not-indexed layers (`<meta robots>`, `robots.txt`,
  `X-Robots-Tag` from `@designsystem/config/security-headers`) of `music`. They only
  work together. `work` has none of them on purpose (`INDEXABLE_HEADERS`, `index` on `Document.astro`).
- `db/<domain>.sql`. It is the only copy of that database's schema (hand-written, except the
  four content ones, which `npm run generate` writes): the Rust tools apply it with
  `include_str!`, the snapshot applies it to the file it reads, and the tests build their
  SQLite from it. Which domain owns which tables is the file's name.

## Before saying a change is done

1. `npm run verify` passes (it runs `npm run lint`, `typecheck`, `npm test`, `build` and
   `dupes`, and the Rust checks of the next point when Rust changed).
2. When Rust is touched: `cargo clippy --workspace -- -D warnings` and
   `cargo test --workspace` pass, and `git status` shows no change under
   `apps/*/web/src/generated/` that is not committed with it.
3. Logic worth a test has one (see **Tests**); a change to such logic changes its test.
4. A change to what a page looks like or does (anything under `apps/*/web/src`
   or `packages/ui`) is **tested in a browser through the Playwright MCP**
   (`mcp__plugin_playwright_playwright__*`), always, not only when it seems
   risky: start the app with `npm run dev` in `apps/<name>`, open the page,
   exercise the change (navigate, click, fill, resize to a phone width where
   layout is involved), check `browser_console_messages` for errors and take a
   screenshot of the result. Typecheck and unit tests do not show that a page
   renders. Production is public, so the live page can be opened in the
   browser too; the test is still against the dev server first, and says so when a change can
   only be seen in production (the live snapshot, for example). `npm run page-check`
   is the quick first look (it counts as the browser test only for a change that needs no
   interaction, and says so); `npm run e2e` is the regression suite; neither replaces
   the MCP for exercising a change. When the MCP cannot start a browser
   (it wants Google Chrome in `/opt/google/chrome`, which needs root to install),
   drive the page with this repository's own Playwright and its Chromium
   (`npx playwright install chromium`, no root), and say that the MCP was not used.
5. The diff has no `console.log`/`dbg!`, no commented-out code, no files
   from an unrelated job.
6. Anything deliberately not done is written down, with a reason.
7. A commit that changes a media app or a home app with code (`penger`, `hjem`) is followed by `npm run media:build` and `systemctl --user restart media`; one that changes `forside` or `work`, by that app's `npm run deploy`,
   pushed or not.
