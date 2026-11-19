/**
 * Where a film poster comes from: TMDB's image server, at the width the pages use, and the same-origin path the
 * film app serves it under. The film app's loader checks the file name; the script that lands the posters asks here.
 */

/** `/posters/<file>.jpg`, the file captured. The file name is a plain one: letters, digits, dash and underscore. */
export const POSTER_PATH = /^\/posters\/([A-Za-z0-9_-]+\.jpg)$/

/** Every poster path in a text (a JSON file), each once. */
export function posterPathsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\/posters\/[A-Za-z0-9_-]+\.jpg/g)].map((match) => match[0]))]
}

/** TMDB's 342-pixel-wide version of a poster file. */
export function tmdbPosterUrl(file: string): string {
  return `https://image.tmdb.org/t/p/w342/${file}`
}
