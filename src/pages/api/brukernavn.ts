import type { APIRoute } from 'astro'

import { lastfmUserFound, traktUserFound } from '../../lib/runtime'
import { backWithError, backWithoutError, COOKIE, COOKIE_MAX_AGE, fieldAction, safeBack, SERVICES, type Service } from '../../lib/users'

const found: Record<Service, (user: string) => Promise<boolean>> = { lastfm: lastfmUserFound, trakt: traktUserFound }

/**
 * Where the username form posts (no JS needed): `lastfm` and `trakt`, each checked with its service before it is kept in a cookie for a year; an empty field clears its cookie, a field that is not
 * in the form leaves it be. Then back to `back` (a path on this site only), with `brukernavn-feil` and `brukernavn-verdi` when a username was not found, for the page's form to say so.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const form = await request.formData().catch(() => new FormData())
  let back = backWithoutError(safeBack(form.get('back')))
  for (const service of SERVICES) {
    const action = fieldAction(form.get(service))
    if (action.kind === 'keep') continue
    if (action.kind === 'clear') {
      cookies.delete(COOKIE[service], { path: '/' })
      continue
    }
    if (action.kind === 'set' && (await found[service](action.user))) {
      cookies.set(COOKIE[service], action.user, { path: '/', maxAge: COOKIE_MAX_AGE, sameSite: 'lax', secure: true, httpOnly: true })
      continue
    }
    back = backWithError(back, service, action.kind === 'set' ? action.user : action.value)
  }
  return new Response(null, { status: 303, headers: { Location: back, 'Cache-Control': 'no-store' } })
}
