/**
 * `npm run cover:colors`: the colour of each album cover, for the charts of an album's, a song's and an artist's page. The covers are the
 * pictures landed under `apps/music/web/public/covers/<release>/<image>-250.jpg`; a cover's key is `<release>/<image>`, as the pages' data
 * names it. Each gets one colour: the hue that most of the picture's colourful pixels share (a grey cover gets a grey), moved to a
 * lightness and strength that read on both the light and the dark theme. They are kept in `.data/music-cover-colors.csv` (`cover,color`),
 * which `music-sync import-cover-colors` makes `music_cover_color` of; a cover already in the file is not read again.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import sharp from "sharp"

const ROOT = join(import.meta.dirname, "..")
const COVERS = join(ROOT, "apps", "music", "web", "public", "covers")
const FILE = join(ROOT, ".data", "music-cover-colors.csv")
const BINS = 12
/** Lightness of the colour in OKLab: light enough for a dark page and dark enough for a light one. */
const LIGHTNESS = [0.58, 0.76] as const

const linear = (value: number): number => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
const gamma = (value: number): number => (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055)

function toOklch([red, green, blue]: [number, number, number]): [number, number, number] {
  const [r, g, b] = [linear(red / 255), linear(green / 255), linear(blue / 255)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const lab: [number, number, number] = [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
  return [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])]
}

function toHex([lightness, chroma, hue]: [number, number, number]): string {
  // Chroma comes down until the colour fits the screen, so a vivid blue does not clip into another hue.
  for (let c = chroma; c >= 0; c -= 0.005) {
    const [a, b] = [c * Math.cos(hue), c * Math.sin(hue)]
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    if (rgb.every((value) => value >= -0.0005 && value <= 1.0005)) return `#${rgb.map((value) => Math.round(255 * gamma(Math.min(1, Math.max(0, value)))).toString(16).padStart(2, "0")).join("")}`
  }
  return "#808080"
}

/** The colour a cover stands for, or none for a picture that cannot be read. */
async function colourOf(file: string): Promise<string | undefined> {
  const { data } = await sharp(file).resize(24, 24, { fit: "cover" }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const bins = Array.from({ length: BINS }, () => ({ weight: 0, red: 0, green: 0, blue: 0 }))
  let [red, green, blue, count] = [0, 0, 0, 0]
  for (let index = 0; index + 2 < data.length; index += 3) {
    const [r, g, b] = [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0]
    const [lightness, chroma, hue] = toOklch([r, g, b])
    red += r
    green += g
    blue += b
    count++
    // Colourful and not near black or white: a pixel that says what the cover looks like.
    const weight = chroma * (1 - Math.abs(lightness - 0.6))
    const bin = bins[Math.floor(((hue + Math.PI) / (2 * Math.PI)) * BINS) % BINS]
    if (bin === undefined) continue
    bin.weight += weight
    bin.red += r * weight
    bin.green += g * weight
    bin.blue += b * weight
  }
  if (count === 0) return undefined
  const best = bins.reduce((top, bin) => (bin.weight > top.weight ? bin : top))
  const colour: [number, number, number] = best.weight > 0.5 ? [best.red / best.weight, best.green / best.weight, best.blue / best.weight] : [red / count, green / count, blue / count]
  const [lightness, chroma, hue] = toOklch(colour)
  return toHex([Math.min(LIGHTNESS[1], Math.max(LIGHTNESS[0], lightness)), chroma < 0.02 ? 0 : Math.max(chroma, 0.06), hue])
}

const known = new Set(existsSync(FILE) ? readFileSync(FILE, "utf8").split("\n").slice(1).map((line) => line.split(",")[0]) : [])
let added = 0
const lines: string[] = existsSync(FILE) ? [] : ["cover,color"]
for (const release of readdirSync(COVERS)) {
  for (const name of readdirSync(join(COVERS, release))) {
    const image = /^(\d+)-250\.jpg$/.exec(name)?.[1]
    if (image === undefined || known.has(`${release}/${image}`)) continue
    const colour = await colourOf(join(COVERS, release, name)).catch(() => undefined)
    if (colour === undefined) continue
    lines.push(`${release}/${image},${colour}`)
    added++
  }
}
if (lines.length > 0) appendFileSync(FILE, `${lines.join("\n")}\n`)
process.stdout.write(`cover colours: ${added} new, ${known.size} before\n`)
