# forside

`lmfaole.party`: the front page. The name, one sentence about the work and links to GitHub, LinkedIn and e-mail. It is
public and indexable like `lmfaole.party/cv` (no `noindex`, no `X-Robots-Tag`, a `robots.txt` that allows
search engines and refuses the AI crawlers), and stands outside the personal apps: no sidebar.

It also serves `/medier`, a card per app of the registry with a link to each of the app's pages. Nothing on
`/` links it: it is reached from `sitemap.xml`, so the apps stay unlisted on the front page. A path a media app
moved away from (`/medier/<app>`, now `sky.lmfaole.party/apps/<app>`) is redirected there (301) (`web/src/lib/moved-paths.ts`).

It has no data, so it has no snapshot and no `api/`. It was a static Pages project (`lmfaole/lmfaole.party` on
GitHub); the Worker route `lmfaole.party/*` now serves it, and `sky.lmfaole.party/apps/medier/musikk/*` (music) is the more
specific route and wins for that path.

```sh
npm run dev       # the Vite dev server (port 5184)
npm run deploy    # build, checks, wrangler deploy (by hand)
```
