import { defineMiddleware } from 'astro:middleware'

import { usersOf } from './lib/runtime'
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
  const response = await next()
  const who = encodeURIComponent(whoOf(usersOf(context.cookies)))
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
