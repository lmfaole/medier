/**
 * `npm run snapshot` in `apps/music`, after the snapshot: lands every cover the snapshot names
 * (`images.ts`) so the app serves them itself instead of asking the Cover Art Archive. A release whose album Spotify
 * has a cover for (`spotify-album-images`) is landed from Spotify, under the path the archive's cover would have had.
 */

import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import { join, resolve } from "node:path"

import { archiveThumbnailUrl, COVER_PATH, COVER_USER_AGENT, coverPathsIn } from "@designsystem/config/cover-archive"

import { httpFetcher, imagesNamedIn, landImages } from "./images.ts"

const appDirectory = process.cwd()
const root = resolve(appDirectory, "..", "..")
const SQL_SPOTIFY = "SELECT release_mbid, image FROM album_spotify WHERE image IS NOT NULL"
const database = process.env["MUSIC_DB"] ?? join(root, ".data", "music.db")
const spotify = new Map<string, string>()
if (existsSync(database)) {
  const sqlite = new DatabaseSync(database, { readOnly: true })
  try {
    for (const row of sqlite.prepare(SQL_SPOTIFY).all()) spotify.set(String(row["release_mbid"]), String(row["image"]))
  } catch {
    // A database from before `album_spotify` has no Spotify covers; the archive's are landed.
  }
  sqlite.close()
}
const spotifyOf = (path: string): string | undefined => {
  const release = COVER_PATH.exec(path)?.[1]
  return release === undefined ? undefined : spotify.get(release)
}
const named = imagesNamedIn(join(appDirectory, "web", "public", "api"), coverPathsIn)
const result = await landImages({
  named,
  prefix: "/covers/",
  store: (path) => join(root, ".data", "raw", spotifyOf(path) === undefined ? "covers" : "covers-spotify"),
  target: join(appDirectory, "web", "public", "covers"),
  upstream: (path) => {
    const picture = spotifyOf(path)
    if (picture !== undefined) return { url: picture, headers: { "User-Agent": COVER_USER_AGENT } }
    const [, release, image] = COVER_PATH.exec(path) ?? []
    return release === undefined || image === undefined ? null : { url: archiveThumbnailUrl(release, image), headers: { "User-Agent": COVER_USER_AGENT } }
  },
  fetcher: httpFetcher,
})
console.log(`covers: ${named.length} named, ${result.kept} already here, ${result.landed} landed, ${result.missing.length} the archive did not give (tried again next time)`)
