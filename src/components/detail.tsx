import type { ReactNode } from "react"

import { ExternalLink } from "@lmfaole/designsystem/components/external-link"
import { FactList } from "@lmfaole/designsystem/components/fact-list"
import { LinkButton } from "@lmfaole/designsystem/components/link-button"
import { Split, Stack } from "@lmfaole/designsystem/components/layout"
import { PageSection } from "@lmfaole/designsystem/components/page-section"
import { RankedRows } from "@lmfaole/designsystem/components/ranked-rows"
import { Tiles } from "@lmfaole/designsystem/components/tiles"
import { details, PictureRows } from "@lmfaole/designsystem/components/picture-rows"
import { Rows } from "@lmfaole/designsystem/components/rows"
import { Text, TextLink } from "@lmfaole/designsystem/components/text"

import type { AlbumInfo, ArtistInfo, TopTrack, TrackInfo } from "../lib/lastfm.ts"
import { firstSentences } from "../lib/lastfm.ts"
import { type AlbumPage, type Appearance, type ArtistPage, artistHref, albumHref, personHref, titleHref, type TitlePage, type TrackPage, trackSlug, trackHref } from "../lib/pages.ts"
import type { SpotifyAlbum, SpotifyArtist, SpotifyTrack } from "../lib/spotify.ts"
import { albumKey, type ShelfAlbum } from "../lib/albums.ts"
import { coversFromPlays } from "../lib/artist-listening.ts"
import { type ArtistLink, type LatestRelease as Release, latestReleaseText, releaseCover } from "../lib/musicbrainz-artist.ts"
import type { AlbumsFrom, ArtistListening } from "../lib/sources.ts"
import { sourcesOf } from "../lib/image-sources.ts"
import { SHAPES } from "../lib/shapes.ts"
import { type Person, profileSources } from "../lib/tmdb.ts"
import { episodesCode } from "../lib/trakt.ts"
import { ageOn, lengthText, longDay, releaseText } from "../lib/days.ts"
import { shortWhen } from "../lib/when.ts"
import { PlayRows } from "./sections.tsx"

/** A big count in few characters: «5,1 mill.» from a million, the whole number («320 000») below. */
const compactCount = (n: number): string => (n >= 1_000_000 ? new Intl.NumberFormat("nb-NO", { notation: "compact", maximumFractionDigits: 1 }).format(n) : n.toLocaleString("nb-NO"))
const count = (n: number, one: string, many: string): string => `${n.toLocaleString("nb-NO")} ${n === 1 ? one : many}`

/** A film's length as «2 t 50 min»; under an hour just the minutes. */
export const runtimeText = (minutes: number): string => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} t${minutes % 60 === 0 ? "" : ` ${minutes % 60} min`}`)

/** A film or a show: its poster, when and how often it was seen, every viewing, and last the way to it on Trakt. */
export function TitleDetail({ page, base }: { page: TitlePage; base: string }) {
  const latest = page.viewings[0]
  const cast = page.info?.cast ?? []
  const crew = page.info?.crew ?? []
  const episodes = page.viewings.flatMap((watch) => (watch.episode === null ? [] : [watch.episode]))
  const facts = (
    <Stack gap="lg">
      <FactList
        facts={[
          ["Sjanger", page.info === null || page.info.genres.length === 0 ? null : page.info.genres.join(", ")],
          page.kind === "film" ? ["Varighet", page.info?.runtime == null ? null : runtimeText(page.info.runtime)] : ["Sesonger", page.info?.seasons == null ? null : String(page.info.seasons)],
          ["Vurdering på TMDB", page.info?.rating == null ? null : `${page.info.rating.value.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} av 10`],
          ["Sist sett", latest === undefined ? null : shortWhen(latest.watchedAt)],
          page.kind === "film" ? ["Sett", count(page.viewings.length, "gang", "ganger")] : ["Episoder sett", count(new Set(episodes.map((episode) => `${episode.season}:${episode.number}`)).size, "episode", "episoder")],
        ]}
      />
    </Stack>
  )
  // The poster and its facts are the pane (beside the list on a desktop, above it on a phone); the link out is last in the main column.
  return (
    <Split rail={facts}>
      {page.info?.overview == null ? null : (
        <PageSection id="om" title={page.kind === "film" ? "Om filmen" : "Om serien"}>
          <Text>{page.info.overview}</Text>
        </PageSection>
      )}
      {cast.length === 0 ? null : (
        <PageSection id="rolleliste" title="Rolleliste">
          <PictureRows {...SHAPES.person} rows={cast.map((one, index) => ({ key: `${one.id}`, picture: null, sources: profileSources(one.profile), title: <TextLink href={personHref(base, one.id, one.name)}>{one.name}</TextLink>, detail: details([one.role]), aside: `Nr. ${index + 1}` }))} />
        </PageSection>
      )}
      {crew.length === 0 ? null : (
        <PageSection id="stab" title="Bak kamera">
          <Rows columns={{ name: "Navn", value: "Rolle" }} rows={crew.map((one) => ({ key: `${one.id}-${one.role}`, body: <TextLink href={personHref(base, one.id, one.name)}>{one.name}</TextLink>, trailing: <Text as="span" size="sm" tone="muted">{one.role}</Text> }))} />
        </PageSection>
      )}
      <PageSection id="sett" title={page.kind === "film" ? "Når du så den" : "Episodene du har sett"}>
        <Rows
          columns={{ name: page.kind === "film" ? "Visning" : "Episode", value: "Sett" }}
          rows={page.viewings.map((watch) => ({
            key: String(watch.id),
            body: watch.episode === null ? "Film" : `${episodesCode([watch.episode])}${watch.episode.title === "" ? "" : ` · ${watch.episode.title}`}`,
            trailing: <Text as="span" size="sm" tone="muted">{shortWhen(watch.watchedAt)}</Text>,
          }))}
        />
      </PageSection>
      <LinkButton href={page.traktUrl} external>Åpne på Trakt</LinkButton>
    </Split>
  )
}

/**
 * The artists like one that the visitor plays too, with Spotify's pictures (`pictures`, by name; the page's server island asks for them with a budget of its own, and its fallback has none). `url` is
 * the artist on Last.fm, which found them.
 */
export function SimilarArtists({ similar, pictures, linked, base, url }: { similar: ArtistListening["similar"]; pictures: ReadonlyMap<string, SpotifyArtist>; /** The names that have a page of their own here. */ linked: ReadonlySet<string>; base: string; url: string }) {
  if (similar.length === 0) return null
  return (
    <PageSection id="lignende" title="Lignende artister du også hører" icon="person">
      <PictureRows
        {...SHAPES.artist}
        rows={similar.map((one) => {
          const spotify = pictures.get(one.name) ?? null
          return {
            key: one.name,
            picture: null,
            sources: spotify?.images ?? [],
            title: linked.has(one.name) ? <TextLink href={artistHref(base, one.name)}>{one.name}</TextLink> : one.name,
            detail: spotify === null ? null : <ExternalLink href={spotify.url}>Åpne i Spotify</ExternalLink>,
            aside: count(one.plays, "avspilling", "avspillinger"),
          }
        })}
      />
      <Text size="sm" tone="muted">
        Artistene <TextLink href={url} external>Last.fm</TextLink> finner lignende, blant dem du har hørt mest på.
      </Text>
    </PageSection>
  )
}

/**
 * The visitor's most played songs by an artist, each with its album's cover (`covers`, by title: from the recent plays, and from Last.fm for the others in the page's server island; a song with none
 * keeps its empty frame). `linked` are the titles that have a page of their own here.
 */
export function TopTracks({ artist, tracks, covers, linked, base }: { artist: string; tracks: readonly TopTrack[]; covers: ReadonlyMap<string, string>; linked: ReadonlySet<string>; base: string }) {
  if (tracks.length === 0) return null
  return (
    <PageSection id="mest-spilte" title="Dine mest spilte" icon="play">
      <RankedRows
        {...SHAPES.track}
        rows={tracks.map((track) => ({
          key: track.title,
          sources: sourcesOf(covers.get(track.title) ?? null),
          title: linked.has(track.title) ? <TextLink href={trackHref(base, artist, track.title)}>{track.title}</TextLink> : track.title,
          value: count(track.plays, "avspilling", "avspillinger"),
          amount: track.plays,
        }))}
      />
    </PageSection>
  )
}

/**
 * The artist's newest album, single or EP from the last two years, or the one that is coming (`musicbrainz-artist.ts`): its cover (`releaseCover`: the plays', else the Cover Art Archive's), what it is
 * and when, and a link to the album's page where it is among the plays (`played`: the edition played, by `albumKey`). Nothing where there is none.
 */
export function LatestRelease({ artist, release, played, covers, base, today }: { artist: string; release: Release | null; played: ReadonlyMap<string, string>; covers: ReadonlyMap<string, string>; base: string; today: string }) {
  if (release === null) return null
  const { kind, when } = latestReleaseText(release, today)
  const edition = played.get(albumKey(release.title))
  return (
    <PageSection id="utgivelse" title={release.upcoming ? "Neste utgivelse" : "Siste utgivelse"} icon="new">
      <PictureRows
        {...SHAPES.album}
        rows={[{ key: release.id, picture: null, sources: sourcesOf(releaseCover(release, covers)), title: edition === undefined ? release.title : <TextLink href={albumHref(base, artist, edition)}>{release.title}</TextLink>, detail: details([kind]), aside: when }]}
      />
    </PageSection>
  )
}

/** The artist's links on from MusicBrainz (its own site, Wikipedia, Bandcamp…), as buttons under Last.fm's and Spotify's, each named for where it goes. */
export function ArtistLinks({ links }: { links: readonly ArtistLink[] }) {
  return links.map((link) => (
    <LinkButton key={link.kind} href={link.url} external>
      {link.label}
    </LinkButton>
  ))
}

/** The year an album came out, from MusicBrainz's day, as a tile's line. */
const yearOf = (released: string | null): string | null => (released === null ? null : released.slice(0, 4))

/**
 * An artist: its newest release where it is news, what Last.fm's users write of it, then the visitor's own listening to it (their plays over time, their most played songs by it), its albums, its recent plays, the artists like it
 * that they play too, and last the ways to it on Last.fm and Spotify and on from MusicBrainz (its own site, Wikipedia…). The picture and the link to it are Spotify's; the tags, the listeners and the text are Last.fm's (its text is the users', CC BY-SA, with
 * the link back where it is shown). `chart` is the chart of the plays over time, an island the page puts in; `songs` the most played songs with their covers (`TopTracks`), another.
 */
export function ArtistDetail({ page, base, info, listening, links, chart, similar, songs, latest, onward }: { page: ArtistPage; base: string; info: { lastfm: ArtistInfo | null; spotify: SpotifyArtist | null; albums: ShelfAlbum[]; albumsFrom: AlbumsFrom }; listening: ArtistListening | null; /** The slugs of the songs and the artists that have a page of their own here. */ links: { tracks: ReadonlySet<string>; artists: ReadonlySet<string> }; chart?: ReactNode; /** The artists like it that the visitor plays too (`SimilarArtists`), a server island the page puts in. */ similar?: ReactNode; /** The most played songs (`TopTracks`), a server island the page puts in; without it they are shown with the covers of the recent plays. */ songs?: ReactNode; /** The newest release (`LatestRelease`), a server island the page puts in. */ latest?: ReactNode; /** The links on from MusicBrainz (`ArtistLinks`), a server island the page puts in. */ onward?: ReactNode }) {
  const { lastfm, spotify, albums, albumsFrom } = info
  // The albums among the recent plays have a page of their own here, under the name of the edition that was played; the others are only named.
  const played = new Map(page.plays.filter((play) => play.album !== "").map((play) => [albumKey(play.album), play.album]))
  const tracks = listening?.tracks ?? []
  // The plays, the place, the share of all and last month's plays are the head's figures, and when it was first heard is in the chart: each is said once. The pane is what is like it, and the ways out.
  const rail = (
    <Stack gap="xl">
      {similar}
      <Stack gap="sm">
        <LinkButton href={page.url} external>Åpne på Last.fm</LinkButton>
        {spotify === null ? null : <LinkButton href={spotify.url} external>Åpne i Spotify</LinkButton>}
        {onward}
      </Stack>
    </Stack>
  )
  return (
    <Split rail={rail} position="end">
      {latest}
      {lastfm?.bio == null && lastfm?.listeners == null ? null : (
        <PageSection id="om" title="Om artisten">
          {lastfm.bio == null ? null : (
            <>
              <Text>{lastfm.bio}</Text>
              <Text size="sm" tone="muted">
                Tekst fra <TextLink href={page.url} external>Last.fm</TextLink>, brukernes egen (CC BY-SA).
              </Text>
            </>
          )}
          <FactList facts={[["Lyttere på Last.fm", lastfm.listeners == null ? null : lastfm.listeners.toLocaleString("nb-NO")]]} />
        </PageSection>
      )}
      {chart === undefined ? null : (
        <PageSection id="lytting" title="Din lytting" icon="chart">
          {chart}
        </PageSection>
      )}
      {songs ?? <TopTracks artist={page.name} tracks={tracks} covers={coversFromPlays(page.plays, page.name, tracks.map((track) => track.title))} linked={new Set(tracks.flatMap((track) => (links.tracks.has(trackSlug(page.name, track.title)) ? [track.title] : [])))} base={base} />}
      {albums.length === 0 ? null : (
        <PageSection id="album" title="Album">
          <Tiles
            tiles={albums.map((album) => {
              const edition = played.get(albumKey(album.title))
              return {
                key: album.title,
                href: edition === undefined ? null : albumHref(base, page.name, edition),
                title: album.title,
                picture: null,
                sources: sourcesOf(album.image),
                ...SHAPES.album,
                detail: yearOf(album.released),
                lines: album.plays === null ? [] : [`${compactCount(album.plays)} avspillinger`],
              }
            })}
          />
          <Text size="sm" tone="muted">
            {albumsFrom === "musicbrainz" ? (
              <>
                Albumene ifølge <TextLink href="https://musicbrainz.org" external>MusicBrainz</TextLink>, eldste først, uten singler, EP-er, livealbum og samlinger. Avspillingene er alle
                brukernes på <TextLink href={page.url} external>Last.fm</TextLink>.
              </>
            ) : (
              <>
                De mest spilte albumene på <TextLink href={page.url} external>Last.fm</TextLink>, etter avspillinger der. Singler, EP-er, livealbum og samlinger er holdt utenfor så godt det lar
                seg gjøre.
              </>
            )}
          </Text>
        </PageSection>
      )}
      {page.plays.length === 0 ? null : (
        <PageSection id="siste" title="Siste avspillinger">
          <PlayRows plays={page.plays} base={base} artistLinks={false} />
        </PageSection>
      )}
    </Split>
  )
}

/**
 * A person from the credits: their picture and what TMDB says of them, the films and shows of the ones seen that they are named in (with the part, or the job), and last the way
 * to them on TMDB. `person` is TMDB's page of them (`null` where it did not answer), `found` what the credits of the titles seen say, which is enough for a page without it.
 */
export function PersonDetail({ id, person, found, base }: { id: number; person: Person | null; found: { name: string; profile: string | null; appearances: Appearance[] }; base: string }) {
  const until = person?.deathday ?? new Date().toISOString().slice(0, 10)
  const age = person?.birthday == null ? null : ageOn(person.birthday, until)
  const rail = (
    <Stack gap="lg">
      <FactList
        facts={[
          ["Født", person?.birthday == null ? null : `${longDay(person.birthday)}${person.deathday == null && age !== null ? ` (${age} år)` : ""}`],
          ["Fødested", person?.place ?? null],
          ["Død", person?.deathday == null ? null : `${longDay(person.deathday)}${age === null ? "" : ` (${age} år)`}`],
        ]}
      />
    </Stack>
  )
  return (
    <Split rail={rail}>
      {person?.biography == null ? null : (
        <PageSection id="om" title="Om personen">
          <Text>{firstSentences(person.biography, 900)}</Text>
          <Text size="sm" tone="muted">Tekst fra TMDB.</Text>
        </PageSection>
      )}
      <PageSection id="sett" title="I det du har sett">
        <PictureRows
          ratio="poster"
          rows={found.appearances.map(({ page, roles }) => ({ key: page.slug, picture: null, sources: sourcesOf(page.poster), title: <TextLink href={titleHref(base, page.slug, page.kind)}>{page.title}</TextLink>, detail: details([roles.join(", ") || null]), aside: page.year === null ? (page.kind === "film" ? "Film" : "Serie") : String(page.year) }))}
        />
      </PageSection>
      <LinkButton href={`https://www.themoviedb.org/person/${id}`} external>Åpne på TMDB</LinkButton>
    </Split>
  )
}

const tagsText = (tags: readonly string[]): string | null => (tags.length === 0 ? null : tags.join(", "))
const listeners = (n: number | null | undefined): string | null => (n == null ? null : n.toLocaleString("nb-NO"))

/** The ways out of a page of music: Last.fm, and Spotify where the search found it. */
function MusicLinks({ lastfm, spotify }: { lastfm: string; spotify: string | null }) {
  return (
    <Stack gap="sm">
      <LinkButton href={lastfm} external>Åpne på Last.fm</LinkButton>
      {spotify === null ? null : <LinkButton href={spotify} external>Åpne i Spotify</LinkButton>}
    </Stack>
  )
}

/**
 * A track: its cover, who made it and from what, how long it is and how often it has been played, its plays here, and last the ways to it on Last.fm and Spotify. The facts and the text are
 * Last.fm's (its text is the users', CC BY-SA, with the link back where it is shown); from Spotify there is only the link to it.
 */
export function TrackDetail({ page, base, info }: { page: TrackPage; base: string; info: { lastfm: TrackInfo | null; spotify: SpotifyTrack | null } }) {
  const { lastfm, spotify } = info
  const rail = (
    <Stack gap="lg">
      <FactList
        facts={[
          ["Artist", <TextLink href={artistHref(base, page.artist)}>{page.artist}</TextLink>],
          ["Album", page.album === null ? null : <TextLink href={albumHref(base, page.artist, page.album)}>{page.album}</TextLink>],
          ["Lengde", lastfm?.seconds == null ? null : lengthText(lastfm.seconds)],
          ["Sjangere", tagsText(lastfm?.tags ?? [])],
          ["Lyttere på Last.fm", listeners(lastfm?.listeners)],
          ["Spilt av deg totalt", lastfm?.userPlays == null ? null : count(lastfm.userPlays, "gang", "ganger")],
          ["Blant de siste avspillingene", count(page.plays.length, "gang", "ganger")],
        ]}
      />
    </Stack>
  )
  return (
    <Split rail={rail}>
      {lastfm?.bio == null ? null : (
        <PageSection id="om" title="Om låten">
          <Text>{lastfm.bio}</Text>
          <Text size="sm" tone="muted">
            Tekst fra <TextLink href={page.url} external>Last.fm</TextLink>, brukernes egen (CC BY-SA).
          </Text>
        </PageSection>
      )}
      <PageSection id="siste" title="Siste avspillinger">
        <PlayRows plays={page.plays} base={base} artistLinks={false} trackLinks={false} />
      </PageSection>
      <MusicLinks lastfm={page.url} spotify={spotify?.url ?? null} />
    </Split>
  )
}

/**
 * An album: its cover, who made it, when it came out and how many tracks it has, the tracks in order (each links to its page where it has been played), the plays from it here, and last the ways
 * to it on Last.fm and Spotify. The day and the number of tracks are Spotify's, so they carry its mark and the link back; the rest is Last.fm's.
 */
export function AlbumDetail({ page, base, info, played }: { page: AlbumPage; base: string; info: { lastfm: AlbumInfo | null; spotify: SpotifyAlbum | null }; /** The slugs of the tracks that have a page. */ played: ReadonlySet<string> }) {
  const { lastfm, spotify } = info
  const released = spotify?.released == null ? null : releaseText(spotify.released)
  const tracks = lastfm?.tracks ?? []
  const rail = (
    <Stack gap="lg">
      <FactList
        facts={[
          ["Artist", <TextLink href={artistHref(base, page.artist)}>{page.artist}</TextLink>],
          ["Utgitt", released],
          ["Spor", spotify?.tracks != null ? String(spotify.tracks) : tracks.length === 0 ? null : String(tracks.length)],
          ["Sjangere", tagsText(lastfm?.tags ?? [])],
          ["Lyttere på Last.fm", listeners(lastfm?.listeners)],
          ["Spilt av deg totalt", lastfm?.userPlays == null ? null : count(lastfm.userPlays, "gang", "ganger")],
          ["Blant de siste avspillingene", count(page.plays.length, "gang", "ganger")],
        ]}
      />
    </Stack>
  )
  return (
    <Split rail={rail}>
      {lastfm?.bio == null ? null : (
        <PageSection id="om" title="Om albumet">
          <Text>{lastfm.bio}</Text>
          <Text size="sm" tone="muted">
            Tekst fra <TextLink href={page.url} external>Last.fm</TextLink>, brukernes egen (CC BY-SA).
          </Text>
        </PageSection>
      )}
      {tracks.length === 0 ? null : (
        <PageSection id="spor" title="Spor">
          <Rows
            lead="rank"
            columns={{ name: "Spor", value: "Lengde" }}
            rows={tracks.map((track, index) => ({
              key: `${index}-${track.title}`,
              body: played.has(trackSlug(page.artist, track.title)) ? <TextLink href={trackHref(base, page.artist, track.title)}>{track.title}</TextLink> : track.title,
              trailing: <Text as="span" size="sm" tone="muted" numeric>{track.seconds === null ? "" : lengthText(track.seconds)}</Text>,
            }))}
          />
        </PageSection>
      )}
      <PageSection id="siste" title="Siste avspillinger">
        <PlayRows plays={page.plays} base={base} artistLinks={false} albumLinks={false} />
      </PageSection>
      <MusicLinks lastfm={page.url} spotify={spotify?.url ?? null} />
    </Split>
  )
}
