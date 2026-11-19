/**
 * The favourite photos of a concert, as small pictures from `.data/concert-photos/` (`music-sync concert-photos` keeps them), served
 * by the music app itself so that a page never asks Immich. They are photos of people and places: the media server answers only
 * the owner (the login gate), and the only names served are the ones the sync writes, an Immich id or `venue-<slug>` (the map of a venue, `npm run venue:maps`) and `.webp` or `.jpg`.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { CACHE_IMMUTABLE, CACHE_STANDARD, SECURITY_HEADERS } from '@designsystem/config/security-headers'

export const PHOTO_PATH = /^\/concert-photos\/((?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|venue-[a-z0-9-]+)\.(?:webp|jpg))$/

const TYPES: Readonly<Record<string, string>> = { webp: 'image/webp', jpg: 'image/jpeg' }

/** Whether `url` is one of the pictures `handlePhoto` serves. */
export function isPhotoPath(url: URL): boolean {
  return PHOTO_PATH.test(url.pathname)
}

/** The address of a kept picture, under the app's base: what the page puts in `src`. */
export const photoPath = (file: string): string => `/concert-photos/${file}`

/** Answers `/concert-photos/<id>.<ext>` from `directory`, a 404 for a name that is not one the sync writes or has no file. */
export async function handlePhoto(url: URL, directory: string): Promise<Response> {
  const file = PHOTO_PATH.exec(url.pathname)?.[1]
  const body = file === undefined ? null : await readFile(join(directory, file)).catch(() => null)
  const headers = new Headers(SECURITY_HEADERS)
  if (file === undefined || body === null) {
    headers.set('Content-Type', 'text/plain; charset=utf-8')
    headers.set('Cache-Control', CACHE_STANDARD)
    return new Response('Ikke funnet\n', { status: 404, headers })
  }
  headers.set('Content-Type', TYPES[file.slice(file.lastIndexOf('.') + 1)] ?? 'application/octet-stream')
  headers.set('Cache-Control', CACHE_IMMUTABLE)
  return new Response(body, { status: 200, headers })
}
