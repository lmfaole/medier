/**
 * Where a cinema's picture comes from: the address `film-cinemas.csv` gives (a photo on the cinema's own site), and the
 * same-origin path the film app serves it under, `/cinemas/<hash of the address>.<ext>`. The path is a function of the
 * address, so a page names the file without asking the disk, and `scripts/fetch-cinema-images.ts` lands what the pages name.
 */

/** `/cinemas/<file>`, the file captured. The file name is a plain one: letters and digits, and an image extension. */
export const CINEMA_IMAGE_PATH = /^\/cinemas\/([A-Za-z0-9]+\.(?:jpg|png|webp))$/

/** Every cinema picture path in a text (a JSON file), each once. */
export function cinemaImagePathsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\/cinemas\/[A-Za-z0-9]+\.(?:jpg|png|webp)/g)].map((match) => match[0]))]
}

/** FNV-1a over the address, in eight hex digits: stable, and no more than a name for the file. */
function hashOf(text: string): string {
  let hash = 0x811c9dc5
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

/** The path a cinema's picture is served under, or `null` for an address that is not `http` or `https`. */
export function cinemaImagePath(address: string): string | null {
  if (!/^https?:\/\//.test(address)) return null
  const extension = /\.(png|webp)(?:[?#]|$)/i.exec(address)?.[1]?.toLowerCase() ?? "jpg"
  return `/cinemas/${hashOf(address)}.${extension}`
}
