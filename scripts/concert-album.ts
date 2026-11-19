/**
 * `npm run concert:album -- <date> <title> [from] [to] [--apply]`: the Immich album of a concert of the log (`music-concerts.csv`) that has
 * no calendar event, so no album from `event-albums`. It holds the photos taken on the day, by their local time between `from` and `to`
 * (`HH:MM`; the whole day by default), is named as the list names its concert (`concertAlbumName`: `Konsert: <artist>, <venue>, <year>`; `npm run concert:albums` renames and merges the albums of a festival), and is written down in
 * `.data/music-concert-albums.csv` (`watched_on,title,album_id`), which `music-sync import-concerts` reads, so the concert's page links to
 * it and `concert-photos` keeps its favourites. An album that exists gets the photos it lacks and is never emptied. Without `--apply`
 * only the number of photos is printed. Needs `IMMICH_URL` and `IMMICH_API_KEY` as `event-albums` does (`~/.config/immich-sync.env`).
 */

import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import * as v from "valibot"

import { sqliteAsD1 } from "../packages/config/sqlite-d1.ts"
import { concertAlbumName } from "../apps/music/web/src/lib/concert-label.ts"
import { concerts } from "../apps/music/web/src/server/concerts.ts"
import { immichEnv as env, immichSend } from "./immich-api.ts"
import { withCargoOnPath } from "./sync-schedule.ts"

const ROOT = join(import.meta.dirname, "..")
const FILE = join(ROOT, ".data", "music-concert-albums.csv")
const apply = process.argv.includes("--apply")
const [date, title, from = "00:00", to = "23:59"] = process.argv.slice(2).filter((argument) => argument !== "--apply")
if (date === undefined || title === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  throw new Error("usage: concert-album.ts <YYYY-MM-DD> <title> [from HH:MM] [to HH:MM] [--apply]")
}


async function call<Schema extends v.GenericSchema>(schema: Schema, method: string, path: string, body?: unknown): Promise<v.InferOutput<Schema>> {
  return v.parse(schema, await (await immichSend(method, path, body)).json())
}

const page = v.object({ assets: v.object({ items: v.array(v.object({ id: v.string(), localDateTime: v.string() })), nextPage: v.nullable(v.string()) }) })
const albumList = v.array(v.object({ id: v.string(), albumName: v.string() }))
const created = v.object({ id: v.string() })

/** The photos of the day taken between the times: the search is padded a day each way, since a photo's local time is not its UTC time. */
async function photos(): Promise<string[]> {
  const noon = new Date(`${date}T12:00:00Z`).getTime()
  const ids: string[] = []
  for (let next: string | null = "1"; next !== null; ) {
    const result: v.InferOutput<typeof page> = await call(page, "POST", "/search/metadata", { takenAfter: new Date(noon - 36 * 3_600_000).toISOString(), takenBefore: new Date(noon + 36 * 3_600_000).toISOString(), size: 1000, page: Number(next) })
    ids.push(...result.assets.items.filter((item) => item.localDateTime.slice(0, 10) === date && item.localDateTime.slice(11, 16) >= from && item.localDateTime.slice(11, 16) <= to).map((item) => item.id))
    next = result.assets.nextPage
  }
  return ids
}

const concert = (await concerts(sqliteAsD1(new DatabaseSync(join(ROOT, ".data", "music.db"), { readOnly: true })), new Date().toISOString().slice(0, 10))).concerts.find((candidate) => candidate.on === date && candidate.title === title)
if (concert === undefined) throw new Error(`no concert «${title}» on ${date}: add it with music-sync add-concert first`)
const name = concertAlbumName(concert)
const ids = await photos()
const existing = (await call(albumList, "GET", "/albums")).find((album) => album.albumName === name)
process.stdout.write(`${name}: ${ids.length} photos (${existing === undefined ? "new" : "exists"})\n`)
if (apply && ids.length > 0) {
  let albumId: string
  if (existing === undefined) albumId = (await call(created, "POST", "/albums", { albumName: name, assetIds: ids })).id
  else {
    await call(v.unknown(), "PUT", `/albums/${existing.id}/assets`, { ids })
    albumId = existing.id
  }

  // The day's own line: the days of a festival all name the one album, so the album's id does not tell whether the day is written down.
  const known = existsSync(FILE) ? readFileSync(FILE, "utf8") : ""
  const quote = (text: string): string => (/[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text)
  const line = `${date},${quote(title)},`
  if (!known.split("\n").some((candidate) => candidate.startsWith(line))) {
    appendFileSync(FILE, `${known === "" ? "watched_on,title,album_id\n" : ""}${line}${albumId}\n`)
  }
  const imported = spawnSync("cargo", ["run", "-q", "-p", "music-sync", "--", "import-concerts"], { cwd: join(ROOT, "apps", "music"), encoding: "utf8", env: { ...env, PATH: withCargoOnPath(process.env["PATH"], homedir()) } })
  process.stdout.write(imported.status === 0 ? imported.stdout : imported.stderr)
}
