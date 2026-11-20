import { FactList } from "@lmfaole/designsystem/components/fact-list"
import { LinkButton } from "@lmfaole/designsystem/components/link-button"
import { Split, Stack } from "@lmfaole/designsystem/components/layout"
import { PageSection } from "@lmfaole/designsystem/components/page-section"
import { Picture } from "@lmfaole/designsystem/components/picture"
import { Rows } from "@lmfaole/designsystem/components/rows"
import { Text, TextLink } from "@lmfaole/designsystem/components/text"

import type { ArtistInfo } from "../lib/lastfm.ts"
import type { ArtistPage, TitlePage } from "../lib/pages.ts"
import type { SpotifyArtist } from "../lib/spotify.ts"
import { sourcesOf } from "../lib/image-sources.ts"
import { episodesCode } from "../lib/trakt.ts"
import { shortWhen } from "../lib/when.ts"
import { FromSpotify } from "./credits.tsx"
import { PlayRows } from "./sections.tsx"

const count = (n: number, one: string, many: string): string => `${n.toLocaleString("nb-NO")} ${n === 1 ? one : many}`

/** A film's length as «2 t 50 min»; under an hour just the minutes. */
export const runtimeText = (minutes: number): string => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} t${minutes % 60 === 0 ? "" : ` ${minutes % 60} min`}`)

/** A film or a show: its poster, when and how often it was seen, every viewing, and last the way to it on Trakt. */
export function TitleDetail({ page }: { page: TitlePage }) {
  const latest = page.viewings[0]
  const episodes = page.viewings.flatMap((watch) => (watch.episode === null ? [] : [watch.episode]))
  const facts = (
    <Stack gap="lg">
      {/* The picture that leads the page: fetched first, at the width it is drawn. */}
      <Picture src={null} sources={sourcesOf(page.poster)} priority ratio="poster" size="hero" />
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
      <PageSection id="sett" title={page.kind === "film" ? "Når jeg så den" : "Episodene jeg har sett"}>
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
 * An artist: its picture and what is known of it, its place among the month's most played, its recent plays, and last the ways to it on Last.fm and Spotify. The picture and the
 * link to it are Spotify's; the tags, the listeners and the text are Last.fm's (its text is the users', CC BY-SA, with the link back where it is shown).
 */
export function ArtistDetail({ page, base, info }: { page: ArtistPage; base: string; info: { lastfm: ArtistInfo | null; spotify: SpotifyArtist | null } }) {
  const { lastfm, spotify } = info
  const genres = lastfm !== null && lastfm.tags.length > 0 ? lastfm.tags : (spotify?.genres ?? [])
  const rail = (
    <Stack gap="lg">
      {spotify === null || spotify.images.length === 0 ? null : (
        <Stack gap="sm">
          <Picture src={null} sources={spotify.images} priority ratio="square" size="hero" />
          <FromSpotify />
        </Stack>
      )}
      <FactList
        facts={[
          ["Sjangere", genres.length === 0 ? null : genres.join(", ")],
          ["Lyttere på Last.fm", lastfm?.listeners == null ? null : lastfm.listeners.toLocaleString("nb-NO")],
          ["Mest spilt siste måned", page.top === null ? null : `Nr. ${page.top.rank}, ${count(page.top.plays, "avspilling", "avspillinger")}`],
          ["Blant de siste avspillingene", page.plays.length === 0 ? "Ingen" : count(page.plays.length, "gang", "ganger")],
        ]}
      />
    </Stack>
  )
  return (
    <Split rail={rail}>
      {lastfm?.bio == null ? null : (
        <PageSection id="om" title="Om artisten">
          <Text>{lastfm.bio}</Text>
          <Text size="sm" tone="muted">
            Tekst fra <TextLink href={page.url} external>Last.fm</TextLink>, brukernes egen (CC BY-SA).
          </Text>
        </PageSection>
      )}
      {page.plays.length === 0 ? null : (
        <PageSection id="siste" title="Siste avspillinger">
          <PlayRows plays={page.plays} base={base} artistLinks={false} />
        </PageSection>
      )}
      <Stack gap="sm">
        <LinkButton href={page.url} external>Åpne på Last.fm</LinkButton>
        {spotify === null ? null : <LinkButton href={spotify.url} external>Åpne i Spotify</LinkButton>}
      </Stack>
    </Split>
  )
}
