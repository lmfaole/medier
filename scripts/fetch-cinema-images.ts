/**
 * `npm run snapshot` in the film app, after the snapshot: lands the picture of every cinema the pages name (`/cinemas/<file>`),
 * from the address `film-cinemas.csv` gives for it (a photo on the cinema's own site, kept in `film_cinema.image`), so the app
 * serves them itself (`images.ts`). The path is a function of the address (`cinema-image.ts`).
 */

import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { cinemaImagePath, cinemaImagePathsIn } from "@designsystem/config/cinema-image"

import { httpFetcher, imagesNamedIn, landImages } from "./images.ts"

const appDirectory = process.cwd()
const root = resolve(appDirectory, "..", "..")
const named = imagesNamedIn(join(appDirectory, "web", "public", "api"), cinemaImagePathsIn)

const db = new DatabaseSync(join(root, ".data", "film.db"), { readOnly: true })
const sources = new Map<string, string>()
for (const row of db.prepare("SELECT image FROM film_cinema WHERE image IS NOT NULL").all()) {
  const address = typeof row["image"] === "string" ? row["image"] : null
  const path = address === null ? null : cinemaImagePath(address)
  if (address !== null && path !== null) sources.set(path, address)
}
db.close()

const result = await landImages({
  named,
  prefix: "/cinemas/",
  store: join(root, ".data", "raw", "cinemas"),
  target: join(appDirectory, "web", "public", "cinemas"),
  upstream: (path) => {
    const url = sources.get(path)
    return url === undefined ? null : { url, headers: { "User-Agent": "film-cinemas/0.1 (+https://sky.lmfaole.party/apps/medier/film)" } }
  },
  fetcher: httpFetcher,
})
console.log(`cinemas: ${named.length} named, ${result.kept} already here, ${result.landed} landed, ${result.missing.length} not given (tried again next time)`)
