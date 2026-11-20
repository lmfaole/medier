/** Posters from TMDB (https://www.themoviedb.org): which address to ask for a film's or a show's, and what to keep of the answer. Pure, so a test pins it. */

const API = "https://api.themoviedb.org/3"
const IMAGES = "https://image.tmdb.org/t/p/w185"

/** The address that tells TMDB about a film or a show, in Norwegian where TMDB has it; an episode has its show's poster and facts. */
export const detailsUrl = (kind: "film" | "episode", tmdbId: number): string => `${API}/${kind === "film" ? "movie" : "tv"}/${tmdbId}?language=nb-NO`

/** TMDB has two kinds of key: a long read access token (sent as a bearer) and a short API key (sent in the address). */
export function authorize(key: string, url: string): { url: string; headers: Record<string, string> } {
  if (key.startsWith("eyJ")) return { url, headers: { Authorization: `Bearer ${key}` } }
  return { url: `${url}${url.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(key)}`, headers: {} }
}

/** The poster's address from TMDB's answer, or `null` where it has none. */
export function parsePoster(answer: unknown): string | null {
  if (typeof answer !== "object" || answer === null) return null
  const path = (answer as Record<string, unknown>)["poster_path"]
  return typeof path === "string" && path.startsWith("/") ? `${IMAGES}${path}` : null
}

/** What the site keeps of a film or a show beyond its poster: a few lines to know it by. Anything TMDB has not got is `null` (or none). */
export interface TitleInfo {
  /** The plot, in Norwegian where TMDB has it; `null` where it has none (it does not fall back to English: a Norwegian page does not read English). */
  overview: string | null
  genres: string[]
  /** A film's length in minutes. */
  runtime: number | null
  /** A show's number of seasons. */
  seasons: number | null
  /** TMDB's users' vote, 0 to 10, with how many voted: `null` for a title nobody has voted on. */
  rating: { value: number; votes: number } | null
}

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
const positive = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null)

export function parseInfo(answer: unknown): TitleInfo {
  const details = record(answer)
  const overview = typeof details["overview"] === "string" ? details["overview"].trim() : ""
  const genres = (Array.isArray(details["genres"]) ? details["genres"] : []).flatMap((genre) => {
    const name = record(genre)["name"]
    return typeof name === "string" && name !== "" ? [name] : []
  })
  const value = positive(details["vote_average"])
  const votes = positive(details["vote_count"]) ?? 0
  return { overview: overview === "" ? null : overview, genres, runtime: positive(details["runtime"]), seasons: positive(details["number_of_seasons"]), rating: value === null || votes === 0 ? null : { value, votes } }
}
