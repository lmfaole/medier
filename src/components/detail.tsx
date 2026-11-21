import type { ReactNode } from "react"

import { ExternalLink } from "@lmfaole/designsystem/components/external-link"
import { FactList } from "@lmfaole/designsystem/components/fact-list"
import { LinkButton } from "@lmfaole/designsystem/components/link-button"
import { Split, Stack } from "@lmfaole/designsystem/components/layout"
import { PageSection } from "@lmfaole/designsystem/components/page-section"
import { RankedRows } from "@lmfaole/designsystem/components/ranked-rows"
import { details, PictureRows } from "@lmfaole/designsystem/components/picture-rows"
import { Rows } from "@lmfaole/designsystem/components/rows"
import { Text, TextLink } from "@lmfaole/designsystem/components/text"

import type { AlbumInfo, ArtistAlbum, ArtistInfo, TrackInfo } from "../lib/lastfm.ts"
import { firstSentences } from "../lib/lastfm.ts"
import { type AlbumPage, type Appearance, type ArtistPage, artistHref, slugify, albumHref, personHref, titleHref, type TitlePage, type TrackPage, trackSlug, trackHref } from "../lib/pages.ts"
import type { SpotifyAlbum, SpotifyArtist, SpotifyTrack } from "../lib/spotify.ts"
import { albumKey } from "../lib/albums.ts"
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
 * An artist: what Last.fm's users write of it first, then the visitor's own listening to it (their plays over time, their most played songs by it), its albums, its recent plays, the artists like it
 * that they play too, and last the ways to it on Last.fm and Spotify. The picture and the link to it are Spotify's; the tags, the listeners and the text are Last.fm's (its text is the users', CC BY-SA, with
 * the link back where it is shown). `chart` is the chart of the plays over time, an island the page puts in.
 */
export function ArtistDetail({ page, base, info, listening, links, chart }: { page: ArtistPage; base: string; info: { lastfm: ArtistInfo | null; spotify: SpotifyArtist | null; albums: ArtistAlbum[]; albumsFrom: AlbumsFrom }; listening: ArtistListening | null; /** The slugs of the songs and the artists that have a page of their own here. */ links: { tracks: ReadonlySet<string>; artists: ReadonlySet<string> }; chart?: ReactNode }) {
  const { lastfm, spotify, albums, albumsFrom } = info
  // The albums among the recent plays have a page of their own here, under the name of the edition that was played; the others are only named.
  const played = new Map(page.plays.filter((play) => play.album !== "").map((play) => [albumKey(play.album), play.album]))
  const tracks = listening?.tracks ?? []
  const similar = listening?.similar ?? []
  const song = (title: string) => (links.tracks.has(trackSlug(page.name, title)) ? <TextLink href={trackHref(base, page.name, title)}>{title}</TextLink> : title)
  // The plays, the place, the share of all and last month's plays are the head's figures, and when it was first heard is in the chart: each is said once. The pane is what is like it, and the ways out.
  const rail = (
    <Stack gap="xl">
      {similar.length === 0 ? null : (
        <PageSection id="lignende" title="Lignende artister du også hører" icon="person">
          <PictureRows
            {...SHAPES.artist}
            rows={similar.map((one) => ({
              key: one.name,
              picture: null,
              sources: one.spotify?.images ?? [],
              title: links.artists.has(slugify(one.name)) ? <TextLink href={artistHref(base, one.name)}>{one.name}</TextLink> : one.name,
              detail: one.spotify === null ? null : <ExternalLink href={one.spotify.url}>Åpne i Spotify</ExternalLink>,
              aside: count(one.plays, "avspilling", "avspillinger"),
            }))}
          />
          <Text size="sm" tone="muted">
            Artistene <TextLink href={page.url} external>Last.fm</TextLink> finner lignende, blant dem du har hørt mest på.
          </Text>
        </PageSection>
      )}
      <Stack gap="sm">
        <LinkButton href={page.url} external>Åpne på Last.fm</LinkButton>
        {spotify === null ? null : <LinkButton href={spotify.url} external>Åpne i Spotify</LinkButton>}
      </Stack>
    </Stack>
  )
  return (
    <Split rail={rail} position="end">
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
      {tracks.length === 0 ? null : (
        <PageSection id="mest-spilte" title="Dine mest spilte" icon="play">
          <RankedRows rows={tracks.map((track) => ({ key: track.title, title: song(track.title), value: count(track.plays, "avspilling", "avspillinger"), amount: track.plays }))} />
        </PageSection>
      )}
      {albums.length === 0 ? null : (
        <PageSection id="album" title="Album">
          <RankedRows
            {...SHAPES.album}
            rows={albums.map((album) => {
              const edition = played.get(albumKey(album.title))
              return {
                key: album.title,
                sources: sourcesOf(album.image),
                title: edition === undefined ? album.title : <TextLink href={albumHref(base, page.name, edition)}>{album.title}</TextLink>,
                detail: edition === undefined ? null : "Spilt av deg nylig",
                value: `${compactCount(album.plays)} avspillinger`,
                amount: album.plays,
              }
            })}
          />
          <Text size="sm" tone="muted">
            {albumsFrom === "musicbrainz" ? (
              <>
                Albumene ifølge <TextLink href="https://musicbrainz.org" external>MusicBrainz</TextLink>, uten singler, EP-er, livealbum og samlinger, etter avspillinger på{" "}
                <TextLink href={page.url} external>Last.fm</TextLink>.
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
