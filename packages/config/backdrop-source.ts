/**
 * Where the wide picture of a film or a series comes from: TMDB's image server, at the width a page head uses, and the
 * same-origin path the app serves it under. The loader checks the file name; the script that lands the pictures asks here.
 */

/** `/backdrops/<file>.jpg`, the file captured. The file name is a plain one: letters, digits, dash and underscore. */
export const BACKDROP_PATH = /^\/backdrops\/([A-Za-z0-9_-]+\.jpg)$/

/** Every backdrop path in a text (a JSON file), each once. */
export function backdropPathsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\/backdrops\/[A-Za-z0-9_-]+\.jpg/g)].map((match) => match[0]))]
}

/** TMDB's 780-pixel-wide version of a backdrop file. */
export function tmdbBackdropUrl(file: string): string {
  return `https://image.tmdb.org/t/p/w780/${file}`
}
