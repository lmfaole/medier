import * as v from "valibot"

/**
 * A `fetch` for the owner's own Nextcloud, from a page the media server served on the same origin (`sky.lmfaole.party`, behind the one Access login): the
 * session cookie authenticates and a CSRF token protects. The page is not rendered by PHP, so it has no `data-requesttoken`; the token is fetched once from
 * `/index.php/csrftoken` and again when Nextcloud answers 412 (stale). This is the browser-to-data-owner write path of the home apps (`AGENTS.md`): it
 * never goes through the Node server, and this module only builds the request.
 */

const OCS = { "OCS-APIREQUEST": "true" } as const
const CsrfToken = v.object({ token: v.string() })

export type NextcloudFetch = (url: string, init?: RequestInit) => Promise<Response>

/** The fetch, and the headers a request needs that the page cannot send itself (a Background Fetch is made of ready `Request`s). */
export interface NextcloudSession {
  fetch: NextcloudFetch
  /** The headers of an authenticated call: the CSRF token (fetched if it is not yet) and `OCS-APIREQUEST`. */
  headers(): Promise<Record<string, string>>
}

export function nextcloudSession(fetchFn: typeof fetch = fetch): NextcloudSession {
  let token: string | undefined
  const refresh = async (): Promise<void> => {
    const response = await fetchFn("/index.php/csrftoken", { credentials: "same-origin", headers: OCS })
    if (response.ok) token = v.parse(CsrfToken, await response.json()).token
  }
  const headers = async (): Promise<Record<string, string>> => {
    if (token === undefined) await refresh()
    return { ...(token === undefined ? {} : { requesttoken: token }), ...OCS }
  }
  const send = async (url: string, init: RequestInit): Promise<Response> =>
    fetchFn(url, { ...init, credentials: "same-origin", headers: { ...(await headers()), ...Object.fromEntries(new Headers(init.headers)) } })
  return {
    headers,
    fetch: async (url, init = {}) => {
      const response = await send(url, init)
      if (response.status !== 412) return response
      await refresh()
      return send(url, init)
    },
  }
}

export const nextcloudFetch = (fetchFn: typeof fetch = fetch): NextcloudFetch => nextcloudSession(fetchFn).fetch
