/**
 * Security headers, robots policy and cache rules shared by every app's
 * worker, so the five near-identical copies that used to live in each
 * `headere.ts`/`headers.ts` cannot drift apart (two already had: accounts
 * and cv carried two robots directives the others lacked).
 */

export const ROBOTS = [
  'noindex',
  'nofollow',
  'noarchive',
  'nosnippet',
  'noimageindex',
  'noindex-max-image-preview:none',
  'max-image-preview:none',
  'max-snippet:0',
  'notrack',
].join(', ')

/**
 * The headers every response carries. Every image is same-origin: an app
 * that shows images from elsewhere proxies them through its Worker, as
 * music does with album covers, instead of widening `img-src`.
 */
export const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'none'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "manifest-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    // The period select is a GET form that sends the choice to the page itself, so it works without JavaScript.
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'X-Robots-Tag': ROBOTS,
}

/**
 * The headers of an app that wants to be found by a search engine (`work`): every
 * header of `SECURITY_HEADERS` but `X-Robots-Tag`. The other apps never use it.
 */
export const INDEXABLE_HEADERS: Record<string, string> = Object.fromEntries(Object.entries(SECURITY_HEADERS).filter(([name]) => name !== 'X-Robots-Tag'))

/**
 * The headers a Worker serves under `vite dev`, where the HTML behind a page
 * is not the built shell: Vite and Astro put inline scripts in it that no
 * hash can cover — hashes are only sound for static, built HTML
 * (`inline-script-hashes.ts`) — so dev allows inline scripts. It also allows
 * the `blob:` worker Vite's client polls with after the dev server restarts.
 * Nothing else differs. A built Worker picks `SECURITY_HEADERS` instead; see `dev-flag.ts`.
 */
export const DEV_SECURITY_HEADERS = {
  ...SECURITY_HEADERS,
  'Content-Security-Policy': `${SECURITY_HEADERS['Content-Security-Policy'].replace(
    "script-src 'self'",
    "script-src 'self' 'unsafe-inline'",
  )}; worker-src blob:`,
}

/**
 * `headers` with one more origin allowed to be framed by the page. The one
 * app that embeds something (photos, Ente's album) says so here, so no other
 * app's policy widens.
 */
export function withFrameSource<Headers extends Record<string, string>>(headers: Headers, origin: string): Headers {
  return { ...headers, 'Content-Security-Policy': `${headers['Content-Security-Policy']}; frame-src ${origin}` }
}

/**
 * `headers` with more origins the page may call with `fetch`. The one app whose
 * page calls an open API itself (dashboard) says so here, so no other app's
 * policy widens.
 */
export function withConnectSource<Headers extends Record<string, string> & { 'Content-Security-Policy': string }>(headers: Headers, ...origins: string[]): Headers {
  return { ...headers, 'Content-Security-Policy': headers['Content-Security-Policy'].replace("connect-src 'self'", `connect-src 'self' ${origins.join(' ')}`) }
}

/** `/assets/*` is a Vite build with a content hash in the file name. */
export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * `/api/*` is read from D1. Ten minutes in the browser and an hour at the
 * edge keeps D1 reads down to about once per hour per data centre, no
 * matter how much traffic there is; `stale-while-revalidate` means a
 * visitor still gets an instant answer while the edge refreshes.
 */
export const CACHE_API = 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400'

/** Everything else must revalidate, or a new deploy stays cached for anyone who visited in between. */
export const CACHE_STANDARD = 'public, max-age=0, must-revalidate'

/**
 * Content that never changes under the same name, so it can sit in a cache for
 * a year: hashed build output, the album covers under `/covers/` (a Cover Art Archive image id never changes what it points at) and the film posters under `/posters/` (a poster file has its own name), and the images under `/media/`, which
 * are uploaded once and replaced by uploading a differently named file. Two
 * apps kept this rule as a private `cacheFor` of their own before it moved
 * here, and accounts has always left it out, so its images revalidated on
 * every view.
 */
export function isImmutablePath(pathname: string): boolean {
  return pathname.startsWith('/assets/') || pathname.startsWith('/_astro/') || pathname.startsWith('/media/') || pathname.startsWith('/og/') || pathname.startsWith('/covers/') || pathname.startsWith('/posters/')
}

/** The cache rule for a path: the API, immutable content, or everything else. */
export function cacheControlFor(pathname: string): string {
  if (pathname.startsWith('/api/')) return CACHE_API
  if (isImmutablePath(pathname)) return CACHE_IMMUTABLE
  return CACHE_STANDARD
}

/**
 * `Cache-Control` for an answer only the logged-in owner may see: `public` becomes `private` and `s-maxage` goes, so no
 * shared cache keeps it for the next visitor. The browser's own lifetimes (the hashed assets' year) are kept.
 */
export function privateCacheControl(value: string): string {
  const parts = value.split(',').map((part) => part.trim()).filter((part) => part !== '' && part !== 'public' && part !== 'private' && !part.startsWith('s-maxage'))
  return parts.includes('no-store') ? 'no-store' : ['private', ...parts].join(', ')
}

/**
 * Crawlers refused with 403 instead of relying on `noindex`, which an AI
 * crawler is free to ignore. The list is explicit names, not a match on
 * "bot", so a legitimate browser is never caught by accident.
 *
 * Social link-unfurl bots (`facebookexternalhit`, `Twitterbot`, `Slackbot`,
 * `Discordbot`, `WhatsApp`, ...) are deliberately NOT on this list: they are
 * what render Open Graph link previews when a page is shared privately, and
 * blocking them would silently break those previews while changing nothing
 * about search indexing (`noindex` already handles that).
 */
export const BLOCKED_CRAWLERS = [
  'Googlebot',
  'Bingbot',
  'YandexBot',
  'DuckDuckBot',
  'Baiduspider',
  'Applebot',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'anthropic-ai',
  'ClaudeBot',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'Amazonbot',
  'meta-externalagent',
  'cohere-ai',
  'Diffbot',
  'SemrushBot',
  'AhrefsBot',
  'MJ12bot',
  'PetalBot',
]

const SEARCH_ENGINES = ['Googlebot', 'Bingbot', 'YandexBot', 'DuckDuckBot', 'Baiduspider', 'Applebot']

/** What an app that lets search engines in still refuses: every blocked crawler that is not one of them. */
export const AI_AND_SEO_CRAWLERS: readonly string[] = BLOCKED_CRAWLERS.filter((bot) => !SEARCH_ENGINES.includes(bot))
