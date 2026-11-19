/** What the site keeps of Trakt's public history (`/users/<user>/history`), and how it is read from the answer. Pure, so a test pins it. */

export interface Watch {
  /** Trakt's id of the history entry: the same viewing keeps it. */
  id: number
  watchedAt: string
  kind: "film" | "episode"
  /** The film's title, or the show's. */
  title: string
  year: number | null
  /** For an episode: its own title and where it is in the show. */
  episode: { title: string; season: number; number: number } | null
  url: string
}

export interface Watched {
  at: string | null
  user: string
  items: Watch[]
}

type Json = Record<string, unknown>
const object = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {})
const text = (value: unknown): string => (typeof value === "string" ? value : "")
const whole = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null)

export function parseHistory(answer: unknown): Watch[] {
  if (!Array.isArray(answer)) return []
  return answer.flatMap((value): Watch[] => {
    const item = object(value)
    const id = whole(item["id"])
    const watchedAt = text(item["watched_at"])
    if (id === null || watchedAt === "") return []
    if (item["type"] === "movie") {
      const movie = object(item["movie"])
      const slug = text(object(movie["ids"])["slug"])
      return [{ id, watchedAt, kind: "film", title: text(movie["title"]), year: whole(movie["year"]), episode: null, url: slug === "" ? "https://trakt.tv" : `https://trakt.tv/movies/${slug}` }]
    }
    if (item["type"] === "episode") {
      const show = object(item["show"])
      const episode = object(item["episode"])
      const season = whole(episode["season"]) ?? 0
      const number = whole(episode["number"]) ?? 0
      const slug = text(object(show["ids"])["slug"])
      const url = slug === "" ? "https://trakt.tv" : `https://trakt.tv/shows/${slug}/seasons/${season}/episodes/${number}`
      return [{ id, watchedAt, kind: "episode", title: text(show["title"]), year: whole(show["year"]), episode: { title: text(episode["title"]), season, number }, url }]
    }
    return []
  })
}

/** Newest first, each viewing once (two pages of history can overlap while a new one is added). */
export function mergeHistory(...pages: readonly Watch[][]): Watch[] {
  const byId = new Map<number, Watch>()
  for (const page of pages) for (const watch of page) byId.set(watch.id, watch)
  return [...byId.values()].toSorted((a, b) => b.watchedAt.localeCompare(a.watchedAt))
}

/** «S2 E5» */
export const episodeCode = (episode: { season: number; number: number }): string => `S${episode.season} E${episode.number}`
