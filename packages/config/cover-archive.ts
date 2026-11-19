/**
 * Where an album cover comes from: the Cover Art Archive's 250px thumbnail of one image of one release and the same-origin path the apps serve it under. Shared by the Worker that fetches a missing cover
 * (`apps/music`) and the script that lands every cover on this machine before a deploy.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** `/covers/<release mbid>/<image id>-<size>.jpg`, size 250, with the three parts captured. */
export const COVER_PATH = new RegExp(`^/covers/(${UUID})/(\\d+)-(250)\\.jpg$`)

/** The same, found anywhere in a text (a JSON file): every distinct cover path in it. */
export function coverPathsIn(text: string): string[] {
  const found = text.matchAll(new RegExp(`/covers/${UUID}/\\d+-250\\.jpg`, 'g'))
  return [...new Set([...found].map((match) => match[0]))]
}

/**
 * Where coverartarchive.org/release/<release>/<id>-250.jpg redirects to. Callers skip that first hop:
 * Cloudflare's TLS handshake with coverartarchive.org fails (525) though browsers' succeeds.
 */
export function archiveThumbnailUrl(releaseMbid: string, imageId: string): string {
  const item = `mbid-${releaseMbid}`
  return `https://archive.org/download/${item}/${item}-${imageId}_thumb250.jpg`
}

/** MusicBrainz and the Internet Archive ask callers to say who they are. */
export const COVER_USER_AGENT = 'music-covers/0.1 (+https://sky.lmfaole.party/apps/medier/musikk)'
