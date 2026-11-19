/**
 * Error pages a Worker answers with itself, for when the React app cannot
 * run: an exception in the Worker (500), or an address with nothing at it
 * (404). Self-contained HTML with inline
 * styles (allowed by `style-src 'unsafe-inline'`) and no script, laid out
 * like `@designsystem/ui`'s `ErrorPage` so both read as the same site.
 */

interface ErrorPage {
  title: string
  message: string
  action: { href: string; label: string }
}

const SERVER_ERROR: ErrorPage = {
  title: 'Noe gikk galt',
  message: 'Tjeneren fikk en feil den ikke kom seg ut av. Prøv igjen om litt. Hvis det fortsetter, ligger feilen hos oss.',
  action: { href: '/', label: 'Gå til forsiden' },
}

const PAGES: Partial<Record<number, ErrorPage>> = {
  404: {
    title: 'Siden finnes ikke',
    message: 'Det er ingenting på denne adressen. Siden kan ha flyttet, eller lenken har en skrivefeil.',
    action: { href: '/', label: 'Gå til forsiden' },
  },
  500: SERVER_ERROR,
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character)

/** The page for `status` (404 or 500; anything else reads as a 500), as a complete HTML document. */
export function errorPageHtml(status: number): string {
  const page = PAGES[status] ?? SERVER_ERROR
  return `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${status} · ${escapeHtml(page.title)}</title>
<style>
  :root { color-scheme: light dark; --background: #fff; --foreground: #0a0a0a; --muted: #737373; --primary: #171717; --primary-foreground: #fafafa; }
  @media (prefers-color-scheme: dark) { :root { --background: #0a0a0a; --foreground: #fafafa; --muted: #a3a3a3; --primary: #e5e5e5; --primary-foreground: #171717; } }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 1rem; background: var(--background); color: var(--foreground); font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
  main { display: grid; gap: 0.75rem; max-width: 36rem; }
  .status { margin: 0; color: var(--muted); font: 0.875rem ui-monospace, monospace; }
  h1 { margin: 0; font-size: 1.875rem; letter-spacing: -0.02em; }
  p { margin: 0; color: var(--muted); }
  a { justify-self: start; margin-top: 0.75rem; padding: 0.5rem 1rem; border-radius: 0.5rem; background: var(--primary); color: var(--primary-foreground); font-size: 0.875rem; font-weight: 500; text-decoration: none; }
</style>
</head>
<body>
<main>
<p class="status">${status}</p>
<h1>${escapeHtml(page.title)}</h1>
<p>${escapeHtml(page.message)}</p>
<a href="${escapeHtml(page.action.href)}">${escapeHtml(page.action.label)}</a>
</main>
</body>
</html>
`
}

/**
 * An error response in the shape the request expects: JSON under `/api/`,
 * where a page's `fetch` reads it, and the HTML page everywhere else.
 * `headers` are the app's security headers, which an error must carry too.
 */
export function errorResponse(request: Request, status: number, headers: Record<string, string>): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'no-store')
  if (new URL(request.url).pathname.startsWith('/api/')) {
    responseHeaders.set('Content-Type', 'application/json; charset=utf-8')
    const title = (PAGES[status] ?? SERVER_ERROR).title
    return new Response(JSON.stringify({ error: title }), { status, headers: responseHeaders })
  }
  responseHeaders.set('Content-Type', 'text/html; charset=utf-8')
  return new Response(errorPageHtml(status), { status, headers: responseHeaders })
}

/**
 * Wraps a Worker's `fetch` so an exception becomes the shared 500 page (or
 * JSON under `/api/`) instead of Cloudflare's generic error screen, with
 * the app's security headers still on it. The exception is logged.
 */
export function withServerErrorPage<Rest extends unknown[]>(
  handle: (request: Request, ...rest: Rest) => Promise<Response>,
  headers: Record<string, string>,
): (request: Request, ...rest: Rest) => Promise<Response> {
  return async (request, ...rest) => {
    try {
      return await handle(request, ...rest)
    } catch (error) {
      console.error(`Unhandled error for ${request.method} ${new URL(request.url).pathname}:`, error)
      return errorResponse(request, 500, headers)
    }
  }
}
