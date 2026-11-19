/**
 * Where a cover comes from. The register's address is checked against the hosts the three registers keep their covers
 * on, and the page gets a path the app serves itself (`/covers/<slug>.jpg`): the script that lands the covers asks the
 * address again from the same API file, so nothing but these hosts is ever fetched.
 */

import { slugOf } from '@designsystem/intl/text'

const COVER_HOSTS: readonly string[] = ['covers.openlibrary.org', 'images.igdb.com', 'cf.geekdo-images.com']

/** `/covers/<file>.jpg`, the file captured. A plain file name: letters, digits and dashes. */
export const COVER_PATH = /^\/covers\/([a-z0-9-]+\.jpg)$/

/** Every cover path in a text (a JSON file), each once. */
export function coverPathsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\/covers\/[a-z0-9-]+\.jpg/g)].map((match) => match[0]))]
}

/** The path an app serves the cover at, or none when the address is not on a register's own host. */
export function coverPathOf(address: string | null): string | null {
  if (address === null) return null
  try {
    const url = new URL(address)
    return url.protocol === 'https:' && COVER_HOSTS.includes(url.hostname) ? `/covers/${slugOf(address)}.jpg` : null
  } catch {
    return null
  }
}

/** Whether an address is one a cover may be fetched from. */
export function isCoverSource(address: string): boolean {
  return coverPathOf(address) !== null
}

/** The hosts a wide picture for behind a work's page is kept on: IGDB's screenshots and Open Library's author photos. */
const BANNER_HOSTS: readonly string[] = ['images.igdb.com', 'covers.openlibrary.org']

/** `/banners/<file>.jpg`, the file captured. */
export const BANNER_PATH = /^\/banners\/([a-z0-9-]+\.jpg)$/

/** The path an app serves a work's wide picture at, or none when the address is not on one of the hosts. */
export function bannerPathOf(address: string | null): string | null {
  if (address === null) return null
  try {
    const url = new URL(address)
    return url.protocol === 'https:' && BANNER_HOSTS.includes(url.hostname) ? `/banners/${slugOf(address)}.jpg` : null
  } catch {
    return null
  }
}

/** Whether an address is one a wide picture may be fetched from. */
export function isBannerSource(address: string): boolean {
  return bannerPathOf(address) !== null
}

/** The hosts an achievement's picture is kept on (Steam, RetroAchievements, Xbox): only these are ever fetched. */
const ICON_HOSTS: readonly string[] = ['steamcdn-a.akamaihd.net', 'cdn.steamstatic.com', 'media.retroachievements.org', 'images-eds-ssl.xboxlive.com']

/** `/icons/<file>.jpg`, the file captured. */
export const ICON_PATH = /^\/icons\/([a-z0-9-]+\.jpg)$/

function iconHost(address: string): URL | null {
  try {
    const url = new URL(address)
    return url.protocol === 'https:' && ICON_HOSTS.includes(url.hostname) ? url : null
  } catch {
    return null
  }
}

/** The path an app serves an achievement's picture at, or none when the address is not on one of the hosts. */
export function iconPathOf(address: string | null): string | null {
  return address !== null && iconHost(address) !== null ? `/icons/${slugOf(address)}.jpg` : null
}

/** The address the script asks for: Xbox's pictures are up to 1920 wide, so it is asked for a small jpg. */
export function iconSourceOf(address: string): string | null {
  const url = iconHost(address)
  if (url === null) return null
  return url.hostname === 'images-eds-ssl.xboxlive.com' ? `${address}&format=jpg&w=128&h=128` : address
}

/** Whether an address is one an achievement's picture may be fetched from, as the page's file names it. */
export function isIconSource(address: string): boolean {
  return iconHost(address) !== null
}

/** `/logos/<file>.png`, the file captured: a developer's logo, kept as the register's transparent PNG. */
export const LOGO_PATH = /^\/logos\/([a-z0-9-]+\.png)$/

/** The path an app serves a developer's logo at, or none when the address is not on a register's own host. */
export function logoPathOf(address: string | null): string | null {
  if (address === null) return null
  try {
    const url = new URL(address)
    return url.protocol === 'https:' && COVER_HOSTS.includes(url.hostname) ? `/logos/${slugOf(address)}.png` : null
  } catch {
    return null
  }
}
