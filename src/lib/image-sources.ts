/**
 * The widths an image service offers for one picture, from the address the API gave: TMDB serves `/t/p/<size>/…` (w92, w185, w342) and Last.fm
 * `/i/u/<size>/…` (64s, 174s, 300x300). The design system's `Picture` takes them as `sources` and the browser picks the smallest that is sharp,
 * so a 40 px thumbnail does not fetch a 300 px file. An address from anywhere else is the one source there is.
 */
import type { PictureSource } from "@lmfaole/designsystem/lib/picture-sources"

const TMDB = /^(https:\/\/image\.tmdb\.org\/t\/p\/)[^/]+(\/.+)$/
const LASTFM = /^(https:\/\/[^/]*lastfm[^/]*\/i\/u\/)[^/]+(\/.+)$/

export function sourcesOf(url: string | null): PictureSource[] {
  if (url === null || url === "") return []
  const tmdb = TMDB.exec(url)
  if (tmdb !== null) return [92, 185, 342].map((width) => ({ src: `${tmdb[1]}w${width}${tmdb[2]}`, width }))
  const lastfm = LASTFM.exec(url)
  if (lastfm !== null) return [["64s", 64], ["174s", 174], ["300x300", 300]].map(([size, width]) => ({ src: `${lastfm[1]}${size}${lastfm[2]}`, width: Number(width) }))
  return [{ src: url, width: 300 }]
}
