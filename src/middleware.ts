import { defineMiddleware } from 'astro:middleware'

import { parsePrefs, PREFS_COOKIE, serializePrefs } from '@lmfaole/designsystem/lib/preferences'

import { oldAddress } from './lib/media'
import { usersOf } from './lib/runtime'
import { firstRunOpen } from './lib/visitor-cookies'
import { WHO_HEADER, whoOf } from './lib/users'

/**
 * Every page (and server island) is made for the visitor's usernames, so none may be kept by a shared cache: `private`, and `Vary: Cookie` for a cache that keeps it anyway. `X-Medier-Who` says whose
 * page it is, so the service worker keeps the pages of one visitor at a time (`public/sw.js`). The built files are served before the Worker and keep their own headers.
 */
const mark = (headers: Headers, who: string): void => {
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'private, no-cache')
  const vary = headers.get('Vary')
  if (vary === null || !/\bcookie\b/i.test(vary)) headers.set('Vary', vary === null ? 'Cookie' : `${vary}, Cookie`)
  if ((headers.get('Content-Type') ?? '').includes('text/html')) headers.set(WHO_HEADER, who)
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Old addresses, in one step: the shared history and wrapped are the music's now, and film and TV together (/film-og-tv/) is Film and TV apart.
  const moved = oldAddress(import.meta.env.BASE_URL, context.url.pathname, context.url.search)
  if (moved !== null) return new Response(null, { status: 301, headers: { Location: moved, 'Cache-Control': 'public, max-age=3600' } })
  const response = await next()
  // Whose page, and as what it was drawn (the theme, the effects, the sections, the wizard open or not): a change of any of them and the service worker lets go of the pages it kept.
  const drawn = `${serializePrefs(parsePrefs(context.cookies.get(PREFS_COOKIE)?.value))}|${firstRunOpen(context.cookies, context.url) ? 'first-run' : ''}`
  const who = encodeURIComponent(`${whoOf(usersOf(context.cookies))}|${drawn}`)
  try {
    // In place: the response carries the cookies the page set, which a copy would lose.
    mark(response.headers, who)
    return response
  } catch {
    const copy = new Response(response.body, response)
    mark(copy.headers, who)
    return copy
  }
})
