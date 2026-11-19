/**
 * The in-process API of each media app, found by the app's base path (`/apps/film`). The server registers one `Fetcher` per app
 * before it loads that app's build, and the build's `cloudflare:workers` (a virtual module, `astro-preset.ts`) hands it to the
 * page as `env.ASSETS`, so `readApi` asks the databases where a Worker would ask the asset store. The registry lives on
 * `globalThis` because the server and every build are separate bundles of this one file.
 */

const KEY = Symbol.for('designsystem.apiFetchers')

type Registry = Map<string, Fetcher>

function registry(): Registry {
  const existing: unknown = Reflect.get(globalThis, KEY)
  if (existing instanceof Map) return existing
  const created: Registry = new Map()
  Reflect.set(globalThis, KEY, created)
  return created
}

/** `base` without a trailing slash. */
const keyOf = (base: string): string => base.replace(/\/+$/, '')

export function registerApiFetcher(base: string, fetcher: Fetcher): void {
  registry().set(keyOf(base), fetcher)
}

export function apiFetcherFor(base: string): Fetcher {
  const fetcher = registry().get(keyOf(base))
  if (fetcher === undefined) throw new Error(`no API fetcher is registered for ${keyOf(base)}: the server registers one before it loads the app`)
  return fetcher
}
