/** What plays now, and which source says so: Spotify's if it has it (what plays this second), Last.fm's scrobble of the same song a moment later where it has not. */

import type { NowPlaying } from "./spotify.ts"

export interface Playing extends NowPlaying {
  from: "spotify" | "lastfm"
}

export function playingNow(spotify: NowPlaying | null, lastfm: NowPlaying | null): Playing | null {
  if (spotify !== null) return { ...spotify, from: "spotify" }
  return lastfm === null ? null : { ...lastfm, from: "lastfm" }
}
