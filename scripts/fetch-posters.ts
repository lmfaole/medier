/**
 * `npm run snapshot` in a watch-log app (`apps/film`, `apps/tv`), after the snapshot: lands every poster it names
 * (`images.ts`) so the app serves them itself. TMDB asks to be credited, which those pages do (`TmdbNotice`).
 */

import { basename, join, resolve } from "node:path"

import { POSTER_PATH, posterPathsIn, tmdbPosterUrl } from "@designsystem/config/poster-source"

import { httpFetcher, imagesNamedIn, landImages } from "./images.ts"

const appDirectory = process.cwd()
/** Which app is asking, for the user agent TMDB sees and the address it points at. */
const app = basename(appDirectory)
const named = imagesNamedIn(join(appDirectory, "web", "public", "api"), posterPathsIn)
const result = await landImages({
  named,
  prefix: "/posters/",
  store: join(resolve(appDirectory, "..", ".."), ".data", "raw", "posters"),
  target: join(appDirectory, "web", "public", "posters"),
  upstream: (path) => {
    const file = POSTER_PATH.exec(path)?.[1]
    return file === undefined ? null : { url: tmdbPosterUrl(file), headers: { "User-Agent": `${app}-posters/0.1 (+https://sky.lmfaole.party/apps/${app})` } }
  },
  fetcher: httpFetcher,
})
console.log(`posters: ${named.length} named, ${result.kept} already here, ${result.landed} landed, ${result.missing.length} TMDB did not give (tried again next time)`)
