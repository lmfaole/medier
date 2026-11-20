import { EmptyState } from "@lmfaole/designsystem/components/empty-state"
import { details, PictureRows } from "@lmfaole/designsystem/components/picture-rows"
import { ExternalLink } from "@lmfaole/designsystem/components/external-link"
import { NowPlayingCard } from "@lmfaole/designsystem/components/now-playing-card"
import { Stack } from "@lmfaole/designsystem/components/layout"
import { Text, TextLink } from "@lmfaole/designsystem/components/text"

import type { Play, TopArtist } from "../lib/lastfm.ts"
import type { Playing } from "../lib/now.ts"
import type { SpotifyArtist } from "../lib/spotify.ts"
import { FromSpotify } from "./credits.tsx"
import { sourcesOf } from "../lib/image-sources.ts"
import { SHAPES } from "../lib/shapes.ts"
import { albumHref, artistHref, titleHref, titlePages, trackHref } from "../lib/pages.ts"
import { episodesCode, groupViewings, type Viewing, type Watch } from "../lib/trakt.ts"
import { shortWhen, when } from "../lib/when.ts"

/**
 * The plays, newest first, each with its cover; the artist links to the artist's page here (`artistLinks` off on that page itself). `now` is the song playing this
 * moment, first, marked «nå»: its artist only links where there is a page for it, which is an artist among the plays.
 */
export function PlayRows({ plays, base, limit, artistLinks = true, trackLinks = true, albumLinks = true, now = null }: { plays: readonly Play[]; base: string; limit?: number; artistLinks?: boolean; trackLinks?: boolean; albumLinks?: boolean; now?: Playing | null }) {
  const rows = [
    ...(now === null ? [] : [{ key: `now-${now.url}`, artist: now.artist, track: now.track, album: now.album, image: now.image, aside: "Spilles nå", live: true, played: false }]),
    ...plays.map((play) => ({ key: `${play.playedAt}-${play.url}`, artist: play.artist, track: play.track, album: play.album, image: play.image, aside: play.playedAt === null ? "Spilles nå" : shortWhen(play.playedAt), live: play.playedAt === null, played: play.playedAt !== null })),
  ]
  const shown = limit === undefined ? rows : rows.slice(0, limit)
  if (shown.length === 0) return <EmptyState icon="music" title="Ingen avspillinger ennå" description="Last.fm fører opp det du hører på når en spiller (Spotify, Apple Music eller andre) er koblet til kontoen. Det kan også være at Last.fm ikke svarte akkurat nå." action={{ href: "https://www.last.fm/about/trackmymusic", label: "Koble til en spiller" }} />
  const known = new Set(plays.map((play) => play.artist))
  return (
    <PictureRows
      {...SHAPES.track}
      rows={shown.map((row) => ({
        key: row.key,
        picture: null,
        sources: sourcesOf(row.image),
        // A song that is playing now has no page of its own (it is not among the finished plays the pages are made of).
        title: trackLinks && row.played ? <TextLink href={trackHref(base, row.artist, row.track)}>{row.track}</TextLink> : row.track,
        detail: details([
          artistLinks && known.has(row.artist) ? <TextLink href={artistHref(base, row.artist)}>{row.artist}</TextLink> : row.artist,
          albumLinks && row.played && row.album !== "" ? <TextLink href={albumHref(base, row.artist, row.album)}>{row.album}</TextLink> : row.album,
        ]),
        aside: row.aside,
        live: row.live,
      }))}
    />
  )
}

/** What plays now, large: a disc of Last.fm's cover turning under the page's light (the cover as it is where Last.fm has none). */
export function NowPlayingSection({ now }: { now: Playing }) {
  const cover = now.disc ?? now.image
  return <NowPlayingCard disc={now.disc !== null} sources={sourcesOf(cover)} title={now.track} detail={details([now.artist, now.album === "" ? null : now.album])} />
}

/**
 * The most played artists of the last month, ranked, each with its picture from Spotify where Spotify has an artist of that name. A picture from Spotify is attributed to it and
 * links back (their developer policy): the row's detail line has the link, and the list ends with Spotify's mark.
 */
export function TopArtistRows({ artists, base, pictures }: { artists: readonly TopArtist[]; base: string; pictures: ReadonlyMap<string, SpotifyArtist> }) {
  if (artists.length === 0) return <Text tone="muted">Ingen artister ennå.</Text>
  const list = (
    <PictureRows
      {...SHAPES.artist}
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

/** The films (`kind` film) or the episodes (`kind` episode), newest first, each with its poster and a link to its page here: the film's, or the show's. */
export function WatchRows({ items, base, limit, kind }: { items: readonly Watch[]; base: string; limit?: number; kind: Watch["kind"] }) {
  const rows = groupViewings(items)
  const pageOf = new Map(titlePages(items).flatMap((page) => page.viewings.map((watch) => [String(watch.id), titleHref(base, page.slug, page.kind)] as const)))
  const shown = limit === undefined ? rows : rows.slice(0, limit)
  if (shown.length === 0) {
    return kind === "film" ? (
      <EmptyState icon="film" title="Ingen filmer sett ennå" description="Filmene du markerer som sett på Trakt, eller som en tilkoblet strømmetjeneste fører opp der, dukker opp her. Det kan også være at Trakt ikke svarte akkurat nå." action={{ href: "https://trakt.tv/movies/trending", label: "Marker en film som sett på Trakt" }} />
    ) : (
      <EmptyState icon="tv" title="Ingen episoder sett ennå" description="Episodene du markerer som sett på Trakt, eller som en tilkoblet strømmetjeneste fører opp der, dukker opp her. Det kan også være at Trakt ikke svarte akkurat nå." action={{ href: "https://trakt.tv/shows/trending", label: "Marker en episode som sett på Trakt" }} />
    )
  }
  return (
    <PictureRows
      ratio="poster"
      rows={shown.map((viewing) => ({
        key: viewing.key,
        picture: null,
        sources: sourcesOf(viewing.poster),
        title: pageOf.has(viewing.key) ? <TextLink href={pageOf.get(viewing.key) ?? ""}>{viewing.title}</TextLink> : viewing.title,
        detail: details(viewingDetail(viewing)),
        aside: shortWhen(viewing.watchedAt),
      }))}
    />
  )
}

/** The shows among the episodes, the one watched last first, each with how many episodes of it were seen and a link to its page. */
export function ShowRows({ items, base }: { items: readonly Watch[]; base: string }) {
  const shows = titlePages(items).filter((page) => page.kind === "episode")
  return (
    <PictureRows
      ratio="poster"
      rows={shows.map((show) => ({
        key: show.slug,
        picture: null,
        sources: sourcesOf(show.poster),
        title: <TextLink href={titleHref(base, show.slug, show.kind)}>{show.title}</TextLink>,
        detail: details([show.year, `${show.viewings.length} ${show.viewings.length === 1 ? "episode" : "episoder"} sett`]),
        aside: shortWhen(show.viewings[0]?.watchedAt ?? ""),
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
