/**
 * `npm run fetch`: asks Last.fm and Trakt (and TMDB, for the posters) for what was played and watched, and writes `data/music.json` and `data/watched.json`. The keys are
 * GitHub Actions secrets (`src/lib/settings.ts`); locally a source whose key is not set is skipped, in CI it is an error (`settings:check` runs
 * first and names it). A file is only rewritten when what it holds changed, so a run that found
 * nothing new makes no commit. GitHub Actions runs it on a timer with the keys as secrets (`.github/workflows/site.yml`).
 *
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { type Music, parseRecentTracks, parseTopArtists } from "../src/lib/lastfm.ts"
import { SETTINGS } from "../src/lib/settings.ts"
import { authorize, detailsUrl, parsePoster } from "../src/lib/tmdb.ts"
import { mergeHistory, parseHistory, type Watch, type Watched } from "../src/lib/trakt.ts"

const DATA = join(import.meta.dirname, "..", "data")
const AGENT = "lmfaole-medier (https://github.com/lmfaole/medier)"

async function json(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": AGENT, ...headers } })
  if (!response.ok) throw new Error(`${new URL(url).host}: ${response.status} ${response.statusText}`)
  return response.json()
}

/** Writes the file when anything but its time changed; says which it was. */
function save<T extends { at: string | null }>(name: string, next: Omit<T, "at">): void {
  const file = join(DATA, name)
  const before: unknown = JSON.parse(readFileSync(file, "utf8"))
  const { at: _, ...rest } = before as T
  if (JSON.stringify(rest) === JSON.stringify(next)) {
    console.log(`${name}: unchanged`)
    return
  }
  writeFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...next }, null, 2)}\n`)
  console.log(`${name}: written`)
}

async function music(key: string, user: string): Promise<void> {
  const base = `https://ws.audioscrobbler.com/2.0/?format=json&api_key=${encodeURIComponent(key)}&user=${encodeURIComponent(user)}`
  const recent = parseRecentTracks(await json(`${base}&method=user.getrecenttracks&limit=50`))
  const topArtists = parseTopArtists(await json(`${base}&method=user.gettopartists&period=1month&limit=10`))
  // What is playing now changes every few minutes and is gone by the next build: only finished plays are kept.
  save<Music>("music.json", { user, recent: recent.filter((play) => play.playedAt !== null), topArtists })
}

/**
 * Each film and show keeps the poster it was given before; only the ones without one are asked of TMDB (a film that has no poster is asked again each
 * time, which is a few calls). A poster that cannot be fetched is left out, it does not fail the run: the row shows an empty frame.
 */
async function withPosters(items: Watch[], tmdbKey: string): Promise<Watch[]> {
  const known = new Map<string, string>()
  try {
    const before = JSON.parse(readFileSync(join(DATA, "watched.json"), "utf8")) as Partial<Watched>
    for (const watch of before.items ?? []) if (watch.poster) known.set(`${watch.kind}:${watch.tmdbId}`, watch.poster)
  } catch {
    // no file yet: nothing is known
  }
  const posters = new Map(known)
  if (tmdbKey !== "") {
    const wanted = new Map(items.filter((watch) => watch.tmdbId !== null && !posters.has(`${watch.kind}:${watch.tmdbId}`)).map((watch) => [`${watch.kind}:${watch.tmdbId}`, watch]))
    await Promise.all(
      [...wanted].map(async ([key, watch]) => {
        try {
          const request = authorize(tmdbKey, detailsUrl(watch.kind, watch.tmdbId ?? 0))
          const poster = parsePoster(await json(request.url, request.headers))
          if (poster !== null) posters.set(key, poster)
        } catch (error) {
          console.error(`poster for ${watch.title}: ${String(error)}`)
        }
      }),
    )
  }
  return items.map((watch) => ({ ...watch, poster: posters.get(`${watch.kind}:${watch.tmdbId}`) ?? null }))
}

async function watched(clientId: string, user: string, tmdbKey: string): Promise<void> {
  const headers = { "trakt-api-version": "2", "trakt-api-key": clientId }
  const page = async (kind: string) => parseHistory(await json(`https://api.trakt.tv/users/${encodeURIComponent(user)}/history/${kind}?limit=50`, headers))
  const items = mergeHistory(await page("movies"), await page("episodes")).slice(0, 50)
  save<Watched>("watched.json", { user, items: await withPosters(items, tmdbKey) })
}

/** A setting from the environment, or a variable's fallback; empty for a secret that is not set. */
const setting = (name: string): string => process.env[name] || (SETTINGS.find((one) => one.name === name)?.fallback ?? "")
const jobs: Promise<void>[] = []
for (const [file, key, run] of [
  ["music.json", "LASTFM_API_KEY", () => music(setting("LASTFM_API_KEY"), setting("LASTFM_USER"))],
  ["watched.json", "TRAKT_CLIENT_ID", () => watched(setting("TRAKT_CLIENT_ID"), setting("TRAKT_USER"), setting("TMDB_API_KEY"))],
] as const) {
  if (setting(key) !== "") jobs.push(run())
  else if (process.env["CI"] === "true") jobs.push(Promise.reject(new Error(`${file}: the secret ${key} is not set`)))
  else console.log(`${file}: ${key} is not set, skipped`)
}

// One source failing does not stop the other; the run still fails, so it is seen.
const results = await Promise.allSettled(jobs)
for (const result of results) if (result.status === "rejected") console.error(String(result.reason))
if (results.some((result) => result.status === "rejected")) process.exitCode = 1
