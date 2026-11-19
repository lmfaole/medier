/**
 * `npm run snapshot` in `apps/music`, after the snapshot: lands every artist picture the snapshot's artist pages name
 * (`images.ts`) so the app serves them itself. A page names the picture's path and the address it comes from (Spotify, Deezer or Commons); only
 * an address `spotify-images`, `deezer-images` or `enrich-extra` stores is asked for.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { ARTIST_IMAGE_PATH, ARTIST_IMAGE_USER_AGENT, DEEZER_IMAGE_ADDRESS, isImageAddress, SPOTIFY_IMAGE_ADDRESS } from "@designsystem/config/artist-image"
import * as v from "valibot"

import { httpFetcher, landImages } from "./images.ts"

const appDirectory = process.cwd()
const entities = join(appDirectory, "web", "public", "api", "entity")
const Page = v.object({ kind: v.string(), image: v.nullable(v.string()), imageSource: v.nullable(v.string()) })
const sources = new Map<string, string>()
for (const name of existsSync(entities) ? readdirSync(entities).filter((file) => file.startsWith("kind=artist,")) : []) {
  const page = v.safeParse(Page, JSON.parse(readFileSync(join(entities, name), "utf8")))
  if (page.success && page.output.image !== null && page.output.imageSource !== null && ARTIST_IMAGE_PATH.test(page.output.image) && isImageAddress(page.output.imageSource)) sources.set(page.output.image, page.output.imageSource)
}
const storeOf = (address: string): string => (SPOTIFY_IMAGE_ADDRESS.test(address) ? "artist-images-spotify" : DEEZER_IMAGE_ADDRESS.test(address) ? "artist-images-deezer" : "artist-images")
const named = [...sources.keys()].toSorted()
const raw = join(resolve(appDirectory, "..", ".."), ".data", "raw")
const result = await landImages({
  named,
  prefix: "/artists/",
  // A picture is kept under the source it came from, so a landed Commons original is never replaced by Deezer's.
  store: (path) => join(raw, storeOf(sources.get(path) ?? "")),
  target: join(appDirectory, "web", "public", "artists"),
  upstream: (path) => {
    const url = sources.get(path)
    return url === undefined ? null : { url, headers: { "User-Agent": ARTIST_IMAGE_USER_AGENT } }
  },
  fetcher: httpFetcher,
})
console.log(`artist images: ${named.length} named, ${result.kept} already here, ${result.landed} landed, ${result.missing.length} the source did not give (tried again next time)`)
