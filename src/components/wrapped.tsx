import { EmptyState } from "@lmfaole/designsystem/components/empty-state"
import { ExternalLink } from "@lmfaole/designsystem/components/external-link"
import { FactList } from "@lmfaole/designsystem/components/fact-list"
import { FilterChips } from "@lmfaole/designsystem/components/filter-chips"
import { Stack } from "@lmfaole/designsystem/components/layout"
import { PageSection } from "@lmfaole/designsystem/components/page-section"
import { details, PictureRows } from "@lmfaole/designsystem/components/picture-rows"
import { Rows } from "@lmfaole/designsystem/components/rows"
import { Sparkline } from "@lmfaole/designsystem/components/sparkline"
import { Text, TextLink } from "@lmfaole/designsystem/components/text"

import { sourcesOf } from "../lib/image-sources.ts"
import { shortWhen } from "../lib/when.ts"
import { albumHref, albumSlug, artistHref, titleHref, trackHref, trackSlug } from "../lib/pages.ts"
import { SHAPES } from "../lib/shapes.ts"
import type { SpotifyArtist } from "../lib/spotify.ts"
import type { PeriodData } from "../lib/week-source.ts"
import { WEEKDAY_NAMES } from "../lib/weeks.ts"
import { changeText, hourText, longLength, playsChange, signed, type TopArtist, type WatchStats, type WeekStats } from "../lib/wrapped.ts"
import { FromSpotify } from "./credits.tsx"

/** What has a page of its own to link to: the slugs of the artists, albums and songs among the recent plays, and the address of each title among the films and shows seen. */
export interface Linkable {
  artists: ReadonlySet<string>
  albums: ReadonlySet<string>
  tracks: ReadonlySet<string>
  titles: ReadonlyMap<string, string>
}

const number = (n: number): string => n.toLocaleString("nb-NO")
/** A count with its noun: «1 avspilling», «12 avspillinger». */
const count = (n: number, one: string, many: string): string => `${number(n)} ${n === 1 ? one : many}`
const capital = (word: string): string => word.slice(0, 1).toUpperCase() + word.slice(1)

/** The numbers of the week: how much, how long (an estimate, and how much of it is known), and when. */
function Numbers({ stats, previousTotal, previous, truncated }: { stats: WeekStats; previousTotal: number | null; /** What the change is from: «uken før», «måneden før». */ previous: string; truncated: boolean }) {
  const change = playsChange(stats.total, previousTotal)
  const { listening } = stats
  return (
    <PageSection id="tall" title="Tall" icon="chart">
      <Stack gap="md">
        <FactList
          facts={[
            ["Avspillinger", `${number(stats.total)}${change === null ? "" : ` (${signed(change)} fra ${previous})`}`],
            ["Ulike artister", number(stats.artists)],
            ["Ulike låter", number(stats.tracks)],
            ["Lyttetid, anslag", stats.total === 0 ? null : `≈ ${longLength(listening.seconds)}`],
            ["Lengde kjent for", stats.total === 0 ? null : `${number(listening.knownPlays)} av ${count(stats.total, "avspilling", "avspillinger")}`],
            ["Travleste dag", stats.busiestDay === null ? null : `${capital(WEEKDAY_NAMES[stats.busiestDay.day] ?? "")} (${number(stats.busiestDay.plays)})`],
            ["Travleste time", stats.busiestHour === null ? null : `${hourText(stats.busiestHour.hour)} (${number(stats.busiestHour.plays)})`],
            ["Per dag, mandag til søndag", stats.total === 0 ? null : <Sparkline values={stats.byDay} label={`Avspillinger per dag, mandag til søndag: ${stats.byDay.join(", ")}`} />],
          ]}
        />
        {truncated ? <Text size="sm" tone="muted">Ikke alle avspillingene ble lest, så tallene kan være litt for lave.</Text> : null}
      </Stack>
    </PageSection>
  )
}

/** The top artists, each with its picture (Spotify's, by name), how many plays, and how its place moved since the week before. */
function ArtistRows({ artists, pictures, links, base }: { artists: readonly TopArtist[]; pictures: ReadonlyMap<string, SpotifyArtist>; links: Linkable; base: string }) {
  const list = (
    <PictureRows
      {...SHAPES.artist}
      rows={artists.map((artist) => {
        const found = pictures.get(artist.name)
        return {
          key: artist.name,
          picture: null,
          sources: found?.images ?? [],
          title: links.artists.has(artist.name) ? <TextLink href={artistHref(base, artist.name)}>{artist.name}</TextLink> : artist.name,
          detail: details([count(artist.plays, "avspilling", "avspillinger"), artist.change === null ? null : changeText(artist.change), found === undefined ? null : <ExternalLink href={found.url}>Åpne i Spotify</ExternalLink>]),
          aside: `Nr. ${artist.rank}`,
        }
      })}
    />
  )
  return pictures.size === 0 ? list : <Stack gap="md">{list}<FromSpotify /></Stack>
}

/** The top lists: artists, albums and songs, each in the shape of what it is. */
function Tops({ stats, pictures, links, base }: { stats: WeekStats; pictures: ReadonlyMap<string, SpotifyArtist>; links: Linkable; base: string }) {
  if (stats.total === 0) return null
  return (
    <>
      <PageSection id="toppartister" title="Toppartister" icon="person">
        <ArtistRows artists={stats.topArtists} pictures={pictures} links={links} base={base} />
      </PageSection>
      {stats.topAlbums.length === 0 ? null : (
        <PageSection id="toppalbum" title="Toppalbum" icon="music">
          <PictureRows
            {...SHAPES.album}
            rows={stats.topAlbums.map((album, index) => ({
              key: `${album.artist}-${album.title}`,
              picture: null,
              sources: sourcesOf(album.image),
              title: links.albums.has(albumSlug(album.artist, album.title)) ? <TextLink href={albumHref(base, album.artist, album.title)}>{album.title}</TextLink> : album.title,
              detail: details([album.artist, count(album.plays, "avspilling", "avspillinger")]),
              aside: `Nr. ${index + 1}`,
            }))}
          />
        </PageSection>
      )}
      <PageSection id="topplater" title="Topplåter" icon="play">
        <PictureRows
          {...SHAPES.track}
          rows={stats.topTracks.map((track, index) => ({
            key: `${track.artist}-${track.title}`,
            picture: null,
            sources: sourcesOf(track.image),
            title: links.tracks.has(trackSlug(track.artist, track.title)) ? <TextLink href={trackHref(base, track.artist, track.title)}>{track.title}</TextLink> : track.title,
            detail: details([track.artist, count(track.plays, "avspilling", "avspillinger")]),
            aside: `Nr. ${index + 1}`,
          }))}
        />
      </PageSection>
    </>
  )
}

/** The artists among the most played that were played for the first time this week; none, when there were none. */
function NewArtists({ names, links, base }: { names: readonly { name: string; plays: number }[] | null; links: Linkable; base: string }) {
  if (names === null) return null
  return (
    <PageSection id="nye" title="Nye artister" icon="new">
      {names.length === 0 ? (
        <EmptyState title="Ingen nye blant de mest spilte" description="Alle hadde jeg spilt før." />
      ) : (
        <Rows
          columns={{ name: "Artist", value: "Avspillinger" }}
          rows={names.map((artist) => ({
            key: artist.name,
            body: links.artists.has(artist.name) ? <TextLink href={artistHref(base, artist.name)}>{artist.name}</TextLink> : artist.name,
            trailing: <Text as="span" size="sm" tone="muted" numeric>{number(artist.plays)}</Text>,
          }))}
        />
      )}
    </PageSection>
  )
}

/** What was watched: the counts, the shows most watched, and the runs that were a binge. */
function Watched({ stats, links, base }: { stats: WatchStats; links: Linkable; base: string }) {
  const nothing = stats.films === 0 && stats.episodes === 0
  const title = (name: string) => {
    const slug = links.titles.get(name)
    return slug === undefined ? name : <TextLink href={titleHref(base, slug)}>{name}</TextLink>
  }
  return (
    <PageSection id="film-og-tv" title="Film og TV" icon="film">
      {nothing ? (
        <EmptyState title="Ingenting sett i perioden" />
      ) : (
        <Stack gap="lg">
          <FactList facts={[["Filmer", number(stats.films)], ["Episoder", number(stats.episodes)]]} />
          {stats.filmItems.length === 0 ? null : (
            <Stack gap="sm">
              <Text size="sm" tone="muted">Filmer</Text>
              <PictureRows
                {...SHAPES.film}
                rows={stats.filmItems.map((film) => ({ key: `${film.title}-${film.watchedAt}`, picture: null, sources: sourcesOf(film.poster), title: title(film.title), detail: details([film.year]), aside: shortWhen(film.watchedAt) }))}
              />
            </Stack>
          )}
          {stats.shows.length === 0 ? null : (
            <Stack gap="sm">
              <Text size="sm" tone="muted">Serier</Text>
            <PictureRows
              {...SHAPES.film}
              rows={stats.shows.map((show, index) => ({ key: show.title, picture: null, sources: sourcesOf(show.poster), title: title(show.title), detail: details([count(show.episodes, "episode", "episoder")]), aside: `Nr. ${index + 1}` }))}
            />
            </Stack>
          )}
          {stats.binges.length === 0 ? null : (
            <Stack gap="sm">
              <Text size="sm" tone="muted">Tre episoder eller flere av samme serie på én dag</Text>
              <Rows
                columns={{ name: "Serie", value: "Episoder" }}
                rows={stats.binges.map((binge) => ({ key: binge.key, body: title(binge.title), trailing: <Text as="span" size="sm" tone="muted" numeric>{number(binge.episodes.length)}</Text> }))}
              />
            </Stack>
          )}
        </Stack>
      )}
    </PageSection>
  )
}

/** The weeks or the months to go to: this one so far, and the ones before it, newest first. `rows` have their name, the days they cover and where they are. */
export function OtherPeriods({ id, title, name, rows, current }: { id: string; title: string; /** What the first column is called: «Uke», «Måned». */ name: string; rows: readonly { key: string; label: string; range: string; href: string }[]; current: string }) {
  return (
    <PageSection id={id} title={title} icon="calendar">
      <Rows
        columns={{ name, value: "Dager" }}
        rows={rows
          .filter((one) => one.key !== current)
          .map((one) => ({ key: one.key, body: <TextLink href={one.href}>{one.label}</TextLink>, trailing: <Text as="span" size="sm" tone="muted">{one.range}</Text> }))}
      />
    </PageSection>
  )
}

/** The way between the wrapped of a week and of a month: two links, the one you are on marked. */
export function PeriodChips({ current, weekHref, monthHref }: { current: "week" | "month"; weekHref: string; monthHref: string }) {
  return (
    <FilterChips
      label="Periode"
      chips={[
        { key: "week", label: "Uke", href: weekHref, current: current === "week" },
        { key: "month", label: "Måned", href: monthHref, current: current === "month" },
      ]}
    />
  )
}

/** A week's or a month's wrapped: the numbers, the top lists, who is new, and what was watched. A source that gave nothing leaves out only its own part. `previous` is what the change is from. */
export function PeriodView({ data, pictures, links, base, previous }: { data: PeriodData; pictures: ReadonlyMap<string, SpotifyArtist>; links: Linkable; base: string; previous: string }) {
  const { music, watched } = data
  return (
    <>
      {music === null ? null : music.stats.total === 0 ? (
        <PageSection id="tall" title="Tall" icon="chart">
          <EmptyState icon="music" title="Ingen avspillinger i perioden" />
        </PageSection>
      ) : (
        <>
          <Numbers stats={music.stats} previousTotal={music.previousTotal} previous={previous} truncated={music.truncated} />
          <Tops stats={music.stats} pictures={pictures} links={links} base={base} />
          <NewArtists names={music.newArtists} links={links} base={base} />
        </>
      )}
      {watched === null ? null : <Watched stats={watched.stats} links={links} base={base} />}
    </>
  )
}

