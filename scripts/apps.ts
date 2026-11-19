/**
 * The one list of apps. `run-apps` runs a script in each and `dev-all` starts
 * each on its port; `apps.test.ts` fails when an app directory is not here.
 */

export interface AppEntry {
  name: string
  /** The Vite dev port, one per app with pages; an app that is only data (its sync) has none. */
  port?: number
}

export const APPS: readonly AppEntry[] = [
  { name: "music", port: 5176 },
  { name: "podkast", port: 5186 },
  { name: "film", port: 5188 },
  { name: "tv", port: 5190 },
  { name: "games", port: 5192 },
  { name: "books", port: 5194 },
  { name: "boardgames", port: 5196 },
  { name: "medier", port: 5200 },
  { name: "work", port: 5182 },
  { name: "forside", port: 5184 },
]

/**
 * Apps that stand alone on a host of their own, public and findable, outside the personal registry
 * (`packages/ui/src/lib/apps.ts`): no sidebar, no link to the other apps. `work` and `forside` are the two.
 */
export const PUBLIC_APPS: readonly string[] = ["work", "forside"]

/**
 * The hub of the media apps (`apps/medier`): the page that lists them and the one app a browser installs. It runs in the media
 * server like them, but is no app of the registry (`packages/ui/src/lib/hub.ts`).
 */
export const HUB_APP = "medier"

/**
 * What the one Node server (`media-server.ts`) mounts: the seven media apps under `/apps/medier/<slug>` and the hub at
 * `/apps/medier`. No Worker, no snapshot; it answers from the local databases and `npm run media:build` builds them.
 * `forside` and `work` stay on Cloudflare.
 */
export const MEDIA_APPS: readonly string[] = ["music", "podkast", "film", "tv", "games", "books", "boardgames", HUB_APP]

/**
 * The four home apps of the home server (`packages/ui/src/lib/apps.ts`, `docs/HOME-APPS-MIGRATION.md`): the media server mounts each at
 * `/apps/hjemmeserver/<name>` once it has code (`apps/<name>/web/src/server/api.ts`). One is an entry of `APPS` above only once it has a `web`
 * workspace, so `run-apps` and `affected` do not look for a directory that is not there yet.
 */
export const HOME_APP_NAMES: readonly string[] = ["innboks", "hjem", "miniflux", "penger"]

/** The home apps that have a workspace: they are in `APPS`, and are built and served like the media apps. */
export const HOME_APPS_BUILT: readonly string[] = HOME_APP_NAMES.filter((name) => APPS.some((app) => app.name === name))

/**
 * Every app the media server serves that has a build of its own: what `npm run media:build` builds, what a change is put live for by
 * restarting the server (never a Cloudflare deploy: `ship` refuses them), and what `affected` calls a media change.
 */
export const SERVED_APPS: readonly string[] = [...MEDIA_APPS, ...HOME_APPS_BUILT]

/** The apps that have the script and the ones that do not, each in the order given. */
export function partitionByScript(apps: readonly string[], hasScript: (app: string) => boolean): { run: string[]; skipped: string[] } {
  return { run: apps.filter(hasScript), skipped: apps.filter((app) => !hasScript(app)) }
}

/** The app names a command was given (the arguments that are not flags), refused with the list of apps when one is not an app. */
export function namedApps(args: readonly string[]): string[] {
  const named = args.filter((arg) => !arg.startsWith("--"))
  const unknown = named.filter((name) => !APPS.some((app) => app.name === name))
  if (unknown.length > 0) throw new Error(`unknown app ${unknown.join(", ")}; expected ${APPS.map((app) => app.name).join(", ")}`)
  return named
}
