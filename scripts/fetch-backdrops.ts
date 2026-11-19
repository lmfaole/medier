/**
 * `npm run snapshot` in a watch-log app (`apps/film`, `apps/tv`), after the snapshot: lands every backdrop it names
 * (`images.ts`) so the app serves them itself. TMDB asks to be credited, which those pages do (`TmdbNotice`).
 */

import { basename, join, resolve } from "node:path"

import { BACKDROP_PATH, backdropPathsIn, tmdbBackdropUrl } from "@designsystem/config/backdrop-source"

import { httpFetcher, imagesNamedIn, landImages } from "./images.ts"

const appDirectory = process.cwd()
/** Which app is asking, for the user agent TMDB sees and the address it points at. */
const app = basename(appDirectory)
const named = imagesNamedIn(join(appDirectory, "web", "public", "api"), backdropPathsIn)
const result = await landImages({
  named,
  prefix: "/backdrops/",
  store: join(resolve(appDirectory, "..", ".."), ".data", "raw", "backdrops"),
  target: join(appDirectory, "web", "public", "backdrops"),
  upstream: (path) => {
    const file = BACKDROP_PATH.exec(path)?.[1]
    return file === undefined ? null : { url: tmdbBackdropUrl(file), headers: { "User-Agent": `${app}-backdrops/0.1 (+https://sky.lmfaole.party/apps/${app})` } }
  },
  fetcher: httpFetcher,
})
console.log(`backdrops: ${named.length} named, ${result.kept} already here, ${result.landed} landed, ${result.missing.length} TMDB did not give (tried again next time)`)
