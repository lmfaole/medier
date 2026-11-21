/**
 * Made-up answers from Last.fm, Trakt, TMDB, Spotify and MusicBrainz, for working on the site with no keys and no network (`MOCK_DATA=1` in `.dev.vars`; `runtime.ts` asks `mockFetch` instead of the sources).
 * Pure: the same time gives the same answers. Plays and viewings are laid out on a fixed grid of time that ends at `now`, so every week and month of the last ten months has some, a week is not like
 * the one before it, and two artists are new lately. What they are made of is real (`mock-data.json`: albums, tracklists, films, people, from Deezer and Wikipedia) and so are the pictures in `public/mock/`,
 * both fetched once by `scripts/fetch-mock-data.mjs` (the pictures are other people's artwork and not committed: `node scripts/fetch-mock-data.mjs --images` fetches them again).
 */

import data from "./mock-data.json" with { type: "json" }
import { plain } from "./spotify.ts"

/** The settings of a run on made-up data: what is not set (no keys are) is given a name that is no key, so every source is «set up». The usernames are the visitor's, as always (any one is taken). */
export function mockSettings(env: Readonly<Partial<Record<string, string>>>): Record<string, string> {
  const defaults = { LASTFM_API_KEY: "mock", TRAKT_CLIENT_ID: "mock", TMDB_API_KEY: "mock", SPOTIFY_CLIENT_ID: "mock", SPOTIFY_CLIENT_SECRET: "mock", SPOTIFY_REFRESH_TOKEN: "mock" }
  return { ...defaults, ...Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "")) }
}

const DAY = 86400
const SLOT = 1200
const HISTORY = 300 * DAY
/** The plays go further back than the viewings: an artist's page shows them year by year, and when it was first heard. */
const PLAY_HISTORY = 1500 * DAY

/** A number from two numbers, the same each time and unlike its neighbours. */
function mix(a: number, b = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)
  h ^= h >>> 13
  h = Math.imul(h, 0x27d4eb2f)
  h ^= h >>> 15
  return h >>> 0
}

// ---- Music ----

/** Artists Last.fm finds like ours that are never played here: a page shows only those that are. */
const SIMILAR_UNHEARD = ["Morten Harket", "Kygo", "Ane Brun", "Jarle Bernhoft", "Annie"]

interface Picture {
  file: string
  source: string
}

interface MockArtist {
  name: string
  tags: string[]
  weight: number
  /** How many days ago it was first played. */
  since: number
  bio: string
  image: Picture
  /** What it is on MusicBrainz: an album, or an EP or a single (which Last.fm ranks among the albums all the same). */
  albums: { title: string; year: number | null; type: string; cover: Picture; tracks: { title: string; seconds: number }[] }[]
}

const ARTISTS: readonly MockArtist[] = data.artists

interface MockTrack {
  artist: MockArtist
  artistIndex: number
  albumIndex: number
  title: string
  album: string
  seconds: number
  index: number
}

const trackOf = (artistIndex: number, albumIndex: number, index: number): MockTrack => {
  const artist = ARTISTS[artistIndex] as MockArtist
  const album = artist.albums[albumIndex] as MockArtist["albums"][number]
  const track = album.tracks[index] as { title: string; seconds: number }
  return { artist, artistIndex, albumIndex, title: track.title, album: album.title, seconds: track.seconds, index }
}

interface Play extends MockTrack {
  at: number
}

/** The artist, album and track a moment of the grid has, the most played artists most often; only those that had been played by then. */
function pick(seed: number, at: number, now: number): MockTrack {
  const live = ARTISTS.flatMap((artist, index) => (at >= now - artist.since * DAY ? [{ artist, index }] : []))
  const total = live.reduce((sum, one) => sum + one.artist.weight, 0)
  let point = mix(seed, 4) % total
  const chosen = live.find((one) => (point -= one.artist.weight) < 0) ?? (live[0] as { artist: MockArtist; index: number })
  const albumIndex = mix(seed, 5) % chosen.artist.albums.length
  const album = chosen.artist.albums[albumIndex] as MockArtist["albums"][number]
  return trackOf(chosen.index, albumIndex, mix(seed, 6) % album.tracks.length)
}

/** Every play from `from` to `to` (unix seconds, both included), newest first. The listening is in the day (nothing at night) and some weeks have more of it than others. */
function playsIn(from: number, to: number, now: number): Play[] {
  const low = Math.max(from, now - PLAY_HISTORY)
  const high = Math.min(to, now)
  const plays: Play[] = []
  for (let slot = Math.floor(high / SLOT); slot >= Math.floor(low / SLOT); slot -= 1) {
    const at = slot * SLOT + (mix(slot, 1) % SLOT)
    if (at < low || at > high) continue
    const hour = (Math.floor(at / 3600) + 2) % 24
    const week = Math.floor(at / (7 * DAY))
    if (hour < 7 || mix(slot, 2) % 100 >= 30 + (mix(week, 7) % 66)) continue
    plays.push({ ...pick(slot, at, now), at })
  }
  return plays
}

/** The song that plays now: one for a few minutes at a time. */
const nowTrack = (now: number): MockTrack => pick(Math.floor(now / 240), now, now)

const artistNamed = (name: string): { artist: MockArtist; index: number } | undefined => {
  const index = ARTISTS.findIndex((artist) => plain(artist.name) === plain(name))
  return index < 0 ? undefined : { artist: ARTISTS[index] as MockArtist, index }
}
const albumNamed = (artist: string, title: string): { artist: MockArtist; artistIndex: number; albumIndex: number } | undefined => {
  const found = artistNamed(artist)
  const albumIndex = found?.artist.albums.findIndex((album) => plain(album.title) === plain(title)) ?? -1
  return found === undefined || albumIndex < 0 ? undefined : { artist: found.artist, artistIndex: found.index, albumIndex }
}
const trackNamed = (artist: string, title: string): MockTrack | undefined => {
  const found = artistNamed(artist)
  if (found === undefined) return undefined
  for (const [albumIndex, album] of found.artist.albums.entries()) {
    const index = album.tracks.findIndex((track) => plain(track.title) === plain(title))
    if (index >= 0) return trackOf(found.index, albumIndex, index)
  }
  return undefined
}

const cover = (artistIndex: number, albumIndex: number): string => (ARTISTS[artistIndex] as MockArtist).albums[albumIndex]?.cover.file ?? ""
const lastfmImages = (url: string): { "#text": string; size: string }[] => ["small", "medium", "large", "extralarge"].map((size) => ({ "#text": url, size }))
const lastfmUrl = (...parts: string[]): string => `https://www.last.fm/music/${parts.map((part) => encodeURIComponent(part).replace(/%20/g, "+")).join("/")}`

function lastfmTrack(play: MockTrack, at: number | null): Record<string, unknown> {
  return {
    name: play.title,
    artist: { "#text": play.artist.name },
    album: { "#text": play.album },
    image: lastfmImages(cover(play.artistIndex, play.albumIndex)),
    url: lastfmUrl(play.artist.name, "_", play.title),
    ...(at === null ? { "@attr": { nowplaying: "true" } } : { date: { uts: String(at), "#text": new Date(at * 1000).toISOString() } }),
  }
}

const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })
const lastfmError = (code: number, message: string): Response => json({ error: code, message })

/** The MusicBrainz id of a made-up artist: the same each time, and one no real artist has. */
const mockMbid = (index: number): string => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`

/**
 * What Last.fm ranks among an artist's albums, as it does: the albums and EPs, and besides them a single (a song of the first album, under its own name), a deluxe edition of
 * the first album and a live album, so a page shows that only the albums are kept, each once.
 */
function lastfmReleases(artist: MockArtist, index: number): { title: string; plays: number; albumIndex: number }[] {
  const plays = (slot: number): number => 400000 - slot * 90000 + (mix(index, slot) % 50000)
  const first = artist.albums[0] as MockArtist["albums"][number]
  return [
    ...artist.albums.map((album, albumIndex) => ({ title: album.title, plays: plays(albumIndex * 2), albumIndex })),
    { title: first.tracks[0]?.title ?? `${first.title} - Single`, plays: plays(1), albumIndex: 0 },
    { title: `${first.title} (Deluxe Edition)`, plays: plays(3) / 4, albumIndex: 0 },
    { title: `Live at Rockefeller`, plays: plays(4) / 3, albumIndex: 1 },
  ].map((release) => ({ ...release, plays: Math.round(release.plays) }))
}

/** MusicBrainz's answer to the search for an artist's official albums (`musicbrainz.ts`), by its id or its name: its albums, and a live album and a compilation that are not albums. */
function musicbrainz(url: URL): Response {
  const query = url.searchParams.get("query") ?? ""
  const id = /arid:(\S+)/.exec(query)?.[1]
  const index = id === undefined ? (artistNamed(/artist:"((?:[^"\\]|\\.)*)"/.exec(query)?.[1]?.replace(/\\(.)/g, "$1") ?? "")?.index ?? -1) : ARTISTS.findIndex((_, at) => mockMbid(at) === id)
  const artist = ARTISTS[index]
  if (artist === undefined) return json({ created: new Date(0).toISOString(), count: 0, offset: 0, "release-groups": [] })
  const credit = [{ name: artist.name, artist: { id: mockMbid(index), name: artist.name } }]
  const group = (slot: number, title: string, year: number | null, secondary: string[]) => ({ id: `${mockMbid(index).slice(0, -4)}${String(slot).padStart(4, "0")}`, title, "primary-type": "Album", ...(secondary.length === 0 ? {} : { "secondary-types": secondary }), "first-release-date": year === null ? "" : String(year), "artist-credit": credit })
  const groups = [
    ...artist.albums.flatMap((album, albumIndex) => (album.type === "Album" ? [group(albumIndex, album.title, album.year, [])] : [])),
    group(90, "Live at Rockefeller", 2019, ["Live"]),
    group(91, `The Best of ${artist.name}`, 2020, ["Compilation"]),
  ]
  return json({ created: new Date(0).toISOString(), count: groups.length, offset: 0, "release-groups": groups })
}

function lastfm(params: URLSearchParams, now: number): Response {
  const method = params.get("method")
  const user = params.get("username") ?? ""
  const count = (artist: MockArtist, filter?: (play: Play) => boolean): number => playsIn(0, now, now).filter((play) => play.artist === artist && (filter?.(play) ?? true)).length
  const tagList = (tags: string[]): { tag: { name: string }[] } => ({ tag: tags.map((name) => ({ name })) })
  const wiki = (text: string, link: string): { summary: string } => ({ summary: `${text} <a href="${link}">Read more on Last.fm</a>. User-contributed text is available under the Creative Commons By-SA License.` })
  const chart = (from: number, to: number): { artist: MockArtist; plays: number }[] => {
    const plays = playsIn(from, to, now)
    return ARTISTS.map((artist) => ({ artist, plays: plays.filter((play) => play.artist === artist).length })).filter((one) => one.plays > 0).sort((a, b) => b.plays - a.plays)
  }
  if (method === "user.getrecenttracks") {
    const limit = Math.min(Number(params.get("limit")) || 50, 200)
    const page = Math.max(Number(params.get("page")) || 1, 1)
    const ranged = params.has("from") || params.has("to")
    const all = playsIn(Number(params.get("from")) || 0, params.has("to") ? Number(params.get("to")) : now, now)
    const shown = all.slice((page - 1) * limit, page * limit).map((play) => lastfmTrack(play, play.at))
    const playing = !ranged && page === 1 ? [lastfmTrack(nowTrack(now), null)] : []
    return json({ recenttracks: { track: [...playing, ...shown], "@attr": { user, page: String(page), perPage: String(limit), totalPages: String(Math.max(1, Math.ceil(all.length / limit))), total: String(all.length) } } })
  }
  if (method === "user.getinfo") {
    return json({ user: { name: params.get("user") ?? "", playcount: String(playsIn(0, now, now).length), registered: { unixtime: String(now - PLAY_HISTORY), "#text": now - PLAY_HISTORY } } })
  }
  if (method === "user.gettoptracks") {
    const tracks = new Map<string, { play: Play; plays: number }>()
    for (const play of playsIn(0, now, now)) {
      const key = `${play.artistIndex}:${play.albumIndex}:${play.index}`
      const found = tracks.get(key) ?? { play, plays: 0 }
      found.plays += 1
      tracks.set(key, found)
    }
    const ranked = [...tracks.values()].sort((a, b) => b.plays - a.plays)
    return json({ toptracks: { track: ranked.map((one, index) => ({ name: one.play.title, playcount: String(one.plays), url: lastfmUrl(one.play.artist.name, "_", one.play.title), artist: { name: one.play.artist.name, url: lastfmUrl(one.play.artist.name) }, "@attr": { rank: String(index + 1) } })) } })
  }
  if (method === "artist.getsimilar") {
    const found = artistNamed(params.get("artist") ?? "")
    if (found === undefined) return lastfmError(6, "The artist you supplied could not be found")
    // The others of ours, the nearest in the list most alike, among names that are not played here.
    const others = ARTISTS.filter((artist) => artist !== found.artist).sort((a, b) => Math.abs(ARTISTS.indexOf(a) - found.index) - Math.abs(ARTISTS.indexOf(b) - found.index)).map((artist) => artist.name)
    const names = [...SIMILAR_UNHEARD.slice(0, 2), ...others.slice(0, 3), ...SIMILAR_UNHEARD.slice(2), ...others.slice(3)]
    return json({ similarartists: { artist: names.map((name, index) => ({ name, match: (1 - index / names.length).toFixed(3), url: lastfmUrl(name) })), "@attr": { artist: found.artist.name } } })
  }
  if (method === "user.gettopartists") {
    const overall = params.get("period") === "overall"
    return json({ topartists: { artist: chart(overall ? 0 : now - 30 * DAY, now).map((one, index) => ({ name: one.artist.name, playcount: String(one.plays), url: lastfmUrl(one.artist.name), "@attr": { rank: String(index + 1) } })) } })
  }
  if (method === "user.getweeklyartistchart") {
    return json({ weeklyartistchart: { artist: chart(Number(params.get("from")) || 0, Number(params.get("to")) || now).map((one, index) => ({ name: one.artist.name, playcount: String(one.plays), url: lastfmUrl(one.artist.name), "@attr": { rank: String(index + 1) } })) } })
  }
  if (method === "artist.getinfo") {
    const found = artistNamed(params.get("artist") ?? "")
    if (found === undefined) return lastfmError(6, "The artist you supplied could not be found")
    const { artist } = found
    return json({ artist: { name: artist.name, mbid: mockMbid(found.index), url: lastfmUrl(artist.name), stats: { listeners: String(20000 + (mix(found.index, 8) % 400000)), playcount: String(900000 + (mix(found.index, 9) % 9000000)), userplaycount: String(count(artist)) }, tags: tagList(artist.tags), bio: wiki(artist.bio, lastfmUrl(artist.name)) } })
  }
  if (method === "track.getinfo") {
    const found = trackNamed(params.get("artist") ?? "", params.get("track") ?? "")
    if (found === undefined) return lastfmError(6, "Track not found")
    return json({ track: { name: found.title, url: lastfmUrl(found.artist.name, "_", found.title), duration: String(found.seconds * 1000), listeners: String(5000 + (mix(found.artistIndex, found.index) % 90000)), userplaycount: String(count(found.artist, (play) => play.title === found.title)), toptags: tagList(found.artist.tags), artist: { name: found.artist.name }, album: { title: found.album } } })
  }
  if (method === "album.getinfo") {
    const found = albumNamed(params.get("artist") ?? "", params.get("album") ?? "")
    if (found === undefined) return lastfmError(6, "Album not found")
    const album = found.artist.albums[found.albumIndex] as MockArtist["albums"][number]
    return json({
      album: {
        name: album.title,
        artist: found.artist.name,
        url: lastfmUrl(found.artist.name, album.title),
        listeners: String(8000 + (mix(found.artistIndex * 10 + found.albumIndex, 10) % 200000)),
        userplaycount: String(count(found.artist, (play) => play.album === album.title)),
        tags: tagList(found.artist.tags),
        wiki: wiki(`${album.title} er et album av ${found.artist.name}, gitt ut ${album.year === null ? "for en tid siden" : `i ${album.year}`}. Det har ${album.tracks.length} spor og er et godt sted å begynne for den som vil bli kjent med bandet.`, lastfmUrl(found.artist.name, album.title)),
        tracks: { track: album.tracks.map((track, index) => ({ name: track.title, duration: String(track.seconds), "@attr": { rank: String(index + 1) } })) },
      },
    })
  }
  if (method === "artist.gettopalbums") {
    const found = artistNamed(params.get("artist") ?? "")
    if (found === undefined) return lastfmError(6, "The artist you supplied could not be found")
    return json({ topalbums: { album: lastfmReleases(found.artist, found.index).map((release) => ({ name: release.title, playcount: String(release.plays), url: lastfmUrl(found.artist.name, release.title), image: lastfmImages(cover(found.index, release.albumIndex)) })) } })
  }
  return lastfmError(3, `Invalid Method - ${method ?? "none"}`)
}

// ---- Film and TV ----

interface MockPerson {
  id: number
  name: string
  department: "Acting" | "Directing" | "Writing" | "Sound"
  born: string | null
  place: string | null
  bio: string
  image: Picture
}

const PEOPLE: readonly MockPerson[] = data.people as MockPerson[]

interface MockTitle {
  kind: "film" | "episode"
  tmdb: number
  slug: string
  title: string
  year: number | null
  genres: string[]
  /** Minutes for a film, seasons for a show. */
  length: number
  overview: string
  poster: Picture
}

const TITLES: readonly MockTitle[] = data.titles as MockTitle[]

const EPISODE_TITLES = ["Første dag", "Det som ble sagt", "Tilbake til kysten", "Ingen kjenner veien", "Lyset slukkes", "En ny sesong"]

const castOf = (index: number): MockPerson[] => Array.from({ length: 5 }, (_, slot) => PEOPLE[(index * 3 + slot * 2) % 10] as MockPerson)
const crewOf = (index: number): { person: MockPerson; job: string }[] => [
  { person: PEOPLE[10 + (index % 3)] as MockPerson, job: "Director" },
  { person: PEOPLE[13] as MockPerson, job: "Screenplay" },
  { person: PEOPLE[14 + (index % 2)] as MockPerson, job: "Original Music Composer" },
]
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

const NOT_FOUND = { success: false, status_code: 34, status_message: "The resource you requested could not be found." }

function tmdb(url: URL): Response {
  const [, , kind, id] = url.pathname.split("/")
  const number = Number(id)
  if (kind === "person") {
    const person = PEOPLE.find((one) => one.id === number)
    if (person === undefined) return json(NOT_FOUND, 404)
    return json({ id: person.id, name: person.name, biography: person.bio, birthday: person.born, deathday: null, place_of_birth: person.place, known_for_department: person.department, profile_path: person.image.file })
  }
  const index = TITLES.findIndex((one) => one.tmdb === number && one.kind === (kind === "movie" ? "film" : "episode"))
  const title = TITLES[index]
  if (title === undefined) return json(NOT_FOUND, 404)
  const crew = crewOf(index).map(({ person, job }) => ({ id: person.id, name: person.name, job, profile_path: person.image.file }))
  const cast = castOf(index).map((person, order) => ({ id: person.id, name: person.name, character: ["Hovedrollen", "Naboen", "Søsteren", "Lensmannen", "Gamlefar"][order], profile_path: person.image.file, order }))
  const common = { id: title.tmdb, overview: title.overview, genres: title.genres.map((name, genre) => ({ id: genre, name: capital(name) })), poster_path: title.poster.file, credits: { cast, crew } }
  if (kind === "movie") return json({ ...common, title: title.title, release_date: title.year === null ? null : `${title.year}-09-01`, runtime: title.length })
  const writer = PEOPLE[13] as MockPerson
  return json({ ...common, name: title.title, first_air_date: title.year === null ? null : `${title.year}-09-01`, number_of_seasons: title.length, created_by: [{ id: writer.id, name: writer.name, profile_path: writer.image.file }] })
}

interface Viewing {
  id: number
  at: number
  title: MockTitle
  episode: { season: number; number: number; title: string } | null
}

/** The viewings from `from` to `to` (unix seconds), newest first: a film now and then, and on some evenings a few episodes of one show in a row. */
function viewingsIn(kind: "film" | "episode", from: number, to: number, now: number): Viewing[] {
  const low = Math.max(from, now - HISTORY)
  const high = Math.min(to, now)
  const films = TITLES.filter((title) => title.kind === "film")
  const shows = TITLES.filter((title) => title.kind === "episode")
  const found: Viewing[] = []
  for (let day = Math.floor(high / DAY); day >= Math.floor(low / DAY); day -= 1) {
    if (kind === "film" && mix(day, 11) % 100 < 22) {
      found.push({ id: 1_000_000 + day * 10, at: day * DAY + 17 * 3600 + (mix(day, 13) % 14400), title: films[mix(day, 12) % films.length] as MockTitle, episode: null })
    }
    if (kind === "episode" && mix(day, 21) % 100 < 45) {
      const show = shows[mix(day, 22) % shows.length] as MockTitle
      const first = mix(day, 24) % 16
      const run = 1 + (mix(day, 23) % 4)
      for (let step = 0; step < run; step += 1) {
        const number = first + step
        found.push({ id: 1_000_000 + day * 10 + 1 + step, at: day * DAY + 18 * 3600 + 1800 + step * 2700, title: show, episode: { season: 1 + (Math.floor(number / 8) % show.length), number: (number % 8) + 1, title: EPISODE_TITLES[number % EPISODE_TITLES.length] as string } })
      }
    }
  }
  return found.filter((one) => one.at >= low && one.at <= high).sort((a, b) => b.at - a.at)
}

function trakt(url: URL, now: number): Response {
  const match = /^\/users\/[^/]+\/history\/(movies|episodes)$/.exec(url.pathname)
  if (match === null) return json({ error: "Not found" }, 404)
  const kind = match[1] === "movies" ? "film" : "episode"
  const time = (name: string, fallback: number): number => {
    const value = Date.parse(url.searchParams.get(name) ?? "")
    return Number.isNaN(value) ? fallback : value / 1000
  }
  const limit = Math.min(Number(url.searchParams.get("limit")) || 10, 100)
  const page = Math.max(Number(url.searchParams.get("page")) || 1, 1)
  const items = viewingsIn(kind, time("start_at", 0), time("end_at", now), now).slice((page - 1) * limit, page * limit)
  return json(
    items.map((one) => {
      const ids = { trakt: one.title.tmdb - 80000, slug: one.title.slug, tmdb: one.title.tmdb }
      const base = { id: one.id, watched_at: new Date(one.at * 1000).toISOString(), action: "watch" }
      if (one.episode === null) return { ...base, type: "movie", movie: { title: one.title.title, year: one.title.year, ids } }
      return { ...base, type: "episode", episode: { season: one.episode.season, number: one.episode.number, title: one.episode.title, ids: { trakt: one.id } }, show: { title: one.title.title, year: one.title.year, ids } }
    }),
  )
}

// ---- Spotify ----

const SPOTIFY = "https://open.spotify.com/"
const spotifyId = (...parts: string[]): string => parts.map((part) => plain(part)).join("-")

function spotifyTrack(track: MockTrack): Record<string, unknown> {
  return {
    name: track.title,
    artists: [{ name: track.artist.name }],
    album: { name: track.album, images: [640, 300, 64].map((width) => ({ url: cover(track.artistIndex, track.albumIndex), width, height: width })) },
    external_urls: { spotify: `${SPOTIFY}track/${spotifyId(track.artist.name, track.title)}` },
  }
}

function spotify(url: URL): Response {
  if (url.hostname === "accounts.spotify.com") return json({ access_token: "mock-access-token", token_type: "Bearer", expires_in: 3600, scope: "user-read-currently-playing" })
  if (url.pathname === "/v1/search") {
    const type = url.searchParams.get("type")
    const query = url.searchParams.get("q") ?? ""
    const field = (name: string): string => new RegExp(`${name}:"([^"]*)"`).exec(query)?.[1] ?? ""
    if (type === "artist") {
      const found = artistNamed(field("artist"))
      return json({ artists: { items: found === undefined ? [] : [{ name: found.artist.name, genres: found.artist.tags.slice(0, 3), external_urls: { spotify: `${SPOTIFY}artist/${spotifyId(found.artist.name)}` }, images: [640, 320, 160].map((width) => ({ url: found.artist.image.file, width, height: width })) }] } })
    }
    if (type === "album") {
      const found = albumNamed(field("artist"), field("album"))
      const album = found?.artist.albums[found.albumIndex]
      return json({ albums: { items: found === undefined || album === undefined ? [] : [{ name: album.title, artists: [{ name: found.artist.name }], release_date: `${album.year ?? 2000}-03-${String(1 + (mix(found.artistIndex, found.albumIndex) % 27)).padStart(2, "0")}`, total_tracks: album.tracks.length, external_urls: { spotify: `${SPOTIFY}album/${spotifyId(found.artist.name, album.title)}` } }] } })
    }
    if (type === "track") {
      const found = trackNamed(field("artist"), field("track"))
      return json({ tracks: { items: found === undefined ? [] : [spotifyTrack(found)] } })
    }
  }
  return json({ error: { status: 404, message: `mock: ${url.pathname}` } }, 404)
}

/** The made-up answer for an address the sources are asked, as the source would give it; 404 for an address none of ours is. */
export function mockFetch(url: string, _request: { headers?: Record<string, string>; method?: "GET" | "POST"; body?: string }, now = Date.now()): Response {
  const address = new URL(url)
  const seconds = Math.floor(now / 1000)
  switch (address.hostname) {
    case "ws.audioscrobbler.com":
      return lastfm(address.searchParams, seconds)
    case "api.trakt.tv":
      return trakt(address, seconds)
    case "api.themoviedb.org":
      return tmdb(address)
    case "accounts.spotify.com":
    case "api.spotify.com":
      return spotify(address)
    case "musicbrainz.org":
      return musicbrainz(address)
    default:
      return json({ error: `mock: no fixtures for ${address.hostname}` }, 404)
  }
}

/** Names the fixtures: answers kept from an older fetch of them are not asked for again. */
export const MOCK_VERSION: string = data.generated
export const MOCK_ARTISTS: readonly string[] = ARTISTS.map((artist) => artist.name)
export const MOCK_PEOPLE_COUNT = PEOPLE.length
export const MOCK_TITLE_COUNT = TITLES.length
