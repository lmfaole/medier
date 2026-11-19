/** Posters from TMDB (https://www.themoviedb.org): which address to ask for a film's or a show's, and what to keep of the answer. Pure, so a test pins it. */

const API = "https://api.themoviedb.org/3"
const IMAGES = "https://image.tmdb.org/t/p/w185"

/** The address that tells TMDB about a film or a show; an episode has its show's poster. */
export const detailsUrl = (kind: "film" | "episode", tmdbId: number): string => `${API}/${kind === "film" ? "movie" : "tv"}/${tmdbId}`

/** TMDB has two kinds of key: a long read access token (sent as a bearer) and a short API key (sent in the address). */
export function authorize(key: string, url: string): { url: string; headers: Record<string, string> } {
  if (key.startsWith("eyJ")) return { url, headers: { Authorization: `Bearer ${key}` } }
  return { url: `${url}?api_key=${encodeURIComponent(key)}`, headers: {} }
}

/** The poster's address from TMDB's answer, or `null` where it has none. */
export function parsePoster(answer: unknown): string | null {
  if (typeof answer !== "object" || answer === null) return null
  const path = (answer as Record<string, unknown>)["poster_path"]
  return typeof path === "string" && path.startsWith("/") ? `${IMAGES}${path}` : null
}
