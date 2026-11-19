# work

`lmfaole.party/cv`: the CV, with the projects I have worked on under the roles they belong to and the latest commit I made in each one's
public repository, on a page of its own. It is mounted at a path of the host that `forside` owns (`base: '/cv'` and zone routes, in `wrangler.jsonc`); the old host `jobb.lmfaole.party` is kept as a custom domain only so that the Worker can answer it with a redirect to the new address (`web/src/lib/former-host.ts`). It is the one public app that wants to be found: no `noindex`, no `X-Robots-Tag`, a `robots.txt` that
allows search engines and refuses the AI crawlers. It stands outside the personal apps: no sidebar, no tab
bar, no link to `sky.lmfaole.party/apps/medier/musikk`.

```sh
npm run snapshot    # cv.json into web/public/api/, from .data/cv.db and .data/github.db
npm run dev         # `astro dev`, serving that snapshot
npm run build       # web/dist/client (page) and web/dist/server (Worker)
npm run deploy      # snapshot, build, checks, wrangler deploy (by hand)
```

The Worker has no database. Everything on the page is a file of the snapshot, so everything on the page is
public: `server/cv.ts` names the columns it reads. A project names its public repository (`cv_project.repo`) and
`work-sync` (`apps/work/sync-rust`, `cargo run -p work-sync -- project-commits`, and in its daily timer)
fetches the latest commit by the owner there **without a token**, so a private repository gets no row and is never
shown; `server/cv.test.ts` fails if its name reaches the JSON. Education before upper secondary school is left out
of the CV (`cv.ts`). Read `AGENTS.md` before adding anything to the loader.
