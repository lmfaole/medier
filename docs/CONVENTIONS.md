# Conventions shared across every app

## Language: English, everywhere, no exception

Every app in this monorepo — prose, comments, identifiers, commit messages,
documentation — is in English. There is no per-app exception. The point of a
monorepo is that any app is readable by anyone who already knows the others;
a language switch at a directory boundary defeats that.

Norwegian prose and identifiers in an app are a backlog, not a style to
match: they are inherited, never a deliberate per-app convention worth
keeping. Migrate a file to
English whenever you are already touching it, per "Refactor on contact"
below.

This is about **code**: identifiers, comments, commit messages, AGENTS.md
files, docs. It is not about user-facing text. An app with user-entered
data read by one Norwegian speaker may keep its on-screen labels Norwegian
until told otherwise — that is a product decision, not a code-quality one.
`budget` is the one explicit exception: every on-screen label there is in
English, by request. Keep the two separate in any app that still has
Norwegian labels: rename `hentInntektskilder` to `fetchIncomeSources`, leave
the button text `Lønn` alone, unless told otherwise as happened here.

Third-party API shapes and external data sources (a Norwegian-language field
in an upstream API) are not code
to rename — translate at the boundary, in the one file that already owns
parsing that input, not throughout the codebase.

## Refactor on contact

When a change touches code that violates a rule in this file or in the
nearest AGENTS.md — wrong language, a file with two jobs, an abbreviated
name, a dependency that should not be there — fix it as part of the same
change, rather than leaving a note for later.

Scope the fix to what you are already touching: rewrite the file you are
editing, not every file across the repo with the same problem, unless asked
to do the broader migration. A feature change and an unrelated rename are
still two different concerns — fix what you touch, in the same commit as a
clearly separated step, not bundled silently into the feature's diff.

## Cloudflare holds no data

The public side (`forside`, `work`) is Cloudflare, which keeps **only compute and the
published snapshots**. The seven media apps are not on Cloudflare any more: they run on this machine (`docs/MEDIA-SERVER.md`),
read the local databases directly, read-only, and sit behind the Nextcloud login. Cloudflare holds no data:

1. **Never** a Cloudflare D1, KV, Durable Objects, Queues, Hyperdrive or R2 —
   neither for new work nor as a place to move something to.
2. A Worker (`forside`, `work`) is **stateless presentation**: it serves files and calls APIs. Nothing
   is written at the edge. The media server opens the databases read-only and writes nothing either.
3. Durable data is a **local file** — `.data/data.db`, `.data/podcasts.db` — or a
   self-hosted service on this machine. `docs/DATA.md` and the "What this
   repository is" section of `AGENTS.md` describe the shape.
4. What a Worker answers is a **snapshot** (`npm run snapshot`), built from the
   local file and shipped with the deploy. If it is not in git or in the snapshot,
   it is not on Cloudflare. (The media apps need no snapshot: they query `.data/*.db` live.)
5. The local files stay local: `.data/` and every `web/public/api/` are
   git-ignored, and hold real data.

## Data about me lives here

The goal behind the rules above: this machine is **home for all data about the
owner**, and Cloudflare is not. A new source of such data is added the way AGENTS.md describes ("Data about the
owner is kept, not just shown"): the original is landed unchanged under `.data/raw/<source>/<date>/`, an
idempotent Rust job imports it, API first and export second, and the result is
written to `data.db` or a database of the source's own. Data about other people,
and location, health, mail, messages and money, never go into a snapshot shipped to Cloudflare. There is
no backup yet, so a change that could lose data says so before it runs. A media app
may show such data, because it is served from this machine behind the Nextcloud login (`docs/MEDIA-SERVER.md`).

Local `wrangler dev` scaffolding that still says "d1" — the `env.local` binding in
a `wrangler.jsonc`, the `db:*:local` scripts, the `D1Database` type — points at a
local file, not Cloudflare storage. It is naming to clear on contact, not a
violation to fix in one sweep.

## Owner input (Nextcloud Forms, read by the machine)

The apps are public and read-only for visitors, so no app has a form of its own. What the owner enters by hand and no source has
(today: a film seen) is entered in a Nextcloud app and **read by the machine**, which checks it again and moves it into the data.
The film app's «Logg en film» was once a React island that wrote a CSV file into Nextcloud over WebDAV from the owner's session
(`packages/nextcloud`, a package with its tests, a CSRF dance, a done-file and a rewritten inbox, and a same-origin session an XSS in a
public page could have used). It was replaced by a **Forms** form because Nextcloud already does every part of it better:

| | Own island (before) | Tables table | Forms form (chosen) |
| --- | --- | --- | --- |
| Phone | a button on `/`, a sheet | the table's row dialog, all columns in one modal | a single-purpose page, the form can sit on the home screen |
| Validation | the browser, then the machine | column types only (a number has no step, so 4.3 passes; no pattern) | the server: a dropdown allows only the ten ratings, a date picker, required fields, a regex for the year |
| Semantics | an inbox | a ledger: an edit or delete in the table cannot reach the log, which is the record, so the two drift | an inbox: a submission is an event, corrections are made in the log (`film-sync amend`/`remove`) |
| Machine reads | one file in the container | the REST API (an app password) or internal `tables_row_cells_*` | `oc_forms_v2_*` through `podman exec nextcloud-database psql`, read only, no secret (as `gpodder-export.ts`) |
| Code we keep | a package, an island and the importer | the same reader | the reader, `scripts/film-inbox*.ts` (~150 lines), and the log's own rules |

Tables stays the better tool for data that is edited in place and kept in Nextcloud; the film log is neither. Forms 5.4.1 and
Tables 2.4.0 are stable releases from the app store, not betas. Rules for any further input of this kind: the machine only **reads**
(no write-back, no token), the form's questions are matched by their text (`FORM_QUESTIONS` in `scripts/film-inbox-plan.ts`), and a
submission is remembered by id in `.data/film-forms-seen.txt` so that deleting a line from the log does not bring it back.
