/**
 * `npm run venue:maps [-- --apply]`: where the venues of the concerts are, and a map of each. The venues are those of `music_concert` and
 * `music_concert_event`; a venue that `.data/music-venues.csv` (`venue,lat,lon`, written by hand or by this) has no place for is looked up
 * in OpenStreetMap's Nominatim (one request a second, the answer kept in the file, so a wrong place is corrected by editing the line and never
 * asked again). Each venue with a place gets a 512 pixel map of OpenStreetMap's tiles with a mark on it, kept as
 * `.data/concert-photos/venue-<slug>.webp`, which the music server serves itself, so a page never asks a tile server. Without `--apply` the
 * venues without a place are only listed. `music-sync import-concerts` makes `music_venue` of the file. The map is © OpenStreetMap contributors.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import sharp, { type OverlayOptions } from "sharp"
import * as v from "valibot"

import { slugify } from "../packages/content/src/slug.ts"

const ROOT = join(import.meta.dirname, "..")
const DATA = join(ROOT, ".data")
const FILE = join(DATA, "music-venues.csv")
const MAPS = join(DATA, "concert-photos")
const AGENT = "music-sync venue-maps (personal use)"
const ZOOM = 14
const SIZE = 512
const apply = process.argv.includes("--apply")

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

const database = new DatabaseSync(join(DATA, "music.db"), { readOnly: true })
const venues = v
  .parse(v.array(v.object({ venue: v.string() })), database.prepare("SELECT DISTINCT venue FROM (SELECT place AS venue FROM music_concert UNION SELECT venue FROM music_concert_event) WHERE venue IS NOT NULL AND venue != '' ORDER BY venue").all())
  .map((row) => row.venue)

function readPlaces(): Map<string, { lat: number; lon: number }> {
  const places = new Map<string, { lat: number; lon: number }>()
  if (!existsSync(FILE)) return places
  for (const line of readFileSync(FILE, "utf8").split("\n").slice(1)) {
    const match = /^(?:"((?:[^"]|"")*)"|([^,]*)),(-?[\d.]+),(-?[\d.]+)$/.exec(line.trim())
    if (match !== null) places.set(match[1]?.replaceAll('""', '"') ?? match[2] ?? "", { lat: Number(match[3]), lon: Number(match[4]) })
  }
  return places
}

async function geocode(venue: string): Promise<{ lat: number; lon: number; name: string } | undefined> {
  // A name with no city is one of Oslo's.
  const query = venue.includes(",") ? venue : `${venue}, Oslo`
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`, { headers: { "user-agent": AGENT } })
  if (!response.ok) throw new Error(`Nominatim answered ${response.status} for ${venue}`)
  const [hit] = v.parse(v.array(v.object({ lat: v.string(), lon: v.string(), display_name: v.string() })), await response.json())
  return hit === undefined ? undefined : { lat: Number(hit.lat), lon: Number(hit.lon), name: hit.display_name }
}

const places = readPlaces()
for (const venue of venues.filter((name) => !places.has(name))) {
  if (!apply) {
    process.stdout.write(`${venue}: no place yet\n`)
    continue
  }
  const hit = await geocode(venue)
  await pause(1100)
  process.stdout.write(`${venue}: ${hit === undefined ? "not found" : `${hit.lat}, ${hit.lon} (${hit.name})`}\n`)
  if (hit === undefined) continue
  places.set(venue, hit)
  appendFileSync(FILE, `${existsSync(FILE) ? "" : "venue,lat,lon\n"}"${venue.replaceAll('"', '""')}",${hit.lat},${hit.lon}\n`)
}

/** The pixel of the point in the world of the zoom's tiles. */
function pixel(lat: number, lon: number): { x: number; y: number } {
  const scale = 256 * 2 ** ZOOM
  const sine = Math.sin((lat * Math.PI) / 180)
  return { x: ((lon + 180) / 360) * scale, y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale }
}

async function map(lat: number, lon: number): Promise<Buffer> {
  const { x, y } = pixel(lat, lon)
  const [tx, ty] = [Math.floor(x / 256), Math.floor(y / 256)]
  const layers: OverlayOptions[] = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const response = await fetch(`https://tile.openstreetmap.org/${ZOOM}/${tx + dx}/${ty + dy}.png`, { headers: { "user-agent": AGENT } })
      if (!response.ok) throw new Error(`the tile server answered ${response.status}`)
      layers.push({ input: Buffer.from(await response.arrayBuffer()), left: (dx + 1) * 256, top: (dy + 1) * 256 })
      await pause(250)
    }
  }
  const [px, py] = [Math.round(x - (tx - 1) * 256), Math.round(y - (ty - 1) * 256)]
  const pin = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="14" fill="#d6204a" stroke="#fff" stroke-width="4"/></svg>'
  layers.push({ input: Buffer.from(pin), left: px - 20, top: py - 20 })
  // `extract` runs before `composite` in one pipeline, so the picture is made first and cut afterwards.
  const whole = await sharp({ create: { width: 768, height: 768, channels: 3, background: "#ffffff" } }).composite(layers).png().toBuffer()
  return sharp(whole)
    .extract({ left: px - SIZE / 2, top: py - SIZE / 2, width: SIZE, height: SIZE })
    .webp({ quality: 80 })
    .toBuffer()
}

if (apply) {
  mkdirSync(MAPS, { recursive: true })
  for (const venue of venues) {
    const place = places.get(venue)
    const file = join(MAPS, `venue-${slugify(venue)}.webp`)
    if (place === undefined || existsSync(file)) continue
    writeFileSync(file, await map(place.lat, place.lon))
    process.stdout.write(`map of ${venue}: ${file}\n`)
  }
}
