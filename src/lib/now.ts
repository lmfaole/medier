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
