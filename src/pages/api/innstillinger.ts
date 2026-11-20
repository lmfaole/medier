import type { APIRoute } from 'astro'
import { parsePrefs, PREFS_COOKIE } from '@lmfaole/designsystem/lib/preferences'

import { formPrefs, FROM_FIRST_RUN, planUsernames, settingsRedirect, SOURCE_FIELD, stepErrors } from '../../lib/settings-form'
import { forgetFirstRun, keepPrefs, keepUsernames, markFirstRunSeen, userFound } from '../../lib/visitor-cookies'
import { safeBack } from '../../lib/users'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Where the first-run wizard and «Innstillinger» post, one form each, no JS needed:
 * - `validate=<step>` with `Accept: application/json` (the wizard with JS, a step at a time): the usernames in it checked, `{ "errors": { "lastfm": "…" } }`, nothing kept.
 * - `skip=1`: the wizard left for good (`first-run@1` in `seen`), nothing else.
 * - `rerun=1`: «Vis introen igjen», the wizard out of `seen`.
 * - else the settings: the usernames found are kept and the emptied forgotten (as `/api/brukernavn/`), the theme, the effects, the tilt and the sections in `prefs`, and the wizard marked seen when all
 *   was well (from either); a username not found sends the visitor back to the field (in the wizard, to its step).
 * Then 303 to `back`, a path on this site only.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const form = await request.formData().catch(() => new FormData())
  const back = safeBack(form.get('back'))
  const plan = await planUsernames(form, userFound)
  if (form.has('validate') && (request.headers.get('accept') ?? '').includes('application/json')) {
    return Response.json({ errors: stepErrors(plan) }, { headers: NO_STORE })
  }
  if (form.get('skip') === '1') {
    markFirstRunSeen(cookies)
    return redirect(settingsRedirect(back, { set: {}, clear: [], invalid: {} }, false))
  }
  if (form.get('rerun') === '1') {
    forgetFirstRun(cookies)
    return redirect(settingsRedirect(back, { set: {}, clear: [], invalid: {} }, false))
  }
  keepUsernames(cookies, plan)
  keepPrefs(cookies, formPrefs(parsePrefs(cookies.get(PREFS_COOKIE)?.value), form))
  const fromFirstRun = form.get(SOURCE_FIELD) === FROM_FIRST_RUN
  // Settings made, here or on «Innstillinger», are the wizard done.
  if (Object.keys(plan.invalid).length === 0) markFirstRunSeen(cookies)
  return redirect(settingsRedirect(back, plan, fromFirstRun))
}

const redirect = (to: string): Response => new Response(null, { status: 303, headers: { Location: to, ...NO_STORE } })
