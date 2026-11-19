/**
 * Where an artist's picture comes from and where it is served: Spotify's where it has one for the exact name (`music-sync spotify-images`), else Deezer's press photo where it has one for the exact name
 * (`music-sync deezer-images`), else Wikimedia Commons by way of the artist's Wikidata entry (`music-sync enrich-extra`), landed on this machine before a deploy (`scripts/fetch-artist-images.ts`) and served by the app
 * itself as `/artists/<artist mbid>.jpg`, because a page may load no image from another origin.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

/** `/artists/<artist mbid>.jpg`, with the artist captured. */
export const ARTIST_IMAGE_PATH = new RegExp(`^/artists/(${UUID})\\.jpg$`)

/** The address Commons serves a picture's file at, as `enrich-extra` stores it: nothing else is asked for. */
export const COMMONS_FILE_ADDRESS = /^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/[^?#\s]+(\?width=\d+)?$/

/** The address Deezer serves an artist's picture at, as `deezer-images` stores it. */
export const DEEZER_IMAGE_ADDRESS = /^https:\/\/cdn-images\.dzcdn\.net\/images\/artist\/[0-9a-f]+\/[^?#\s]+$/

/** The address Spotify serves an artist's picture at, as `spotify-images` stores it. */
export const SPOTIFY_IMAGE_ADDRESS = /^https:\/\/i\.scdn\.co\/image\/[0-9a-f]+$/

/** Whether a picture's address is one of the three this app asks for. */
export const isImageAddress = (address: string): boolean => COMMONS_FILE_ADDRESS.test(address) || DEEZER_IMAGE_ADDRESS.test(address) || SPOTIFY_IMAGE_ADDRESS.test(address)

export const DEEZER_CREDIT = "https://www.deezer.com"
export const SPOTIFY_CREDIT = "https://www.spotify.com"

/** Who to credit for a picture and where: the Commons page that names the author, Deezer or Spotify. None for an address that is neither. */
export function imageCreditOf(address: string): string | null {
  if (SPOTIFY_IMAGE_ADDRESS.test(address)) return SPOTIFY_CREDIT
  return DEEZER_IMAGE_ADDRESS.test(address) ? DEEZER_CREDIT : commonsFilePage(address)
}

/** The name to print for an address `imageCreditOf` gave. */
export const creditName = (credit: string): string => (credit === SPOTIFY_CREDIT ? "Spotify" : credit === DEEZER_CREDIT ? "Deezer" : "Wikimedia Commons")

export function imagePathOf(artistMbid: string): string | null {
  const path = `/artists/${artistMbid}.jpg`
  return ARTIST_IMAGE_PATH.test(path) ? path : null
}

/** The page on Commons that names the picture's author and licence, from the address the picture is served at, or none. */
export function commonsFilePage(address: string): string | null {
  if (!COMMONS_FILE_ADDRESS.test(address)) return null
  const name = address.slice(address.indexOf("/Special:FilePath/") + "/Special:FilePath/".length).split("?")[0]
  return `https://commons.wikimedia.org/wiki/File:${name}`
}

/** MusicBrainz, Wikimedia and the Internet Archive ask callers to say who they are. */
export const ARTIST_IMAGE_USER_AGENT = "music-artist-images/0.1 (+https://sky.lmfaole.party/apps/medier/musikk; hei@lmfaole.party)"
