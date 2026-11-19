/**
 * Album covers, served from the app itself: the ones landed on this machine ship in the asset store
 * (`scripts/fetch-covers.ts`), and a cover the Worker does not have comes from the Cover Art Archive.
 *
 * Linking the Cover Art Archive directly sent every browser through its
 * redirect chain (coverartarchive.org, archive.org, then a storage host in
 * the US) on every cold load. Here the Worker fetches each thumbnail once per
 * Cloudflare data centre and keeps it in that data centre's edge cache, and
 * the browser keeps it for a year: a Cover Art Archive image id never
 * changes what it points at, so the URL is as immutable as a hashed asset.
 */

import { archiveThumbnailUrl, COVER_PATH, COVER_USER_AGENT } from '@designsystem/config/cover-archive'
import { withEdgeCache } from '@designsystem/config/edge-cache'
import { CACHE_IMMUTABLE, CACHE_STANDARD, SECURITY_HEADERS } from '@designsystem/config/security-headers'

/** Bump to evict every cached cover, e.g. after changing the thumbnail size. */
const COVER_CACHE_VERSION = 1

/** Whether `url` is one of the covers `handleCover` serves. */
export function isCoverPath(url: URL): boolean {
  return COVER_PATH.test(url.pathname)
}

/**
 * The same-origin URL of a cover's 250px thumbnail, or `null` without a
 * cover or for one `handleCover` would not serve.
 */
export function coverArtUrl(cover: string | null): string | null {
  if (!cover) return null
  const [releaseMbid, imageId] = cover.split('/')
  const path = `/covers/${releaseMbid}/${imageId}-250.jpg`
  return COVER_PATH.test(path) ? path : null
}

function coverResponse(body: BodyInit | null, status: number, contentType: string, cacheControl: string): Response {
  const headers = new Headers(SECURITY_HEADERS)
  headers.set('Content-Type', contentType)
  headers.set('Cache-Control', cacheControl)
  return new Response(body, { status, headers })
}

/** Answers `/covers/*` from the edge cache, or from the Cover Art Archive on a miss. */
export async function handleCover(url: URL): Promise<Response> {
  const [, releaseMbid, imageId] = COVER_PATH.exec(url.pathname) ?? []
  if (releaseMbid === undefined || imageId === undefined) {
    return coverResponse('Ikke funnet\n', 404, 'text/plain; charset=utf-8', CACHE_STANDARD)
  }

  const fetchCover = async () => {
    const upstream = await fetch(archiveThumbnailUrl(releaseMbid, imageId), {
      headers: { 'User-Agent': COVER_USER_AGENT },
    })
    if (!upstream.ok) {
      console.error(`cover: the archive answered ${upstream.status} for ${url.pathname}, from ${upstream.url}`)
      // A failure is not cached anywhere, so a cover the archive adds or
      // recovers later shows up; the page falls back to its placeholder.
      await upstream.body?.cancel()
      return coverResponse(null, upstream.status === 404 ? 404 : 502, 'text/plain; charset=utf-8', 'no-store')
    }
    return coverResponse(upstream.body, 200, upstream.headers.get('Content-Type') ?? 'image/jpeg', CACHE_IMMUTABLE)
  }
  return withEdgeCache(new URL(url.pathname, url.origin), COVER_CACHE_VERSION, fetchCover)
}
