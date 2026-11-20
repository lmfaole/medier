// One-off: fetches real metadata and pictures from public, keyless APIs for the made-up data of `src/lib/mock.ts` (local development only).
//   node scripts/fetch-mock-data.mjs            metadata and pictures: writes src/lib/mock-data.json and public/mock/*
//   node scripts/fetch-mock-data.mjs --images   only the pictures that are missing, from the addresses in the JSON (what a fresh clone runs)
// Sources: Deezer (albums, tracklists, covers, artist pictures), Wikipedia and Wikidata (texts, posters, portraits, years, birthdays).
// The pictures are other people's artwork: they are not committed (public/mock/ is in .gitignore).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

const UA = "lmfaole-medier-mock/1.0 (https://github.com/lmfaole/medier; local development fixtures)"
const DATA = new URL("../src/lib/mock-data.json", import.meta.url)
const OUT = new URL("../public/mock/", import.meta.url)

const ARTISTS = [
  { name: "a-ha", wiki: "A-ha", weight: 10, since: 300, albums: ["Hunting High and Low", "Scoundrel Days"] },
  { name: "Röyksopp", wiki: "Röyksopp", weight: 8, since: 300, albums: ["Melody A.M.", "Junior"] },
  { name: "Kings of Convenience", wiki: "Kings of Convenience", weight: 7, since: 300, albums: ["Riot on an Empty Street", "Quiet Is the New Loud"] },
  { name: "Sigrid", wiki: "Sigrid (singer)", weight: 6, since: 300, albums: ["Sucker Punch", "How to Let Go"] },
  { name: "AURORA", wiki: "Aurora (singer)", weight: 5, since: 300, albums: ["All My Demons Greeting Me as a Friend", "A Different Kind of Human (Step 2)"] },
  { name: "Susanne Sundfør", wiki: "Susanne Sundfør", weight: 4, since: 300, albums: ["Ten Love Songs", "The Brothel"] },
  { name: "Highasakite", wiki: "Highasakite", weight: 3, since: 40, albums: ["Silent Treatment", "Camp Echo"] },
  { name: "Todd Terje", wiki: "Todd Terje", weight: 2, since: 12, albums: ["It's Album Time", "It's the Arps"] },
]

const TITLES = [
  { kind: "film", wiki: "Arrival (film)", title: "Arrival" },
  { kind: "film", wiki: "Blade Runner 2049", title: "Blade Runner 2049" },
  { kind: "film", wiki: "Parasite (2019 film)", title: "Parasite" },
  { kind: "film", wiki: "Ex Machina (film)", title: "Ex Machina" },
  { kind: "film", wiki: "The Worst Person in the World", title: "Verdens verste menneske" },
  { kind: "film", wiki: "Oslo, August 31st", title: "Oslo, 31. august" },
  { kind: "film", wiki: "Headhunters (film)", title: "Hodejegerne" },
  { kind: "film", wiki: "Dune (2021 film)", title: "Dune" },
  { kind: "episode", wiki: "Skam (TV series)", title: "Skam", seasons: 4 },
  { kind: "episode", wiki: "Lilyhammer", title: "Lilyhammer", seasons: 3 },
  { kind: "episode", wiki: "Succession (TV series)", title: "Succession", seasons: 4 },
  { kind: "episode", wiki: "Chernobyl (miniseries)", title: "Chernobyl", seasons: 1 },
]

// The first ten act, then three direct, one writes, two make music: `mock.ts` casts and crews by these places.
const PEOPLE = [
  ["Renate Reinsve", "Acting"], ["Anders Danielsen Lie", "Acting"], ["Aksel Hennie", "Acting"], ["Kristofer Hivju", "Acting"], ["Pedro Pascal", "Acting"], ["Stellan Skarsgård", "Acting"], ["Liv Ullmann", "Acting"], ["Noomi Rapace", "Acting"], ["Ane Dahl Torp", "Acting"], ["Jakob Oftebro", "Acting"],
  ["Joachim Trier", "Directing"], ["Roar Uthaug", "Directing"], ["Denis Villeneuve", "Directing"], ["Jo Nesbø", "Writing"], ["Hans Zimmer", "Sound"], ["Jóhann Jóhannsson", "Sound"],
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchRetry(url, accept) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": UA, ...(accept === undefined ? {} : { Accept: accept }) } })
    if (response.status === 429 || response.status >= 500) {
      await sleep(1500 * (attempt + 1))
      continue
    }
    return response
  }
  throw new Error(`${url}: gave up`)
}

async function json(url) {
  const response = await fetchRetry(url, "application/json")
  if (!response.ok) return null
  return response.json()
}

async function wikiSummary(title) {
  const answer = await json(`https://${title.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.page.replaceAll(" ", "_"))}`)
  return answer?.type === "standard" ? answer : null
}

/** The Norwegian text where Wikipedia has it, else the English; the picture from whichever has one. */
async function wiki(page) {
  const [nb, en] = [await wikiSummary({ lang: "no", page }), await wikiSummary({ lang: "en", page })]
  const text = nb?.extract ?? en?.extract ?? null
  const picture = en?.originalimage ?? nb?.originalimage ?? en?.thumbnail ?? nb?.thumbnail ?? null
  return { text, picture, item: en?.wikibase_item ?? nb?.wikibase_item ?? null }
}

/** A picture's address in a size a page can use: Wikimedia's full-size originals are many megabytes. */
function sized(picture) {
  if (picture === null) return null
  if (picture.width <= 700) return picture.source
  const match = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+)\/(?:thumb\/)?([0-9a-f]\/[0-9a-f]{2}\/([^/?]+))/.exec(picture.source)
  return match === null ? picture.source : `${match[1]}/thumb/${match[2]}/500px-${match[3]}`
}

async function entity(item) {
  if (item === null) return null
  const answer = await json(`https://www.wikidata.org/wiki/Special:EntityData/${item}.json`)
  return answer?.entities?.[item]?.claims ?? null
}

const claims = (all, property) => (all?.[property] ?? []).map((one) => one.mainsnak?.datavalue?.value).filter((value) => value !== undefined)

async function labels(ids) {
  if (ids.length === 0) return []
  const answer = await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=nb|nn|en&ids=${ids.join("|")}`)
  return ids.map((id) => answer?.entities?.[id]?.labels?.nb?.value ?? answer?.entities?.[id]?.labels?.en?.value).filter((label) => label !== undefined)
}

const timeOf = (value) => (typeof value?.time === "string" ? value.time.replace(/^\+/, "").slice(0, 10) : null)

async function image(file, source) {
  const response = await fetchRetry(source)
  if (!response.ok) throw new Error(`${source}: ${response.status}`)
  const type = response.headers.get("content-type") ?? ""
  const extension = type.includes("png") ? "png" : "jpg"
  const path = `/mock/${file}.${extension}`
  writeFileSync(new URL(path.slice("/mock/".length), OUT), Buffer.from(await response.arrayBuffer()))
  return path
}

const slug = (text) => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

mkdirSync(OUT, { recursive: true })

if (process.argv.includes("--images")) {
  const data = JSON.parse(readFileSync(DATA, "utf8"))
  const pictures = [...data.artists.flatMap((artist) => [artist.image, ...artist.albums.map((album) => album.cover)]), ...data.people.map((person) => person.image), ...data.titles.map((title) => title.poster)]
  for (const picture of pictures) {
    if (picture === null || existsSync(new URL(picture.file.slice("/mock/".length), OUT))) continue
    await image(picture.file.slice("/mock/".length).replace(/\.[a-z]+$/, ""), picture.source)
    console.log(`picture ${picture.file}`)
  }
  process.exit(0)
}

const data = { generated: new Date().toISOString(), artists: [], people: [], titles: [] }

for (const [artistIndex, wanted] of ARTISTS.entries()) {
  const found = (await json(`https://api.deezer.com/search/artist?q=${encodeURIComponent(wanted.name)}&limit=1`))?.data?.[0]
  if (found === undefined) throw new Error(`Deezer does not know ${wanted.name}`)
  const albums = []
  const tags = new Set()
  for (const [albumIndex, title] of wanted.albums.entries()) {
    const lookup = async (query) => (await json(`https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=25`))?.data ?? []
    const hits = [...(await lookup(`artist:"${wanted.name}" album:"${title}"`)), ...(await lookup(`${wanted.name} ${title}`)), ...(await lookup(title))].filter((one) => one.artist?.name?.toLowerCase().includes(wanted.name.toLowerCase().slice(0, 5)))
    const same = (one) => one.title.toLowerCase() === title.toLowerCase()
    const alike = (one) => one.record_type === "album" && one.title.toLowerCase().startsWith(title.toLowerCase().slice(0, 12))
    const hit = hits.filter(same).sort((x, y) => y.nb_tracks - x.nb_tracks)[0] ?? hits.filter(alike).sort((x, y) => y.nb_tracks - x.nb_tracks)[0]
    if (hit === undefined) throw new Error(`Deezer does not know ${wanted.name}: ${title}`)
    const album = await json(`https://api.deezer.com/album/${hit.id}`)
    for (const genre of album.genres?.data ?? []) tags.add(genre.name)
    const file = `cover-${artistIndex}-${albumIndex}`
    const source = album.cover_big
    albums.push({ title: album.title, year: Number(String(album.release_date).slice(0, 4)) || null, cover: { file: await image(file, source), source }, tracks: (album.tracks?.data ?? []).slice(0, 14).map((track) => ({ title: track.title, seconds: track.duration })) })
    console.log(`album ${wanted.name}: ${album.title} (${albums.at(-1).tracks.length} tracks)`)
    await sleep(300)
  }
  const about = await wiki(wanted.wiki)
  data.artists.push({ name: found.name, tags: [...tags, "norwegian"].slice(0, 4), weight: wanted.weight, since: wanted.since, bio: about.text ?? `${found.name} er en artist.`, image: { file: await image(`artist-${artistIndex}`, found.picture_big), source: found.picture_big }, albums })
}

for (const [index, [name, department]] of PEOPLE.entries()) {
  const about = await wiki(name.replaceAll(" ", "_"))
  const facts = await entity(about.item)
  const born = timeOf(claims(facts, "P569")[0])
  const placeId = claims(facts, "P19")[0]?.id
  const place = placeId === undefined ? null : ((await labels([placeId]))[0] ?? null)
  const source = sized(about.picture)
  if (source === null) { console.warn(`skipped ${name}: no picture`); continue }
  data.people.push({ id: 7001 + index, name, department, born, place, bio: about.text ?? `${name} er en kjent person.`, image: { file: await image(`person-${index}`, source), source } })
  console.log(`person ${name}`)
}

for (const [index, wanted] of TITLES.entries()) {
  const about = await wiki(wanted.wiki)
  const facts = await entity(about.item)
  const genres = await labels(claims(facts, "P136").map((value) => value.id).slice(0, 3))
  const duration = claims(facts, "P2047")[0]
  const minutes = duration === undefined ? null : Math.round(Number(duration.amount) / (duration.unit?.endsWith("/Q11574") ? 60 : 1))
  const year = Number((timeOf(claims(facts, "P577")[0]) ?? "").slice(0, 4)) || Number((timeOf(claims(facts, "P580")[0]) ?? "").slice(0, 4)) || null
  const seasons = Number(claims(facts, "P2437")[0]?.amount) || wanted.seasons
  const source = sized(about.picture)
  if (source === null) { console.warn(`skipped ${wanted.title}: no poster`); continue }
  data.titles.push({ kind: wanted.kind, tmdb: 91001 + index, slug: slug(`${wanted.title}${year === null ? "" : `-${year}`}`), title: wanted.title, year, genres: genres.length === 0 ? ["Drama"] : genres, length: wanted.kind === "film" ? (minutes ?? 110) : seasons, overview: about.text ?? `${wanted.title}.`, poster: { file: await image(`poster-${index}`, source), source } })
  console.log(`title ${wanted.title}`)
}

writeFileSync(DATA, `${JSON.stringify(data, null, 2)}\n`)
console.log(`wrote ${DATA.pathname}`)
