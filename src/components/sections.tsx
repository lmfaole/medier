import { EmptyState } from "@lmfaole/designsystem/components/empty-state"
import { details, PictureRows } from "@lmfaole/designsystem/components/picture-rows"
import { ExternalLink } from "@lmfaole/designsystem/components/external-link"
import { Stack } from "@lmfaole/designsystem/components/layout"
import { Text, TextLink } from "@lmfaole/designsystem/components/text"

import type { Play, TopArtist } from "../lib/lastfm.ts"
import type { Playing } from "../lib/now.ts"
import type { SpotifyArtist } from "../lib/spotify.ts"
import { FromSpotify } from "./credits.tsx"
import { sourcesOf } from "../lib/image-sources.ts"
import { albumHref, artistHref, titleHref, titlePages, trackHref } from "../lib/pages.ts"
import { episodesCode, groupViewings, type Viewing, type Watch } from "../lib/trakt.ts"
import { shortWhen, when } from "../lib/when.ts"

/**
 * The plays, newest first, each with its cover; the artist links to the artist's page here (`artistLinks` off on that page itself). `now` is the song playing this
 * moment, first, marked «nå»: its artist only links where there is a page for it, which is an artist among the plays.
 */
export function PlayRows({ plays, base, limit, artistLinks = true, trackLinks = true, albumLinks = true, now = null }: { plays: readonly Play[]; base: string; limit?: number; artistLinks?: boolean; trackLinks?: boolean; albumLinks?: boolean; now?: Playing | null }) {
  const rows = [
    ...(now === null ? [] : [{ key: `now-${now.url}`, artist: now.artist, track: now.track, album: now.album, image: now.image, aside: "nå", link: now.from === "spotify" ? now.url : null, played: false }]),
    ...plays.map((play) => ({ key: `${play.playedAt}-${play.url}`, artist: play.artist, track: play.track, album: play.album, image: play.image, aside: play.playedAt === null ? "nå" : shortWhen(play.playedAt), link: null, played: play.playedAt !== null })),
  ]
  const shown = limit === undefined ? rows : rows.slice(0, limit)
  if (shown.length === 0) return <EmptyState icon="music" title="Ingen avspillinger å vise" description="Last.fm svarte ikke, eller har ingen avspillinger ennå." />
  const known = new Set(plays.map((play) => play.artist))
  // A cover from Spotify is attributed to Spotify and the title links back to it; Last.fm's covers are Last.fm's.
  const fromSpotify = shown.some((row) => row.link !== null)
  const list = (
    <PictureRows
      ratio="square"
      rows={shown.map((row) => ({
        key: row.key,
        picture: null,
        sources: sourcesOf(row.image),
        // A song that is playing now has no page of its own (it is not among the finished plays the pages are made of); one from Spotify links back to Spotify.
        title: row.link !== null ? <ExternalLink href={row.link}>{row.track}</ExternalLink> : trackLinks && row.played ? <TextLink href={trackHref(base, row.artist, row.track)}>{row.track}</TextLink> : row.track,
        detail: details([
          artistLinks && known.has(row.artist) ? <TextLink href={artistHref(base, row.artist)}>{row.artist}</TextLink> : row.artist,
          albumLinks && row.played && row.album !== "" ? <TextLink href={albumHref(base, row.artist, row.album)}>{row.album}</TextLink> : row.album,
        ]),
        aside: row.aside,
      }))}
    />
  )
  return fromSpotify ? (
    <Stack gap="md">
      {list}
      <FromSpotify />
    </Stack>
  ) : (
    list
  )
}

/**
 * The most played artists of the last month, ranked, each with its picture from Spotify where Spotify has an artist of that name. A picture from Spotify is attributed to it and
 * links back (their developer policy): the row's detail line has the link, and the list ends with Spotify's mark.
 */
export function TopArtistRows({ artists, base, pictures }: { artists: readonly TopArtist[]; base: string; pictures: ReadonlyMap<string, SpotifyArtist> }) {
  if (artists.length === 0) return <Text tone="muted">Ingen artister ennå.</Text>
  const list = (
    <PictureRows
      ratio="square"
      rows={artists.map((artist, index) => {
        const found = pictures.get(artist.name)
        return {
          key: artist.name,
          picture: null,
          sources: found?.images ?? [],
          title: <TextLink href={artistHref(base, artist.name)}>{artist.name}</TextLink>,
          detail: details([`${artist.plays.toLocaleString("nb-NO")} avspillinger`, found === undefined ? null : <ExternalLink href={found.url}>Åpne i Spotify</ExternalLink>]),
          aside: `Nr. ${index + 1}`,
        }
      })}
    />
  )
  return pictures.size === 0 ? (
    list
  ) : (
    <Stack gap="md">
      {list}
      <FromSpotify />
    </Stack>
  )
}

/** Films and episodes, newest first, each with its poster and a link to it on Trakt. */
export function WatchRows({ items, base, limit }: { items: readonly Watch[]; base: string; limit?: number }) {
  const rows = groupViewings(items)
  // Each viewing's page: the film's, or the show's for an episode.
  const pageOf = new Map(titlePages(items).flatMap((page) => page.viewings.map((watch) => [String(watch.id), page.slug] as const)))
  const shown = limit === undefined ? rows : rows.slice(0, limit)
  if (shown.length === 0) return <EmptyState icon="film" title="Ingenting å vise" description="Trakt svarte ikke, eller har ingenting sett ennå." />
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

/** «Hentet fra Last.fm 19. nov. 2026, 14:05.», or that the source did not answer, for each source in one line. */
export function Fetched({ sources }: { sources: readonly { at: string | null; source: string }[] }) {
  const parts = sources.map(({ at, source }) => (at === null ? `${source} svarte ikke.` : `Hentet fra ${source} ${when(at)}.`))
  return <Text size="sm" tone="muted">{parts.join(" ")}</Text>
}
