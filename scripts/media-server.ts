/**
 * `node scripts/media-server.ts`: the seven media apps (music, podkast, film, tv, games, books, boardgames) as ONE Node
 * server on this machine, next to Nextcloud on the same container network. Each app is the Astro build in
 * `apps/<name>/web/dist` (`npm run media:build`), mounted under its base path (`/apps/film`), and answers from the local SQLite
 * databases, opened read-only, per request (`media-data.ts`). The home apps (innboks, hjem, miniflux, penger: `HOME_SPECS`, mounted at
 * `/apps/hjemmeserver/<name>`) are mounted the same way once they have code, and answer from JSON files that the Nextcloud repository's
 * exporters write (`media-files.ts`, `APPER_DIR`), read-only. Any other path under `/apps/hjemmeserver/` is proxied to Nextcloud untouched (`media-proxy.ts`), so the tunnel needs no rule per app. Every request but `/healthz` and those goes through the owner's Nextcloud
 * login first (`login-gate.ts`). `forside` and `work` are not here; they stay Workers with a snapshot.
 *
 * Environment:
 *   PORT            listens on 0.0.0.0:3000 unless set
 *   DATA_DIR        the folder with `<domain>.db`; `<repo>/.data` (`MUSIC_DB`… still move one file)
 *   NEXTCLOUD_URL   where Nextcloud answers on the container network; `http://nextcloud:80`
 *   NEXTCLOUD_HOST  its public name, sent as `Host`, and where a visitor is sent to log in; `sky.lmfaole.party`
 *   OWNER_UID       the one Nextcloud account let in; `ole`
 *   APPER_DIR       the exporters' JSON files, read-only, for the home apps; `<DATA_DIR>/apper`
 *   PICTURES_DIR    a folder like the checkout's `apps/`, whose `<app>/web/public/` has the pictures landed on the machine (covers, posters,
 *                   artists); served when the build has no such file, since the image is built without them; the checkout's `apps/` by default
 *   MEDIA_ONLY      a comma list of apps to mount (a development run); all seven media apps, the hub, and each home app that has code
 *   MEDIA_LOGIN=off no login at all, on this machine only (page-check, e2e); logs a warning
 */

import { existsSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { registerApiFetcher } from "@designsystem/config/api-fetchers"
import { hostFetch } from "@designsystem/config/host-fetch"
import { createLoginGate, type LoginGate } from "@designsystem/config/login-gate"

import { MEDIA_APPS } from "./apps.ts"
import { parseApiModule } from "./media-api-module.ts"
import { createAppHost, type AppHost } from "./media-app-host.ts"
import { buildOf, HOME_SPECS, MOVED_BASES, RETIRED_BASES, SPECS, type MediaAppSpec } from "./media-registry.ts"
import { createProxy } from "./media-proxy.ts"
import { type AstroHandler, createMediaRouter, type MountedApp } from "./media-router.ts"

export interface MediaServerOptions {
  rootDirectory: string
  dataDirectory: string
  /** The exporters' JSON files, mounted read-only; `<dataDirectory>/apper` when left out. */
  apperDirectory?: string
  /** Where `<app>/web/public/` holds the pictures landed on the machine; the checkout's `apps/` when left out. */
  picturesDirectory?: string
  nextcloudUrl: string
  nextcloudHost: string
  ownerId: string
  /** A subset of the apps (media apps, the hub, home apps); without it every media app and the hub, and each home app that has code. */
  only?: readonly string[]
  /** Replaces the registry's specs (a test's stub apps). */
  specs?: readonly MediaAppSpec[]
  /** `false` lets everybody in. */
  login?: boolean
  /** Replaces the gate (a test's). */
  gate?: LoginGate
  log?: (message: string) => void
}

export interface MediaServer {
  server: Server
  hosts: ReadonlyMap<string, AppHost>
  close(): Promise<void>
}

async function mountApp(spec: MediaAppSpec, options: MediaServerOptions): Promise<{ mounted: MountedApp; host: AppHost }> {
  const { rootDirectory, dataDirectory, log = console.error } = options
  const appDirectory = join(rootDirectory, "apps", spec.name)
  // The API is checked here as well, so a broken app fails at start-up and not on its first visitor.
  const apiModule = pathToFileURL(join(appDirectory, "web", "src", "server", "api.ts")).href
  parseApiModule(await import(apiModule))
  const host = createAppHost({
    name: spec.name,
    base: spec.base,
    apiModule,
    dataDirectory,
    migrationsRoot: join(rootDirectory, "db", "migrations"),
    apperDirectory: options.apperDirectory ?? join(dataDirectory, "apper"),
    volatile: spec.volatile ?? {},
    warm: spec.warm ?? [],
    log,
  })
  // Before the build is loaded: its `cloudflare:workers` finds the fetcher by the base path.
  registerApiFetcher(spec.base, host.fetcher)
  const build = buildOf(rootDirectory, spec.name)
  let handler: Promise<AstroHandler> | undefined
  let extra: MountedApp["extra"]
  let write: MountedApp["write"]
  if (spec.name === "music") {
    // A cover the build does not have comes from the Cover Art Archive, once (`cover-art.ts`).
    const { handleCover, isCoverPath } = await import(pathToFileURL(join(appDirectory, "web", "src", "server", "cover-art.ts")).href)
    // The favourite photos of the concerts, kept in the data folder by `music-sync concert-photos` (`concert-photo.ts`).
    const { handlePhoto, isPhotoPath } = await import(pathToFileURL(join(appDirectory, "web", "src", "server", "concert-photo.ts")).href)
    const photos = join(options.dataDirectory, "concert-photos")
    // Who asked to be told at the end of a week or month: the server's one write, a small file in the data folder (`push.ts`).
    const { handlePush } = await import(pathToFileURL(join(appDirectory, "web", "src", "server", "push.ts")).href)
    const pushDirectory = join(options.dataDirectory, "push")
    // The key a browser needs to subscribe is a GET; the subscribing itself is a POST.
    extra = async (path) => (isCoverPath(path) ? handleCover(path) : isPhotoPath(path) ? handlePhoto(path, photos) : handlePush(new Request(path), path, pushDirectory))
    write = (path, request) => handlePush(request, path, pushDirectory)
  }
  return {
    host,
    mounted: {
      base: spec.base,
      moved: spec.moved,
      clientDirectory: build.client,
      pictureDirectory: join(options.picturesDirectory ?? join(options.rootDirectory, "apps"), spec.name, "web", "public"),
      api: host.fetcher,
      handler: () => (handler ??= import(pathToFileURL(build.server).href).then((module: { handler: AstroHandler }) => module.handler)),
      ...(extra === undefined ? {} : { extra }),
      ...(write === undefined ? {} : { write }),
    },
  }
}

/** The apps mounted when nobody names them: the media apps and the hub as before, and a home app only once it has code (an `api.ts`), so a repository with none changes nothing. */
export function defaultApps(rootDirectory: string): string[] {
  return [...MEDIA_APPS, ...HOME_SPECS.map((spec) => spec.name).filter((name) => existsSync(join(rootDirectory, "apps", name, "web", "src", "server", "api.ts")))]
}

export async function createMediaServer(options: MediaServerOptions): Promise<MediaServer> {
  const { rootDirectory, nextcloudUrl, nextcloudHost, ownerId, login = true, log = console.error } = options
  const known = options.specs ?? [...SPECS, ...HOME_SPECS]
  const only = options.only ?? (options.specs === undefined ? defaultApps(rootDirectory) : options.specs.map((spec) => spec.name))
  const unknown = only.filter((name) => !known.some((spec) => spec.name === name))
  if (unknown.length > 0) throw new Error(`unknown app ${unknown.join(", ")}; expected ${known.map((spec) => spec.name).join(", ")}`)
  const specs = known.filter((spec) => only.includes(spec.name))
  const mountedApps = await Promise.all(specs.map((spec) => mountApp(spec, options)))
  const hosts = new Map(mountedApps.map(({ host }, index) => [specs[index]?.name ?? "", host]))

  const gate = options.gate ?? (login ? createLoginGate({ fetchImpl: hostFetch, whoAmI: `${nextcloudUrl.replace(/\/+$/, "")}/ocs/v2.php/cloud/user?format=json`, host: nextcloudHost, loginOrigin: `https://${nextcloudHost}`, ownerId }) : undefined)
  if (gate === undefined) log("media-server: NO LOGIN. Everybody who can reach this port can read everything. Never run it like this where the port is open.")
  const server = createServer(createMediaRouter({ apps: mountedApps.map(({ mounted }) => mounted), movedBases: MOVED_BASES, retiredBases: RETIRED_BASES, proxy: createProxy({ upstream: nextcloudUrl, host: nextcloudHost, log }), gate, log }))
  // The reverse proxy keeps connections open; the defaults close them from under it.
  server.keepAliveTimeout = 65_000

  return {
    server,
    hosts,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done())
        server.closeAllConnections()
      }).then(() => Promise.all([...hosts.values()].map((host) => host.close())).then(() => undefined)),
  }
}

if (import.meta.filename === process.argv[1]) {
  const rootDirectory = resolve(import.meta.dirname, "..")
  const flag = process.argv.indexOf("--port")
  const port = Number((flag === -1 ? undefined : process.argv[flag + 1]) ?? process.env["PORT"] ?? 3000)
  const media = await createMediaServer({
    rootDirectory,
    dataDirectory: resolve(process.env["DATA_DIR"] ?? join(rootDirectory, ".data")),
    ...(process.env["APPER_DIR"] === undefined ? {} : { apperDirectory: resolve(process.env["APPER_DIR"]) }),
    ...(process.env["PICTURES_DIR"] === undefined ? {} : { picturesDirectory: resolve(process.env["PICTURES_DIR"]) }),
    nextcloudUrl: process.env["NEXTCLOUD_URL"] ?? "http://nextcloud:80",
    nextcloudHost: process.env["NEXTCLOUD_HOST"] ?? "sky.lmfaole.party",
    ownerId: process.env["OWNER_UID"] ?? "ole",
    login: process.env["MEDIA_LOGIN"] !== "off",
    ...(process.env["MEDIA_ONLY"] === undefined ? {} : { only: process.env["MEDIA_ONLY"].split(",").map((name) => name.trim()) }),
  })
  media.server.listen(port, "0.0.0.0", () => {
    console.log(`media-server: ${[...media.hosts.keys()].join(", ")} on http://0.0.0.0:${port}`)
  })
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void media.close().then(() => process.exit(0)))
}
