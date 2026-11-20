/**
 * What plays now, and which source says so: Spotify's if it has it (what plays this second), Last.fm's scrobble of the same song a moment later where it has not.
 * `disc` is the cover that may be made into a disc (round, with a hole and a shine on it): Last.fm's. Spotify's own covers may not be cropped or have anything on them (its developer
 * policy), so a song from Spotify gets a disc only where Last.fm has the same song with a cover; otherwise `null`, and the cover is shown as it is.
 */

import type { NowPlaying } from "./spotify.ts"

export interface Playing extends NowPlaying {
  from: "spotify" | "lastfm"
  disc: string | null
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export function playingNow(spotify: NowPlaying | null, lastfm: NowPlaying | null): Playing | null {
  if (spotify !== null) return { ...spotify, from: "spotify", disc: lastfm !== null && same(lastfm.track, spotify.track) ? lastfm.image : null }
  return lastfm === null ? null : { ...lastfm, from: "lastfm", disc: lastfm.image }
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null)

/** What `/api/now` answered, checked: a song with its names and where it is from, or `null` for nothing playing or an answer that is not one. */
export function parsePlaying(answer: unknown): Playing | null {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return null
  const body = answer as Record<string, unknown>
  const [track, artist, album, url] = [text(body["track"]), text(body["artist"]), text(body["album"]), text(body["url"])]
  const from = body["from"] === "spotify" || body["from"] === "lastfm" ? body["from"] : null
  if (track === null || track === "" || artist === null || artist === "" || album === null || url === null || from === null) return null
  return { track, artist, album, url, from, image: text(body["image"]), disc: text(body["disc"]) }
}

/** The same song with the same covers: a poll that finds it again changes nothing on the page. */
export const samePlaying = (a: Playing | null, b: Playing | null): boolean => a === b || (a !== null && b !== null && a.track === b.track && a.artist === b.artist && a.album === b.album && a.from === b.from && a.image === b.image && a.disc === b.disc && a.url === b.url)
