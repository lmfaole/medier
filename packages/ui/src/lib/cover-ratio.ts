import type { AppId } from "./apps"

/** The shape of an app's pictures, decided once by what the app is about: an album, a podcast or a board game's box is square; a film, a series, a game or a book is a poster. */
const COVER_RATIOS = { music: "square", podkast: "square", boardgames: "square", film: "poster", tv: "poster", games: "poster", books: "poster" } as const satisfies Record<AppId, "poster" | "square">

export function coverRatioOf(app: AppId): "poster" | "square" {
  return COVER_RATIOS[app]
}
