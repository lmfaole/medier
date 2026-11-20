/**
 * What the site keeps of Spotify's Web API: the song playing now, and how the token to ask for it is made. Pure, so a test pins it; `sources.ts` does the asking.
 * Only «currently playing» is used: a song that is playing (not an episode, not an ad), with its cover and where to open it.
 */

export const TOKEN_URL = "https://accounts.spotify.com/api/token"
export const AUTHORIZE_URL = "https://accounts.spotify.com/authorize"
/** The one permission the site asks for: to see what plays. It cannot change anything in the account. */
export const SCOPE = "user-read-currently-playing"
/** The search for one artist by name: ten hits (the most Spotify gives a search in Development Mode), because the first is not always the one (`parseArtistMatch` takes the one that is named the same). */
export const searchArtistUrl = (name: string): string => `https://api.spotify.com/v1/search?type=artist&limit=10&q=${encodeURIComponent(`artist:"${name}"`)}`
export const NOW_PLAYING_URL = "https://api.spotify.com/v1/me/player/currently-playing"

export interface NowPlaying {
  track: string
  artist: string
  album: string
  /** The cover, as Spotify hosts it; `null` where it has none. */
  image: string | null
  url: string
}

type Json = Record<string, unknown>
const object = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {})
const text = (value: unknown): string => (typeof value === "string" ? value : "")
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const SPOTIFY_URL = "https://open.spotify.com/"

/** The request that swaps the refresh token for an access token (one hour): the client signs in with its id and secret, the user's token is the grant. */
export function refreshRequest(clientId: string, clientSecret: string, refreshToken: string): { url: string; method: "POST"; headers: Record<string, string>; body: string } {
  return {
    url: TOKEN_URL,
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  }
}

/** The access token and for how many seconds it is good, from the token endpoint's answer; `null` where it gave none (a refresh token that has run out gives `invalid_grant`). */
export function parseToken(answer: unknown): { accessToken: string; expiresIn: number } | null {
  const token = object(answer)
  const accessToken = text(token["access_token"])
  const expiresIn = typeof token["expires_in"] === "number" ? token["expires_in"] : 3600
  return accessToken === "" ? null : { accessToken, expiresIn }
}

/** The song playing now, or `null` when nothing plays, it is paused, or it is not a song (an episode, an ad). Spotify answers 204 with no body when nothing plays: that is `null` here too. */
export function parseNowPlaying(answer: unknown): NowPlaying | null {
  const state = object(answer)
  if (state["is_playing"] !== true || state["currently_playing_type"] !== "track") return null
  const item = object(state["item"])
  const track = text(item["name"])
  const url = text(object(item["external_urls"])["spotify"])
  if (track === "" || !url.startsWith("https://open.spotify.com/")) return null
  const artists = Array.isArray(item["artists"]) ? item["artists"].map((artist) => text(object(artist)["name"])).filter((name) => name !== "") : []
  const album = object(item["album"])
  // The images come largest first: the smallest one that is still 300 wide is plenty for a row.
  const images = (Array.isArray(album["images"]) ? album["images"] : []).map(object).filter((image) => text(image["url"]) !== "")
  const image = images.findLast((candidate) => typeof candidate["width"] === "number" && candidate["width"] >= 300) ?? images[0]
  return { track, artist: artists.join(", "), album: text(album["name"]), image: image === undefined ? null : text(image["url"]), url }
}

/** The address the person approves at, once (`npm run spotify:auth`). `redirectUri` is one that is registered in the Spotify dashboard (a loopback one, `http://127.0.0.1:<port>/…`). */
export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  return `${AUTHORIZE_URL}?${new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri, scope: SCOPE, state }).toString()}`
}

/** The request that swaps the code Spotify sent back for the refresh token. */
export function codeRequest(clientId: string, clientSecret: string, code: string, redirectUri: string): { url: string; method: "POST"; headers: Record<string, string>; body: string } {
  const request = refreshRequest(clientId, clientSecret, "")
  return { ...request, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString() }
}

/** The refresh token from the answer to `codeRequest`, or `null` where Spotify gave none. */
export function parseRefreshToken(answer: unknown): string | null {
  const token = text(object(answer)["refresh_token"])
  return token === "" ? null : token
}

/** An artist on Spotify: where to open it, its picture in the widths Spotify has (for `Picture`'s `sources`), and what Spotify calls its genres. */
export interface SpotifyArtist {
  url: string
  images: { src: string; width: number }[]
  genres: string[]
}

/** A name as a person compares it: no case, no accents, nothing but letters and digits («Beyoncé» is «beyonce»). */
export const plain = (name: string): string => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "")

/**
 * The artist the search found that is named the same as the one asked for, or `null`: a search for «After» finds a dozen artists, and the first is not always the
 * one played, so a picture of the wrong artist is worse than none. The pictures come smallest first.
 */
export function parseArtistMatch(answer: unknown, name: string): SpotifyArtist | null {
  const wanted = plain(name)
  if (wanted === "") return null
  for (const value of list(object(object(answer)["artists"])["items"])) {
    const artist = object(value)
    const url = text(object(artist["external_urls"])["spotify"])
    if (plain(text(artist["name"])) !== wanted || !url.startsWith(SPOTIFY_URL)) continue
    const images = list(artist["images"]).flatMap((image) => {
      const found = object(image)
      return text(found["url"]) !== "" && typeof found["width"] === "number" ? [{ src: text(found["url"]), width: found["width"] }] : []
    })
    return { url, images: images.toSorted((a, b) => a.width - b.width), genres: list(artist["genres"]).flatMap((genre) => (typeof genre === "string" ? [genre] : [])).slice(0, 4) }
  }
  return null
}
