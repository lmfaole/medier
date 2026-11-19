/**
 * CSP hashes for the inline scripts in a page Astro renders. A page carries inline scripts the
 * client needs to hydrate (each island's start-up script), and they change with every
 * request, so the hashes are taken from the page itself rather than written down, and the
 * page is read whole before it is sent (a page is a few kilobytes).
 *
 * Hashing what the server wrote would allow a script that was reflected into the page, which is what
 * the CSP is there to stop. Nothing is reflected as markup: React escapes text, and Astro writes the
 * props as data inside its own script, escaping what could close it. A new page that writes raw HTML
 * (`dangerouslySetInnerHTML`) from a request or from data would break that, so none does.
 */

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g

/**
 * The HTML parser normalizes the document before it tokenizes: every CRLF and
 * lone CR becomes LF, and every NUL in a script becomes U+FFFD. The browser
 * hashes the parsed text, so the hash is taken over the same normalization.
 * A script's props can contain NULs, and a build on Windows would
 * otherwise get a CSP hash that matches nothing and blocks the very script it
 * was written for.
 */
async function scriptHash(body: string): Promise<string> {
  const parsed = body.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\0', '�')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parsed))
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`
}

/** `response` with its inline scripts added to `script-src`; anything but HTML passes through unread. */
export async function withInlineScriptHashes(response: Response): Promise<Response> {
  if (!(response.headers.get('Content-Type') ?? '').startsWith('text/html')) return response

  const html = await response.text()
  const hashes = await Promise.all([...html.matchAll(INLINE_SCRIPT)].map((match) => scriptHash(match[1] ?? "")))
  const headers = new Headers(response.headers)
  if (hashes.length > 0) {
    const policy = headers.get('Content-Security-Policy') ?? ''
    headers.set('Content-Security-Policy', policy.replace("script-src 'self'", `script-src 'self' ${hashes.join(' ')}`))
  }
  return new Response(html, { status: response.status, headers })
}
