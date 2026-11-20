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

/** What Last.fm says of an artist beyond its plays here: what it is tagged as, how many listen, and a few lines about it. */
export interface ArtistInfo {
  tags: string[]
  listeners: number | null
  /** The start of Last.fm's text about it, as plain text (their text is the users', CC BY-SA, with a link back where it is shown). */
  bio: string | null
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " }

/** At most `limit` characters of the text, cut at the end of a sentence where there is one, so it never ends in the middle of a word. */
export function firstSentences(text: string, limit: number): string {
  if (text.length <= limit) return text
  const head = text.slice(0, limit)
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "))
  return end > limit / 3 ? head.slice(0, end + 1) : `${head.slice(0, head.lastIndexOf(" "))}…`
}

/** The address that tells Last.fm about an artist: `base` is the one with the key and the user (`sources.ts`). */
export const artistInfoUrl = (base: string, artist: string): string => `${base}&method=artist.getinfo&autocorrect=1&artist=${encodeURIComponent(artist)}`

export function parseArtistInfo(answer: unknown): ArtistInfo {
  const artist = (typeof answer === "object" && answer !== null ? (answer as Record<string, unknown>)["artist"] : null) ?? {}
  const object = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
  const info = object(artist)
  const tags = (Array.isArray(object(info["tags"])["tag"]) ? (object(info["tags"])["tag"] as unknown[]) : []).flatMap((tag) => {
    const name = object(tag)["name"]
    return typeof name === "string" && name !== "" ? [name] : []
  })
  const listeners = Number(object(info["stats"])["listeners"])
  const summary = object(info["bio"])["summary"]
  // The summary ends with a link to Last.fm («Read more on Last.fm») and a licence line: only the text before them is the text.
  const raw = typeof summary === "string" ? summary.split(/<a\s/i)[0] ?? "" : ""
  const bio = raw.replace(/<[^>]+>/g, "").replace(/&(?:amp|quot|#39|lt|gt|nbsp);/g, (entity) => ENTITIES[entity] ?? entity).replace(/\s+/g, " ").trim()
  return { tags: tags.slice(0, 4), listeners: Number.isFinite(listeners) && listeners > 0 ? listeners : null, bio: bio.length < 40 ? null : firstSentences(bio, 420) }
}
