import { EmptyState } from "@lmfaole/designsystem/components/empty-state"
import { details, PictureRows } from "@lmfaole/designsystem/components/picture-rows"
import { Rows } from "@lmfaole/designsystem/components/rows"
import { Text, TextLink } from "@lmfaole/designsystem/components/text"

import type { Play, TopArtist } from "../lib/lastfm.ts"
import { sourcesOf } from "../lib/image-sources.ts"
import { artistHref, titleHref, titlePages } from "../lib/pages.ts"
import { episodesCode, groupViewings, type Viewing, type Watch } from "../lib/trakt.ts"
import { shortWhen, when } from "../lib/when.ts"

/** The plays, newest first, each with its cover; the artist links to the artist's page here (`artistLinks` off on that page itself). */
export function PlayRows({ plays, base, limit, artistLinks = true }: { plays: readonly Play[]; base: string; limit?: number; artistLinks?: boolean }) {
  const shown = limit === undefined ? plays : plays.slice(0, limit)
  if (shown.length === 0) return <EmptyState icon="music" title="Ingen avspillinger ennå" description="De kommer når Last.fm er hentet første gang." />
  return (
    <PictureRows
      ratio="square"
      rows={shown.map((play) => ({
        key: `${play.playedAt}-${play.url}`,
        picture: null,
        sources: sourcesOf(play.image),
        title: play.track,
        detail: details([artistLinks ? <TextLink href={artistHref(base, play.artist)}>{play.artist}</TextLink> : null, play.album]),
        aside: play.playedAt === null ? "nå" : shortWhen(play.playedAt),
      }))}
    />
  )
}

/** The most played artists of the last month, ranked. */
export function TopArtistRows({ artists, base }: { artists: readonly TopArtist[]; base: string }) {
  if (artists.length === 0) return <Text tone="muted">Ingen artister ennå.</Text>
  return (
    <Rows
      lead="rank"
      columns={{ name: "Artist", value: "Avspillinger" }}
      rows={artists.map((artist) => ({ key: artist.name, body: <TextLink href={artistHref(base, artist.name)}>{artist.name}</TextLink>, trailing: <Text as="span" tone="muted" numeric>{artist.plays.toLocaleString("nb-NO")}</Text> }))}
    />
  )
}

/** Films and episodes, newest first, each with its poster and a link to it on Trakt. */
export function WatchRows({ items, base, limit }: { items: readonly Watch[]; base: string; limit?: number }) {
  const rows = groupViewings(items)
  // Each viewing's page: the film's, or the show's for an episode.
  const pageOf = new Map(titlePages(items).flatMap((page) => page.viewings.map((watch) => [String(watch.id), page.slug] as const)))
  const shown = limit === undefined ? rows : rows.slice(0, limit)
  if (shown.length === 0) return <EmptyState icon="film" title="Ingenting sett ennå" description="Det kommer når Trakt er hentet første gang." />
  return (
    <PictureRows
      ratio="poster"
      rows={shown.map((viewing) => ({
        key: viewing.key,
        picture: null,
        sources: sourcesOf(viewing.poster),
        title: <TextLink href={titleHref(base, pageOf.get(viewing.key) ?? "")}>{viewing.title}</TextLink>,
        detail: details(viewingDetail(viewing)),
        aside: shortWhen(viewing.watchedAt),
      }))}
    />
  )
}

/** What a row says under its title: a film's year; an episode's place and title; a run's count and range. The code comes first, so a narrow screen cuts the episode's title, never where it is in the show. */
function viewingDetail(viewing: Viewing): (string | number | null)[] {
  const [only] = viewing.episodes
  if (viewing.kind === "film") return ["Film", viewing.year]
  if (viewing.episodes.length > 1) return [episodesCode(viewing.episodes), `${viewing.episodes.length} episoder`]
  return [episodesCode(viewing.episodes), only === undefined || only.title === "" ? null : only.title]
}

/** «Hentet fra Last.fm 19. nov. 2026, 14:05.», or that it has not been yet, for each source in one line. */
export function Fetched({ sources }: { sources: readonly { at: string | null; source: string }[] }) {
  const parts = sources.map(({ at, source }) => (at === null ? `Ikke hentet fra ${source} ennå.` : `Hentet fra ${source} ${when(at)}.`))
  return <Text size="sm" tone="muted">{parts.join(" ")}</Text>
}
