import type { APIRoute } from 'astro'

import { playingNow } from '../../lib/now'
import { lastfmNow, spotifyNow } from '../../lib/runtime'

/**
 * What plays now, for the front page to ask for again while it is open: Spotify's song if it has one, Last.fm's where it has not, with Last.fm's cover for the disc. Both sources keep their answer for
 * fifteen seconds in the Worker's cache, so any number of readers asks each of them about as often as one would. `null` when nothing plays.
 */
export const GET: APIRoute = async () => {
  const [spotify, lastfm] = await Promise.all([spotifyNow(), lastfmNow()])
  return new Response(JSON.stringify(playingNow(spotify, lastfm)), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10' } })
}
