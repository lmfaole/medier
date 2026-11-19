# Deploying the apps

Two kinds of deploy. **The seven media apps** (music, podkast, film, tv, games, books, boardgames) are Astro on
Node, served by one server on the owner's machine (`scripts/media-server.ts`, runbook `docs/MEDIA-SERVER.md`): a deploy is
`npm run media:build` and a restart of the `media` container. **`forside` and `work`** are still Cloudflare Workers
(`npm run deploy` in the app, rule 7 in `AGENTS.md`). Nothing builds or deploys on a push.

## Media apps

```sh
git pull && npm install
npm run verify
npm run media:build
systemctl --user restart media
podman healthcheck run media   # and open the app once; checks below
```

The old Cloudflare Worker path of the media apps (snapshot, `wrangler deploy`, publish timers) is gone; its code is in git
history. Rolling back to it is in `docs/MEDIA-SERVER.md`.

## Access

The media apps and the hub are paths of `sky.lmfaole.party` (`/apps/medier/<slug>`, `/apps/medier`). The tunnel sends them to the `media` container, which
checks the Nextcloud login itself; Cloudflare Access in front of the host stays. They are private to the owner: no Bypass
rule is needed or wanted. `forside` (`lmfaole.party`) and `work` (`lmfaole.party/cv`, a path of the forside host, `jobb.lmfaole.party` only redirects) are on other hosts or paths of their own and stay public.
The manifest link is `crossorigin="use-credentials"` so the browser sends the login cookie when it fetches the manifest.

## forside and work: plan, then deploy

```sh
npm run ship -- --dry-run   # plans forside and work; refuses a database, bucket or key-value binding
npm run ship -- work        # then forside
```

Check the snapshots first with `npm run snapshot` in the app: it writes `web/public/api/*.json` from the local databases,
and a file the app's `responses.ts` schema rejects shows as a failed page.

## After a deploy, on the live address

Applies to every app; the Worker-only points (`cloudflare-cdn-cache-control`, the header hashes) apply to `forside` and `work`.

- `/healthz` answers 200, and the front page and one page of each kind load: the library (type in the search box, the
  address gets `?q=`), `/historikk`, and an
  entity page.
- The browser console is clean: no Content Security Policy violation and no `astro-island` that kept its `ssr`
  attribute. The page is allowed to run its islands only because the Worker hashes the inline scripts of each page
  into the header (`packages/config/astro-worker.ts`); a violation means that failed.
- `/api/<file>.json` and `/api/<file>.json?period=…` under the app's base answer 200 with
  `cache-control: public, max-age=600…`, and a period with no file answers 404.
- A page carries `cloudflare-cdn-cache-control`, and `/_server-islands/Freshness` is `no-store`; the freshness line
  appears after load.
- The personal apps have the three not-indexed layers (`<meta robots>`, `robots.txt`, `X-Robots-Tag`); `work` and
  `forside` have none. `work` answers 403 to a GPTBot user agent and 200 to Googlebot.
- The paths that moved away (`/media`, `/musikk`, `/podkast`, `/film`, `/medier/<app>`, `/rss`, `/alle-apper`) answer 301 on `lmfaole.party`.
- `/apps/medier/manifest.webmanifest` is 200 with the scope `/apps/medier/`, `/apps/medier/sw.js` is 200, and an old `/apps/<slug>/…` address answers 301 to `/apps/medier/<slug>/…` on `sky.lmfaole.party`. A page's `Cache-Control` is the same with and without the worker.

## What behaves differently

- Every navigation is a full page load. There is no client router, no hover preload by a router (Astro prefetches
  links on hover) and no pending fade; the browser's own cross-fade is the page transition (`docs/MOTION.md`).
- A thing in a list links to its own page; an old `?kort=<kind>.<slug>` address is answered 301 to that page.
- A period or month switch is a link, so Back steps through them.

## Rolling back

Nothing a deploy does touches `.data/`. A media app: `git checkout` the earlier commit, `npm run media:build`, restart `media`.
`forside` and `work`: `wrangler rollback` in `apps/<app>`, or check out the earlier commit and `npm run deploy` in the app.

## Not done in the cloud session

`npm run e2e` (it needs the dev servers and data), checks of real covers and posters (the test snapshots had none),
the Rust checks, and a pass over `.mcp.json` and `secrets/`, which still list the `tanstack` documentation server
(now only for Charts, Virtual and Table).
