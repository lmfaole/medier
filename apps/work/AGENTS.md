# AGENTS.md

What is specific to `work`. The rules every app shares (language, one job per file, comments, what not to
change, the done checklist) are in `../../AGENTS.md`. For humans: `README.md`.

## What this project is

A single public page at `lmfaole.party/cv`, a path of the host that `forside` owns (`base: '/cv'`; zone routes `lmfaole.party/cv` and `lmfaole.party/cv/*` are more specific than forside's `lmfaole.party/*`). The old host `jobb.lmfaole.party` stays a custom domain only to redirect to the new address (`web/src/lib/former-host.ts`). Its one API file, `cv.json`, is built from the CV (`cv.db`) and, for the latest commit of a project, `github.db`
(`DOMAINS = ['cv', 'github']`). Nothing on it is behind a login, and it is meant to be found by search engines.

## The one rule

**Everything a loader selects is published.** The `github` database holds private repositories (employer,
school), their pull requests, titles and addresses, and the loader reads only one table of it. So:

- a loader names its columns (no `SELECT *`), and a column is added to a query only when the owner would
  publish it;
- `github` is read only through `github_project_commits`, which `work-sync` fills without a token, so only
  a public repository can have a row; a project's repository is published only with such a row;
- `server/cv.test.ts` has a project whose repository has no row and fails if its name reaches the JSON.
  Never weaken it to make a query pass.

## Where things are

| Path | Owns |
| --- | --- |
| `web/src/server/api.ts` | `DOMAINS` and the `API` map: `cv` |
| `web/src/server/cv.ts` | The loader and its named SQL: employers, roles, projects with their latest commit, education |
| `web/src/server.ts` | The Worker: `createIndexableAstroWorker(renderWithAstro)` (`INDEXABLE_HEADERS`, `AI_AND_SEO_CRAWLERS`) |
| `web/src/server/responses.ts` | The valibot schema of `cv.json` that the page reads, `satisfies` the loader's `ApiResponses` |
| `web/src/pages/index.astro` | The page and its head (`Document` with `index`, `og`): not the personal apps' `AppLayout`. It reads the snapshot, so it is not prerendered, and it sends no island |
| `web/src/pages/api/[...file].ts`, `404.astro` | `/api/cv.json` and the shared 404 |
| `web/src/views/Work.tsx`, `components/` | The CV, projects under their roles with the latest commit; rendered to HTML only |
| `web/public/robots.txt` | Allows search engines; the AI crawlers are refused here and in the Worker |

`work` is deliberately not in `packages/ui/src/lib/apps.ts` (`PUBLIC_APPS` in `scripts/apps.ts`): the sidebar
and tab bar of the personal apps must not link here, and this page links to none of them.
