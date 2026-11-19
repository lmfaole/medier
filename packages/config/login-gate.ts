/**
 * The login of the media apps, which share the origin of Nextcloud (`sky.lmfaole.party`) and so receive its cookies.
 * The gate asks Nextcloud who the cookie belongs to and lets in only the owner; the verdict is kept for a minute
 * so a page's many requests cost one question. Nothing here stores or logs the cookie itself.
 *
 * It runs anywhere `Request`, `Response` and `crypto.subtle` do: in a Worker it asks Nextcloud's public address, and in the
 * Node server of the media apps (`scripts/media-server.ts`) the container on the same network (`whoAmI`, with the public
 * name as `host`).
 */
import * as v from 'valibot'

import { IS_DEV } from './dev-flag.ts'

/** The one Nextcloud user allowed in; another account on the same server must not read the owner's data. */
export const OWNER_ID = 'ole'
export const NEXTCLOUD_ORIGIN = 'https://sky.lmfaole.party'

/** The cookies Nextcloud sets at login (`lib/private/User/Session.php`, `setMagicInCookie`). */
const SESSION_COOKIES = ['nc_session_id', 'nc_username', 'nc_token']
const VERDICT_TTL_MS = 60_000
/** Not under any app's route in `wrangler.jsonc`, so the subrequest reaches Nextcloud and cannot loop back into a Worker. */
const WHO_AM_I = `${NEXTCLOUD_ORIGIN}/ocs/v2.php/cloud/user?format=json`

const WhoAmI = v.object({ ocs: v.object({ data: v.object({ id: v.string() }) }) })

type Verdict = 'owner' | 'other' | 'anonymous'

export interface LoginGate {
  /** `undefined` lets the request through; any response is the final answer. */
  check(request: Request, asked: Request, headers: Record<string, string>): Promise<Response | undefined>
  /** The keys the verdict cache holds, for tests: they must be digests, never cookies. */
  verdictKeys(): string[]
}

export interface LoginGateOptions {
  fetchImpl?: typeof fetch
  now?: () => number
  /** Where to ask who a cookie belongs to; Nextcloud's public address unless the server reaches it another way. */
  whoAmI?: string
  /** Sent as `Host` when `whoAmI` is an internal address (a `fetchImpl` that can set it is needed). */
  host?: string
  /** Where a visitor with no session is sent to log in. */
  loginOrigin?: string
  /** The one account let in. */
  ownerId?: string
}

function hasSessionCookie(cookie: string): boolean {
  return cookie.split(';').some((part) => SESSION_COOKIES.includes(part.split('=')[0]?.trim() ?? ''))
}

export async function cookieDigest(cookie: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cookie)))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A page the browser navigates to gets the login page; a fetch, manifest, script or image gets a plain 401. */
function isNavigation(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const destination = request.headers.get('sec-fetch-dest')
  if (destination !== null) return destination === 'document'
  return (request.headers.get('accept') ?? '').includes('text/html')
}

function reply(status: number, body: string, headers: Record<string, string>, extra: Record<string, string> = {}): Response {
  const merged = new Headers(headers)
  merged.set('Content-Type', 'text/plain; charset=utf-8')
  merged.set('Cache-Control', 'no-store')
  for (const [name, value] of Object.entries(extra)) merged.set(name, value)
  return new Response(body, { status, headers: merged })
}

export function createLoginGate({
  fetchImpl = (input, init) => fetch(input, init),
  now = Date.now,
  whoAmI = WHO_AM_I,
  host,
  loginOrigin = NEXTCLOUD_ORIGIN,
  ownerId = OWNER_ID,
}: LoginGateOptions = {}): LoginGate {
  const verdicts = new Map<string, { verdict: Verdict; expires: number }>()

  async function ask(cookie: string): Promise<Verdict> {
    const response = await fetchImpl(whoAmI, {
      headers: { Cookie: cookie, 'OCS-APIREQUEST': 'true', Accept: 'application/json', ...(host === undefined ? {} : { Host: host }) },
      redirect: 'manual',
    })
    if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) return 'anonymous'
    if (!response.ok) throw new Error(`Nextcloud answered ${response.status}`)
    const named = v.safeParse(WhoAmI, await response.json())
    if (!named.success) throw new Error('Nextcloud did not name the user')
    return named.output.ocs.data.id === ownerId ? 'owner' : 'other'
  }

  async function verdictFor(cookie: string): Promise<Verdict> {
    const key = await cookieDigest(cookie)
    const kept = verdicts.get(key)
    if (kept !== undefined && kept.expires > now()) return kept.verdict
    const verdict = await ask(cookie)
    verdicts.set(key, { verdict, expires: now() + VERDICT_TTL_MS })
    // Expired entries are dropped when the map grows, so a stream of different cookies cannot fill the isolate.
    if (verdicts.size > 200) for (const [oldKey, entry] of verdicts) if (entry.expires <= now()) verdicts.delete(oldKey)
    return verdict
  }

  return {
    verdictKeys: () => [...verdicts.keys()],
    async check(request, asked, headers) {
      const cookie = request.headers.get('cookie') ?? ''
      let verdict: Verdict = 'anonymous'
      if (hasSessionCookie(cookie)) {
        try {
          verdict = await verdictFor(cookie)
        } catch {
          // Closed, not open: when Nextcloud cannot say who this is, nobody is let in.
          return reply(503, 'Innloggingen er utilgjengelig akkurat nå. Prøv igjen om litt.\n', headers, { 'Retry-After': '30' })
        }
      }
      if (verdict === 'owner') return undefined
      if (verdict === 'other') return reply(403, 'Denne kontoen har ikke tilgang.\n', headers)
      if (isNavigation(request)) {
        const target = new URL(asked.url)
        const location = `${loginOrigin}/login?redirect_url=${encodeURIComponent(target.pathname + target.search)}`
        return reply(302, '', headers, { Location: location })
      }
      return reply(401, 'Logg inn først.\n', headers)
    },
  }
}

/** The gate a gated Worker uses; none under `vite dev`, where there is no Nextcloud session on localhost. */
export function loginGateFor(required: boolean): LoginGate | undefined {
  return required && !IS_DEV ? createLoginGate() : undefined
}
