import { FactList } from "@lmfaole/designsystem/components/fact-list"
import { LinkButton } from "@lmfaole/designsystem/components/link-button"
import { Stack } from "@lmfaole/designsystem/components/layout"
import { PageSection } from "@lmfaole/designsystem/components/page-section"
import { Picture } from "@lmfaole/designsystem/components/picture"
import { Rows } from "@lmfaole/designsystem/components/rows"
import { Text } from "@lmfaole/designsystem/components/text"

import type { ArtistPage, TitlePage } from "../lib/pages.ts"
import { episodesCode } from "../lib/trakt.ts"
import { shortWhen } from "../lib/when.ts"
import { PlayRows } from "./sections.tsx"

const count = (n: number, one: string, many: string): string => `${n.toLocaleString("nb-NO")} ${n === 1 ? one : many}`

/** A film or a show: its poster, when and how often it was seen, every viewing, and last the way to it on Trakt. */
export function TitleDetail({ page }: { page: TitlePage }) {
  const latest = page.viewings[0]
  const episodes = page.viewings.flatMap((watch) => (watch.episode === null ? [] : [watch.episode]))
  return (
    <Stack gap="xl">
      <Picture src={page.poster} ratio="poster" size="hero" />
      <FactList
        facts={[
          ["Sist sett", latest === undefined ? null : shortWhen(latest.watchedAt)],
          page.kind === "film" ? ["Sett", count(page.viewings.length, "gang", "ganger")] : ["Episoder sett", count(new Set(episodes.map((episode) => `${episode.season}:${episode.number}`)).size, "episode", "episoder")],
        ]}
      />
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
    </Stack>
  )
}

/** An artist: its place among the month's most played, its recent plays, and last the way to it on Last.fm. */
export function ArtistDetail({ page, base }: { page: ArtistPage; base: string }) {
  return (
    <Stack gap="xl">
      <FactList
        facts={[
          ["Mest spilt siste måned", page.top === null ? null : `Nr. ${page.top.rank}, ${count(page.top.plays, "avspilling", "avspillinger")}`],
          ["Blant de siste avspillingene", page.plays.length === 0 ? "Ingen" : count(page.plays.length, "gang", "ganger")],
        ]}
      />
      {page.plays.length === 0 ? null : (
        <PageSection id="siste" title="Siste avspillinger">
          <PlayRows plays={page.plays} base={base} artistLinks={false} />
        </PageSection>
      )}
      <LinkButton href={page.url} external>Åpne på Last.fm</LinkButton>
    </Stack>
  )
}
