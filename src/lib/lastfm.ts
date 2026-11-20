/**
 * What the site keeps of Last.fm, and how it is read from Last.fm's answers (`user.getrecenttracks`, `user.gettopartists`). Pure, so a test
 * pins it; `scripts/fetch.ts` does the asking.
 */

export interface Play {
  track: string
  artist: string
  album: string
  /** The cover, as Last.fm hosts it; `null` where it has none. */
  image: string | null
  url: string
  /** ISO time it was played; `null` for what is playing now. */
  playedAt: string | null
}

export interface TopArtist {
  name: string
  plays: number
  url: string
}

export interface Music {
  /** When it was fetched; `null` before the first fetch. */
  at: string | null
  user: string
  recent: Play[]
  topArtists: TopArtist[]
}

type Json = Record<string, unknown>
const object = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {})
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
const text = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "")
/** Last.fm writes a name as `{ "#text": … }` in some places and as a string in others. */
const named = (value: unknown): string => (typeof value === "string" ? value : text(object(value)["#text"]))

/** The largest picture Last.fm lists, or `null`: it lists empty strings for a track with no cover, and a placeholder star for an unknown one. */
function largest(images: unknown): string | null {
  const found = list(images).map((image) => text(object(image)["#text"])).filter((url) => url !== "" && !url.includes("2a96cbd8b46e442fc41c2b86b821562f"))
  return found.at(-1) ?? null
}

export function parseRecentTracks(answer: unknown): Play[] {
  return list(object(object(answer)["recenttracks"])["track"]).map((value) => {
    const track = object(value)
    const nowPlaying = text(object(track["@attr"])["nowplaying"]) === "true"
    const seconds = Number(text(object(track["date"])["uts"]))
    return {
      track: text(track["name"]),
      artist: named(track["artist"]),
      album: named(track["album"]),
      image: largest(track["image"]),
      url: text(track["url"]),
      playedAt: nowPlaying || !Number.isFinite(seconds) || seconds === 0 ? null : new Date(seconds * 1000).toISOString(),
    }
  }).filter((play) => play.track !== "" && play.artist !== "")
}

export function parseTopArtists(answer: unknown): TopArtist[] {
  return list(object(object(answer)["topartists"])["artist"])
    .map((value) => {
      const artist = object(value)
      return { name: text(artist["name"]), plays: Number(text(artist["playcount"])) || 0, url: text(artist["url"]) }
    })
    .filter((artist) => artist.name !== "")
}

/** What Last.fm says of an artist beyond its plays here: what it is tagged as, how many listen, how many times the owner has played it, and a few lines about it. */
export interface ArtistInfo {
  tags: string[]
  listeners: number | null
  /** How many times the owner has played it in all (Last.fm counts it when asked with the user's name); `null` where it is not known. */
  userPlays: number | null
  /** The start of Last.fm's text about it, as plain text (their text is the users', CC BY-SA, with a link back where it is shown). */
  bio: string | null
}

/** What Last.fm says of a track. */
export interface TrackInfo {
  tags: string[]
  listeners: number | null
  userPlays: number | null
  /** How long it is, in seconds. */
  seconds: number | null
  /** The start of Last.fm's text about it, plain text; `null` where there is none (most tracks have none). */
  bio: string | null
}

/** What Last.fm says of an album, with the tracks it has. */
export interface AlbumInfo {
  tags: string[]
  listeners: number | null
  userPlays: number | null
  bio: string | null
  /** The tracks in order, with their length in seconds where Last.fm has it. */
  tracks: { title: string; seconds: number | null }[]
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " }

/** At most `limit` characters of the text, cut at the end of a sentence where there is one, so it never ends in the middle of a word. */
export function firstSentences(text: string, limit: number): string {
  if (text.length <= limit) return text
  const head = text.slice(0, limit)
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "))
  return end > limit / 3 ? head.slice(0, end + 1) : `${head.slice(0, head.lastIndexOf(" "))}…`
}

/** A count Last.fm writes as text («1234»): a whole number above nothing, or `null`. */
const count = (value: unknown): number | null => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/** The text of one of Last.fm's wikis (`bio`, `wiki`): what is before its own link and licence line, as plain text, cut at a sentence; `null` for a text that is only the link. */
function wikiText(wiki: unknown): string | null {
  const summary = object(wiki)["summary"]
  // The summary ends with a link to Last.fm («Read more on Last.fm») and a licence line: only the text before them is the text.
  const raw = typeof summary === "string" ? summary.split(/<a\s/i)[0] ?? "" : ""
  const text = raw.replace(/<[^>]+>/g, "").replace(/&(?:amp|quot|#39|lt|gt|nbsp);/g, (entity) => ENTITIES[entity] ?? entity).replace(/\s+/g, " ").trim()
  return text.length < 40 ? null : firstSentences(text, 420)
}

/** The first tags of what it is tagged as (Last.fm's users'). */
function tagsOf(value: unknown): string[] {
  return list(object(value)["tag"]).flatMap((tag) => {
    const name = object(tag)["name"]
    return typeof name === "string" && name !== "" ? [name] : []
  }).slice(0, 4)
}

/** The address of one of Last.fm's `getinfo` methods: `base` is the one with the key (`sources.ts`), `user` the owner, whose own count Last.fm then adds as `userplaycount`. */
function infoUrl(base: string, method: string, parts: Record<string, string>, user: string): string {
  const query = Object.entries(parts).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")
  return `${base}&method=${method}&autocorrect=1&${query}&username=${encodeURIComponent(user)}`
}

export const artistInfoUrl = (base: string, artist: string, user: string): string => infoUrl(base, "artist.getinfo", { artist }, user)
export const trackInfoUrl = (base: string, artist: string, track: string, user: string): string => infoUrl(base, "track.getinfo", { artist, track }, user)
export const albumInfoUrl = (base: string, artist: string, album: string, user: string): string => infoUrl(base, "album.getinfo", { artist, album }, user)

export function parseArtistInfo(answer: unknown): ArtistInfo {
  const info = object(object(answer)["artist"])
  const stats = object(info["stats"])
  return { tags: tagsOf(info["tags"]), listeners: count(stats["listeners"]), userPlays: count(stats["userplaycount"]), bio: wikiText(info["bio"]) }
}

export function parseTrackInfo(answer: unknown): TrackInfo {
  const info = object(object(answer)["track"])
  const milliseconds = count(info["duration"])
  return { tags: tagsOf(info["toptags"]), listeners: count(info["listeners"]), userPlays: count(info["userplaycount"]), seconds: milliseconds === null ? null : Math.round(milliseconds / 1000), bio: wikiText(info["wiki"]) }
}

export function parseAlbumInfo(answer: unknown): AlbumInfo {
  const info = object(object(answer)["album"])
  const tracks = list(object(info["tracks"])["track"]).flatMap((value) => {
    const track = object(value)
    const title = typeof track["name"] === "string" ? track["name"].trim() : ""
    return title === "" ? [] : [{ title, seconds: count(track["duration"]) }]
  })
  return { tags: tagsOf(info["tags"]), listeners: count(info["listeners"]), userPlays: count(info["userplaycount"]), bio: wikiText(info["wiki"]), tracks }
}
