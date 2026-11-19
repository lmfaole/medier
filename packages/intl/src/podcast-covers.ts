/**
 * Where a show's picture comes from: the address its feed or Apple's directory gives (`podcast_show_info.image_url`),
 * checked against the hosts the feeds keep them on, and the same-origin path the app serves it under
 * (`/covers/<slug>.jpg`). The script that lands the pictures asks `covers.json` for the address, so nothing but these
 * hosts is ever fetched.
 */

import { slugOf } from './text.ts'

/** Hosts (by suffix) a show's picture may be fetched from: Apple's, and the ones the shows' own feeds use. */
const HOSTS: readonly string[] = ['mzstatic.com', 'imgix.net', 'libsyn.com', 'podbean.com', 'fireside.fm', 'simplecastcdn.com', 'cloudfront.net', 'patreonusercontent.com']

/** `/covers/<file>.jpg`, the file captured. */
export const SHOW_COVER_PATH = /^\/covers\/([a-z0-9-]+\.jpg)$/

function allowed(address: string): URL | null {
  try {
    const url = new URL(address)
    return url.protocol === 'https:' && HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url : null
  } catch {
    return null
  }
}

/** The path the app serves a show's picture at, or none when the address is not on one of the hosts. */
export function showCoverPathOf(address: string | null): string | null {
  return address !== null && allowed(address) !== null ? `/covers/${slugOf(address)}.jpg` : null
}

/** The address the script asks for: a small version where the host can give one (Apple's 600 pixels become 300). */
export function showCoverSourceOf(address: string): string | null {
  const url = allowed(address)
  if (url === null) return null
  if (url.hostname.endsWith('mzstatic.com')) return address.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/, '/300x300bb.jpg')
  if (url.hostname.endsWith('imgix.net')) return `${url.origin}${url.pathname}?w=300&h=300&fit=crop`
  return address
}
