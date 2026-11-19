/** The CV used to be at `jobb.lmfaole.party`, a host of its own; it is now at `lmfaole.party/cv`. */
export const FORMER_HOST = 'jobb.lmfaole.party'

/** Where a request for the former host goes (the same path under `/cv`), or `null` for a request that is not for it. */
export function formerHostRedirect(url: URL): string | null {
  if (url.hostname !== FORMER_HOST) return null
  const rest = url.pathname.replace(/^\/+/, '')
  return `https://lmfaole.party/cv/${rest}${url.search}`
}
