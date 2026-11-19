/**
 * `npm run concert:albums [-- --apply]`: makes the Immich albums of the concerts match the list of the music app. An album is named as the
 * list names its concert (`concertAlbumName`: «Konsert: artist, venue, year», or «Festival: name and year»), whoever made it: `event-albums`
 * from the calendar or `concert-album.ts`. A festival has one album for all its days: the albums of its days are merged into the first,
 * which keeps the photos of each, and the others (empty of anything the first lacks) are deleted; the photos themselves are never deleted.
 * `.data/music-concert-albums.csv` is rewritten to name the merged album for each day. Without `--apply` only what would change is printed.
 * Needs `IMMICH_URL` and `IMMICH_API_KEY` as `event-albums` does.
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import * as v from "valibot"

import { sqliteAsD1 } from "../packages/config/sqlite-d1.ts"
import { concertAlbumName, isFestival } from "../apps/music/web/src/lib/concert-label.ts"
import { concerts } from "../apps/music/web/src/server/concerts.ts"
import { immichEnv as env, immichSend } from "./immich-api.ts"
import { withCargoOnPath } from "./sync-schedule.ts"

const ROOT = join(import.meta.dirname, "..")
const FILE = join(ROOT, ".data", "music-concert-albums.csv")
const apply = process.argv.includes("--apply")


const send = immichSend

const albumList = v.array(v.object({ id: v.string(), albumName: v.string() }))
const albumAssets = v.object({ assets: v.array(v.object({ id: v.string() })) })

const database = new DatabaseSync(join(ROOT, ".data", "music.db"), { readOnly: true })
const list = (await concerts(sqliteAsD1(database), new Date().toISOString().slice(0, 10))).concerts.flatMap((concert) => (concert.albumId === null || concert.upcoming ? [] : [{ concert, albumId: concert.albumId }]))

const albums = new Map(v.parse(albumList, await (await send("GET", "/albums")).json()).map((album) => [album.id, album.albumName]))
const merged = new Map<string, string>()
const rename = new Map<string, string>()

const festivals = new Map<string, typeof list>()
for (const entry of list.filter((candidate) => isFestival(candidate.concert))) festivals.set(entry.concert.title, [...(festivals.get(entry.concert.title) ?? []), entry])
for (const days of festivals.values()) {
  const [first] = days
  if (first === undefined) continue
  const ids = [...new Set(days.map((day) => day.albumId))]
  const target = first.albumId
  for (const day of days) merged.set(`${day.concert.on}\u0000${day.concert.title}`, target)
  rename.set(target, concertAlbumName(first.concert))
  for (const other of ids.slice(1)) {
    process.stdout.write(`${rename.get(target)}: merge ${albums.get(other)} into ${albums.get(target)}\n`)
    if (!apply) continue
    const assets = v.parse(albumAssets, await (await send("GET", `/albums/${other}`)).json()).assets.map((asset) => asset.id)
    if (assets.length > 0) await send("PUT", `/albums/${target}/assets`, { ids: assets })
    await send("DELETE", `/albums/${other}`)
  }
}
for (const entry of list.filter((candidate) => !isFestival(candidate.concert))) rename.set(entry.albumId, concertAlbumName(entry.concert))

for (const [id, name] of rename) {
  if (albums.get(id) === name) continue
  process.stdout.write(`${albums.get(id) ?? id}  ->  ${name}\n`)
  if (apply) await send("PATCH", `/albums/${id}`, { albumName: name })
}

if (apply && merged.size > 0 && existsSync(FILE)) {
  const quote = (text: string): string => (/[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text)
  const lines = readFileSync(FILE, "utf8").split("\n").filter((line) => line !== "")
  const rewritten = lines.map((line, index) => {
    const match = /^(\d{4}-\d{2}-\d{2}),(?:"((?:[^"]|"")*)"|([^,]*)),([^,]+)$/.exec(line)
    if (index === 0 || match === null) return line
    const title = match[2]?.replaceAll('""', '"') ?? match[3] ?? ""
    const target = merged.get(`${match[1]}\u0000${title}`)
    return target === undefined ? line : `${match[1]},${quote(title)},${target}`
  })
  writeFileSync(FILE, `${rewritten.join("\n")}\n`)
  const imported = spawnSync("cargo", ["run", "-q", "-p", "music-sync", "--", "import-concerts"], { cwd: join(ROOT, "apps", "music"), encoding: "utf8", env: { ...env, PATH: withCargoOnPath(process.env["PATH"], homedir()) } })
  process.stdout.write(imported.status === 0 ? imported.stdout : imported.stderr)
}
