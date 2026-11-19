# The media server

One Node process serves the seven media apps and their hub `apps/medier` (music `/apps/medier/musikk`, podkast `/apps/medier/podkast`, film `/apps/medier/film`, tv `/apps/medier/tv`,
games `/apps/medier/spill`, books `/apps/medier/boker`, boardgames `/apps/medier/brettspill`, the hub `/apps/medier`) on `sky.lmfaole.party`, eight builds in all. The old `/apps/<slug>` addresses are answered 301 to the new ones (`MOVED_BASES` in `scripts/media-registry.ts`). It runs
in the rootless Podman container `media` on the owner's machine, defined by `quadlets/media.container` in the Nextcloud repository
(`~/Dokumenter/nextcloud`, copied to `~/.config/containers/systemd/media.container`). `forside` and `work` are not part of it;
they stay Cloudflare Workers.

The same server also mounts the **home apps** (innboks, hjem, miniflux (RSS), penger) at `/apps/hjemmeserver/<id>`, each once it has code (`docs/HOME-APPS-MIGRATION.md`; until the first one is built the server mounts exactly what it mounted before). See "Mount kinds" below.

```
browser -> Cloudflare (Access) -> tunnel (cloudflared-immich) -> http://media:3000 (nextcloud.network, no published port)
                                                                      |-> http://nextcloud:80  (checks the owner's login; also gets /apps/hjemmeserver/* the server does not mount, proxied)
                                                                      '-> .data/*.db, read-only SQLite
```

- The server writes nothing except what an app's own `write` route does: music's `/push/subscribe` and `/push/unsubscribe` keep a device's push subscription in `.data/push/subscriptions.json` (`apps/music/web/src/server/push.ts`; behind the login, `Sec-Fetch-Site: same-origin` only, a few hundred bytes, ten devices at most). Databases stay read-only.
- `GET /healthz` answers 200 with no login. Everything else needs the owner's Nextcloud login (`OWNER_UID=ole`).
- Environment: `PORT` 3000, `DATA_DIR` `<repo>/.data`, `APPER_DIR` `<DATA_DIR>/apper` (the home apps' JSON files, below), `NEXTCLOUD_URL` `http://nextcloud:80`, `NEXTCLOUD_HOST` `sky.lmfaole.party`, `OWNER_UID`. `MEDIA_ONLY` (a comma list) mounts only the named apps, home apps included.
- Needs Node 24 (`node:sqlite`); the container image is `docker.io/library/node:24-slim`, the host's `~/.local/node` is not used.

## Mount kinds

An app is mounted from three things: its `MediaAppSpec` (`scripts/media-registry.ts`: `name`, `base`, the pages that moved), its build (`apps/<name>/web/dist`, `npm run media:build`) and its `web/src/server/api.ts`, whose `DOMAINS` decide how its `/api/*.json` is answered (`media-api-module.ts`, `media-worker.ts`). Every request meets the same pipeline (`media-router.ts`: `/healthz`, the login gate, the security headers and the CSP hashes of inline scripts, the private cache rule) whatever the kind.

| Kind | Specs | `DOMAINS` | Answers from | Cache of an answer | Writes |
| --- | --- | --- | --- | --- | --- |
| media app | `SPECS`: the seven and the hub, `/apps/medier/...` | one or more SQLite domains | `.data/<domain>.db`, read-only (`media-data.ts`) | kept with an ETag, a 304 on revalidation | music's push route only |
| home app | `HOME_SPECS`: innboks, hjem, miniflux, penger, `/apps/hjemmeserver/<id>` | `[]` | JSON files in `APPER_DIR`, read-only (`media-files.ts`) | none: `Cache-Control: no-store`, no ETag, read at every request | none: no write route, a POST/PUT/DELETE is a 405 |

A **home app** is not in the default mount until it has `apps/<id>/web/src/server/api.ts` (`defaultApps` in `media-server.ts`), so a checkout without any changes nothing; `MEDIA_ONLY=penger` mounts one by name. Its `API` is a map of `jsonFile("<file>.json", <valibot schema>)` loaders (`@designsystem/config/apper-files`): a name must be a plain relative `.json` path inside `APPER_DIR` (no `..`, no absolute path, at most 32 MB), a missing file is a 404, a file that is not JSON or does not match the app's schema is a 502 and a line in the log, and an unknown API name is a 404. The files are what the exporters of the Nextcloud repository write as a host copy (`scripts/apper-export.ts` there: `export/apper/<file>.json`, written by temporary file and rename, gitignored with `/export/`), next to the copy in Nextcloud's own `Apper/` folder that Nextcloud's pages read over DAV (kept until the last page has moved).

A home app is installed on its own (`pwa: 'app'` in `packages/config/astro-preset.ts`): its build holds `/manifest.webmanifest` (`id`, `start_url` and `scope` are `/apps/hjemmeserver/<id>/`, what the installed copies from Nextcloud have, so they keep their identity; `<link rel="manifest" crossorigin="use-credentials">` because of Cloudflare Access) and `/sw.js`, a network-first shell worker like Nextcloud's `js/sw-base.js` (it replaces that worker in place at the same address). The page owner writes only from the browser to Nextcloud (`AGENTS.md`, "The home apps"); the server never does.

### The `APPER_DIR` volume (a manual step; nothing has applied it)

The container cannot see `~/Dokumenter/nextcloud`, so the host copy needs one volume and the variable. The same edit is made in `quadlets/media.container` of the Nextcloud repository; the live file (`~/.config/containers/systemd/media.container`) is changed by hand, when the first home app is ready:

```diff
 Environment=OWNER_UID=ole
+Environment=APPER_DIR=/home/lmfaole/Dokumenter/nextcloud/export/apper
 ...
 Volume=.../monorepo/.data/tmp:.../monorepo/.data/tmp:ro
+Volume=/home/lmfaole/Dokumenter/nextcloud/export/apper:/home/lmfaole/Dokumenter/nextcloud/export/apper:ro
```

```sh
mkdir -p ~/Dokumenter/nextcloud/export/apper   # the folder MUST exist, or Podman refuses to start the container
cp ~/Dokumenter/nextcloud/quadlets/media.container ~/.config/containers/systemd/media.container
systemctl --user daemon-reload && systemctl --user restart media
```

The exporters create the folder themselves on their first run; the `mkdir` only matters for the first start after the edit. Without the volume the server still starts; a home app's API files are then simply not found (404).

### The tunnel: one rule, set once (a manual Zero Trust step)

The tunnel holds ONE static path rule for `sky.lmfaole.party`, and nothing is ever added to it again (`TUNNEL_PATH_REGEX` in `scripts/media-registry.ts`; `scripts/media-registry.test.ts` fails if a base of the server is not matched or a Nextcloud path is):

```
^/apps/(medier|hjemmeserver|musikk|podkast|film|tv|spill|boker|brettspill|rss)(/|$)
```

to `http://media:3000`. The legacy slugs (`musikk` ... `rss`) stay only so the server can answer their 301s. The server owns the routing inside `/apps/hjemmeserver/` (`scripts/media-proxy.ts`): a path of a mounted home app (`/apps/hjemmeserver/penger/...`, its bare base included) is served by the app and meets the login gate; **any other path under `/apps/hjemmeserver/`** (the old plain-JS pages `innboks`, `hjem`, `miniflux`, `oversikt`, `/apps/hjemmeserver/api/miniflux/*` of the PHP proxy, the app's manifests, service workers, static js/css/icons, the share target) is reverse-proxied to Nextcloud at `NEXTCLOUD_URL` as it came: same method, path and query, headers and cookies (`Host` is `NEXTCLOUD_HOST`; `X-Forwarded-For` gets the peer appended, `X-Forwarded-Proto` defaults to `https`, `X-Forwarded-Host` to the host asked for; hop-by-hop headers are dropped), request and response bodies streamed, status, `Set-Cookie`, `Location` and Nextcloud's own security headers back unchanged. No login gate and no media CSP on those (Nextcloud's own auth handles them), no redirect is followed, a visitor who leaves ends the upstream request, and an upstream that is down or silent for 120 s is a 502 with a `media-proxy:` line in `podman logs media`. Everything else outside the seven apps, the hub and the mounted home apps is a 404 as before. A new home app therefore needs **no tunnel change**: build it, restart `media`, and its paths are served by it from then on.

**The one-time change** (Zero Trust, or dash.cloudflare.com): Networks, Tunnels, the `cloudflared-immich` tunnel, Published application routes. Edit the existing path rule for hostname `sky.lmfaole.party` (the one that holds `^/apps/(medier|musikk|...|rss)(/|$)`), replace its path with the regex above (regex, Go syntax), keep the service `http://media:3000`, and keep the rule ABOVE the Nextcloud catch-all (rules are read top down, first match wins). Save. Then check `https://sky.lmfaole.party/apps/hjemmeserver/oversikt/` (still the old page, now through the proxy) and `/apps/medier/` (the hub). Cloudflare Access is already in front of the host, so no Access rule changes.

**Rolling back** the tunnel: edit the path back to `^/apps/(medier|musikk|podkast|film|tv|spill|boker|brettspill|rss)(/|$)`. The old regex does not match `hjemmeserver`, so Nextcloud serves `/apps/hjemmeserver/` again (the old plain-JS pages; a home app built here is then not reachable until the rule is set again, and its installed PWA copies keep working because address, `id` and `scope` never changed). To take one home app out while keeping the rule, move `apps/<id>/web` away or set `MEDIA_ONLY` to the others, restart `media`: its paths are proxied to Nextcloud's old page. The new service worker is replaced by Nextcloud's at the same address on the next update check (it deletes the old `<id>-` caches).

**Nextcloud now sees the media container as its client.** Requests under `/apps/hjemmeserver/` reach Nextcloud from the `media` container's IP on `nextcloud.network`, not from `cloudflared-immich` as before (the tunnel container is on the same network, so Nextcloud's trust of it and its view of the request were already via a proxy; the new peer is a different address). Nextcloud's `config.php` is not in the Nextcloud repository (it is in the container's volume and `nextcloud.env`; read-only reading of it was not done), so check, with `podman exec -u www-data nextcloud php occ config:system:get <key>` (read-only):
- `trusted_proxies`: must list the `nextcloud.network` subnet (or both containers' addresses), or the container whose address changed is not trusted. If it lists single addresses of `cloudflared-immich`, add the `media` container's address or, better, the subnet (`podman network inspect nextcloud --format '{{range .Subnets}}{{.Subnet}}{{end}}'`).
- `forwarded_for_headers`: the header Nextcloud reads the visitor's address from (the default `HTTP_X_FORWARDED_FOR`; Cloudflare's own is `Cf-Connecting-Ip`, which the proxy passes on untouched). Without `trusted_proxies` covering the peer, Nextcloud takes the container's IP as the visitor, and its **brute-force throttle then counts every visitor as one address** (a few wrong passwords lock everybody for a while).
- `overwriteprotocol` (`https`), `overwritehost` (`sky.lmfaole.party`) and `overwrite.cli.url`: the proxy sends `Host: sky.lmfaole.party`, `X-Forwarded-Proto: https` (as received from Cloudflare, else `https`) and `X-Forwarded-Host`, so a Nextcloud that already worked behind the tunnel needs no change; if the values were never set, `Location` headers and the CSRF/`Secure`-cookie checks depend on them being the public `https` address.

Verify through the proxy after the change: `curl -sI https://sky.lmfaole.party/apps/hjemmeserver/oversikt/` (needs your Access cookie) answers Nextcloud's page or its 302 to the login with `Location: https://sky.lmfaole.party/...` (never `http://` or `media`); log in in a browser and see the `nc_session_id` cookie set with `Secure; HttpOnly; SameSite=Lax` and a second page load stay logged in; a POST from a page (the Miniflux read mark, `/apps/hjemmeserver/api/miniflux/...`) is not refused with 412 "CSRF check failed"; fail a login once with a wrong password and read `podman exec -u www-data nextcloud php occ security:bruteforce:attempts <your-ip> ` or Nextcloud's log (`Administration, Logging`): the logged address is yours, not the container's.

## Operate

```sh
systemctl --user status media            # is it up (and the container's health)
systemctl --user start|stop|restart media
podman logs -f media                     # the server's log (stdout/stderr)
journalctl --user -u media -n 100        # the unit: start failures, restarts, OOM
podman healthcheck run media && echo healthy
podman inspect media --format '{{.State.Health.Status}}'
podman stats --no-stream media           # memory and CPU
```

Uptime Kuma watches `http://media:3000/healthz` (monitor `media`); a failure starts an incident like any other unit.

## Update flow

```sh
cd ~/Applikasjoner/Documents/monorepo
git pull && npm install
npm run verify                  # optional, the gate
npm run media:build             # builds the seven media apps, the hub and each home app with code (penger, hjem)
systemctl --user restart media  # the server loads the new build; a few seconds of 502
podman healthcheck run media
```

The checkout is mounted read-only into the container, so the build runs on the host, never in the container. The data
fetchers (the `*-sync-*` timers) keep writing `.data/` as before; the server sees new rows at once, because it opens the
databases per request (or holds read-only handles that see new commits). No restart is needed for new data, only for new code.
Editing a file under `apps/` or `scripts/` without building does nothing visible.

Image update: `podman pull docker.io/library/node:24-slim && systemctl --user restart media` (not in `containers-update` yet).

## What the container can touch

- The monorepo checkout: read-only. `secrets/` and `target/` are hidden under empty read-only tmpfs mounts.
- `.data/`: its top level is writable and `raw/`, `archive/`, `published/`, `profile/` and `tmp/` are read-only. Why not read-only
  throughout: SQLite in WAL mode makes a reader open the `<db>-shm` and `<db>-wal` files. Tested with a throwaway database
  on a read-only bind mount: while a writer is open (its `-wal`/`-shm` exist) a read-only reader sees every new commit; **when the last writer
  has closed cleanly SQLite deletes both files and a reader on a read-only mount fails with "unable to open database file"**. The
  sync tools open and close often, so a fully read-only mount would break at random. The server therefore must open every
  database with `readOnly: true` (`new DatabaseSync(path, { readOnly: true })`) so no table can be changed; the writable mount only lets
  SQLite create the shared-memory file.
- `APPER_DIR` (`~/Dokumenter/nextcloud/export/apper`, when the volume above is applied): read-only, the home apps' JSON files; the server never writes there.
- Network: `nextcloud.network` only (Nextcloud, and the other containers on it). No published port. `UserNS=keep-id` makes the container user uid 1000
  like the owner, so the files under `.data/` are readable with their normal modes.
- `/tmp` is a 256 MB tmpfs; no capabilities, no new privileges, read-only root file system. SELinux label separation is off for this one
  container (`SecurityLabelDisable=true`), so the 230 000 files of the checkout are not relabelled on every start.

## Memory and CPU

Expect about 150 to 400 MB resident (Node, Astro SSR for eight apps, SQLite page cache) and almost no CPU at rest; a page render is
tens of milliseconds of one core, and the heavy summaries are precomputed by the sync tools. The container is capped at 2 GB
(`Memory=2g`): above it the kernel kills the process and `Restart=always` brings it back 10 s later. If `podman stats` shows it near the cap,
look for a query that reads a whole table before raising the cap. Each app worker thread has its own V8 heap ceiling of 1 GB (`WORKER_HEAP_MB` in `scripts/media-app-host.ts`) and the main thread gets `--max-old-space-size=1024` through `NODE_OPTIONS` in the quadlet: the Node default (~500 MB) made the cold music capsule die with "JS heap out of memory" in a restart loop. The machine has 8 cores and 31 GB.

## Rollback to the Cloudflare Workers

The old way (a Worker per app serving a snapshot, deployed with `npm run deploy`) is in git history from before the migration commit. To go back:

1. Remove the tunnel rule for `/apps/...` in Zero Trust (the one rule above; Nextcloud's catch-all then serves `sky.lmfaole.party` again). See the Nextcloud repository README for the steps.
2. `git checkout <commit-before-the-migration>` in a separate worktree (`git worktree add ../monorepo-old <commit>`), `npm install`, then `npm run deploy` in each of the eight apps there. The Worker routes (`sky.lmfaole.party/apps/<slug>` and `/*`) come back with the deploy.
3. Reinstall the publish timers of those commits (`node scripts/publish-timers.ts <app> install`).
4. `systemctl --user stop media`.

A Worker that has not yet been deleted needs no step 2: it still holds its route, which wins over the tunnel at the edge. That is the
quickest rollback during the cutover (do not run `wrangler delete` for an app until its page works from the container).

## Retiring the old publish timers

The `<app>-publish` units of the seven media apps are obsolete (no snapshot, no deploy). Only `forside-publish` and `work-publish` remain.
```sh
for a in music podkast film tv games books boardgames rss; do
  systemctl --user disable --now $a-publish.timer
  rm -f ~/.config/systemd/user/$a-publish.timer ~/.config/systemd/user/$a-publish.service
done
systemctl --user daemon-reload
systemctl --user reset-failed
npm run timers     # the check lists only forside and work now
```
The sync timers (`<app>-sync-*`) stay.

## The image (`ghcr.io/lmfaole/medier`)

`Containerfile` builds the server with the eight media apps in it; `.github/workflows/image.yml` builds it after CI passes on `main`, checks that
`/healthz` answers, and pushes `latest` and the commit. The image holds no data and no key: the databases are mounted at `DATA_DIR` (`/data`), and
the pictures landed on the machine (`apps/<app>/web/public/`: covers, posters, artists) at `PICTURES_DIR`, which the server falls back to when
the build has no such file. `deploy/media.container` is the quadlet that runs it with `AutoUpdate=registry`, so `podman-auto-update.timer`
deploys a green push to `main`. It replaces the unit of the Nextcloud repository once the home apps have a container of their own; they are not
in this image.
