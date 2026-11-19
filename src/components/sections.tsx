import { EmptyState } from "@lmfaole/designsystem/components/empty-state"
import { details, PictureRows } from "@lmfaole/designsystem/components/picture-rows"
import { Rows } from "@lmfaole/designsystem/components/rows"
import { Text, TextLink } from "@lmfaole/designsystem/components/text"

import type { Music, TopArtist } from "../lib/lastfm.ts"
import { episodeCode, type Watch } from "../lib/trakt.ts"
import { when } from "../lib/when.ts"

/** The plays, newest first, each with its cover and a link to the track on Last.fm. */
export function PlayRows({ music, limit }: { music: Music; limit?: number }) {
  const plays = limit === undefined ? music.recent : music.recent.slice(0, limit)
  if (plays.length === 0) return <EmptyState icon="music" title="Ingen avspillinger ennå" description="De kommer når Last.fm er hentet første gang." />
  return (
    <PictureRows
      ratio="square"
      rows={plays.map((play) => ({
        key: `${play.playedAt}-${play.url}`,
        picture: play.image,
        title: <TextLink href={play.url} external>{play.track}</TextLink>,
        detail: details([play.artist, play.album]),
        aside: play.playedAt === null ? "nå" : when(play.playedAt),
      }))}
    />
  )
}

/** The most played artists of the last month, ranked. */
export function TopArtistRows({ artists }: { artists: readonly TopArtist[] }) {
  if (artists.length === 0) return <Text tone="muted">Ingen artister ennå.</Text>
  return (
    <Rows
      lead="rank"
      columns={{ name: "Artist", value: "Avspillinger" }}
      rows={artists.map((artist) => ({ key: artist.name, body: <TextLink href={artist.url} external>{artist.name}</TextLink>, trailing: <Text as="span" tone="muted" numeric>{artist.plays.toLocaleString("nb-NO")}</Text> }))}
    />
  )
}

/** Films and episodes, newest first, each with its poster and a link to it on Trakt. */
export function WatchRows({ items, limit }: { items: readonly Watch[]; limit?: number }) {
  const shown = limit === undefined ? items : items.slice(0, limit)
  if (shown.length === 0) return <EmptyState icon="film" title="Ingenting sett ennå" description="Det kommer når Trakt er hentet første gang." />
  return (
    <PictureRows
      ratio="poster"
      rows={shown.map((watch) => ({
        key: String(watch.id),
        picture: watch.poster,
        title: <TextLink href={watch.url} external>{watch.title}</TextLink>,
        detail: details([watch.kind === "film" ? "Film" : "Episode", watch.year, watch.episode === null ? null : `${episodeCode(watch.episode)}${watch.episode.title === "" ? "" : ` «${watch.episode.title}»`}`]),
        aside: when(watch.watchedAt),
      }))}
    />
  )
}

/** «Hentet fra Last.fm 19. nov. 2026, 14:05.», or that it has not been yet, for each source in one line. */
export function Fetched({ sources }: { sources: readonly { at: string | null; source: string }[] }) {
  const parts = sources.map(({ at, source }) => (at === null ? `Ikke hentet fra ${source} ennå.` : `Hentet fra ${source} ${when(at)}.`))
  return <Text size="sm" tone="muted">{parts.join(" ")}</Text>
}
