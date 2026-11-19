// The own page of one thing, drawn from an `EntityModel` (`lib/entity-model.ts`). The model is data; this decides the hero,
// the rail, the order of the sections and every format. Astro: `client:visible` where a section holds a chart.
//
// ONE anatomy for every kind (film, tv, person, place, book, game, boardgame, show, episode, artist, album, song, collection, concert):
//   1. HEAD      the hero, with the name as the page's one h1.
//   2. NUMBERS   the model's tiles in one row under the head (never in the rail), and «Eier» last where the owner has it.
//   3. BODY      on a wide screen two columns (`Split`): a fixed-width sticky RAIL on the left and ONE MAIN COLUMN on the right; on a
//                narrow screen the rail comes first. The rail is the about (kind label, subtitle, text, rating, facts, links, the
//                maker's mark), a map and the credit; it never holds a section. A page with nothing for a rail has the
//                main column across the whole width, and a page with no sections has the about across it.
//   4. MAIN      the sections one under the other, each the width of the column, each an h2 in the same look with the same gap:
//                the owner's own first (`band: "mine"`: the log, charts, how it was seen), then what the thing holds
//                (`band: "about"`: people, tracks, franchise, related, gallery). Nothing sits side by side except two consecutive
//                short facts or text sections of one band (`mainBlocks`: equal columns); inside a section the content flows into
//                columns instead (`LIST_COLUMNS`). Levels: h1 name, h2 section, a small label for a fact.

import { Logos } from "@lmfaole/designsystem/components/logos"
import { ExternalLink } from "@lmfaole/designsystem/components/external-link"
import { Split, Stack } from "@lmfaole/designsystem/components/layout"

import { formatNum, hasRail, heroOf, mainSections, kickerOf, starsOf, tilesOf, visibleFacts, type EntityModel, type Tile } from "../lib/entity-model"
import { aboutOf } from "./entity-about"
import { appUrl } from "../lib/base-url"
import { EntityCoverHero } from "./entity-cover-hero"
import { EntityAbout, EntityHero, Stat, StatTiles } from "./entity-hero"
import { factPairs } from "./entity-facts"
import { Maps, Sections, TextView } from "./entity-sections"

function Tiles({ tiles }: { tiles: readonly Tile[] }) {
  if (tiles.length === 0) return null
  return (
    <StatTiles>
      {tiles.map((tile) => (
        <Stat key={tile.label} label={tile.label} value={"n" in tile.value ? tile.value.n : formatNum(tile.value)} note={tile.note} href={tile.href} />
      ))}
    </StatTiles>
  )
}

function Notice({ notice }: { notice: NonNullable<EntityModel["notice"]> }) {
  if (notice.kind === "tmdb") {
    return (
      <p className="text-xs text-muted-foreground">
        Plakater, beskrivelser og folk fra <ExternalLink href="https://www.themoviedb.org">TMDB</ExternalLink>. Siden bruker TMDBs API, men er ikke godkjent eller sertifisert av TMDB.
      </p>
    )
  }
  return (
    <p className="text-sm text-muted-foreground">
      Fakta og omslag fra <ExternalLink href={notice.href}>{notice.name}</ExternalLink>. Siden er ikke godkjent av {notice.name}.
    </p>
  )
}

/** The logos of the makers that have one, under the app's base. */
function logosOf(mark: { names: readonly string[]; logos: Readonly<Record<string, string>> }): { name: string; src: string }[] {
  return mark.names.flatMap((name) => {
    const logo = mark.logos[name]
    return logo === undefined ? [] : [{ name, src: appUrl(logo) }]
  })
}

export function EntityView({ model }: { model: EntityModel }) {
  const hero = heroOf(model)
  const shown = mainSections(model.sections)
  const facts = visibleFacts(model.facts)
  // A cover beside the name has room for the facts; under a wide picture or a name they belong with the rest in the about box.
  const factsInHero = hero.variant === "cover"
  const stars = model.rating === null || model.rating === undefined ? null : starsOf(model.rating)
  const rail = hasRail(model) && shown.length > 0
  const subtitle = model.subtitle === undefined || model.subtitle.length === 0 ? undefined : (
    <>
      {model.subtitle.map((line, index) => (
        <span key={index} className="block">
          <TextView value={line} />
        </span>
      ))}
    </>
  )
  const about = (
    <EntityAbout
      inRail={rail}
      name={model.name}
      kicker={kickerOf(model)}
      subtitle={subtitle}
      info={aboutOf({
        paragraphs: (model.paragraphs ?? []).map((paragraph, index) => (
          <span key={index} lang={paragraph.lang} className={paragraph.style === "italic" ? "italic" : undefined}>
            {paragraph.text}
          </span>
        )),
        facts: factsInHero ? [] : factPairs(facts),
      })}
      rating={stars?.stars ?? null}
      {...(stars === null ? {} : { ratingLabel: stars.label })}
      links={(model.links ?? []).map((link) => [link.label, link.href] as const)}
      mark={model.mark === undefined ? null : <Logos logos={logosOf(model.mark)} />}
    />
  )
  const head =
    hero.variant === "cover" ? (
      <EntityCoverHero name={model.name} cover={hero.cover} backdrop={hero.banner} ratio={hero.shape} facts={factPairs(facts)} />
    ) : hero.variant === "banner" ? (
      <EntityHero name={model.name} banner={hero.picture} />
    ) : (
      <EntityHero name={model.name} />
    )
  const notice = model.notice === undefined ? null : <Notice notice={model.notice} />
  const tiles = <Tiles tiles={tilesOf(model)} />
  // No rail where it would be empty (the main column then has the whole width), and no main column where there are no sections.
  if (!rail) {
    return (
      <Stack>
        {head}
        {tiles}
        {shown.length > 0 ? <Sections sections={model.sections} /> : null}
        {hasRail(model) ? (
          <>
            <Maps sections={model.sections} />
            <div>{about}</div>
          </>
        ) : null}
        {notice}
      </Stack>
    )
  }
  return (
    <Stack>
      {head}
      {tiles}
      <Split
        rail={
          <>
            <Maps sections={model.sections} />
            {about}
            {notice}
          </>
        }
      >
        <Sections sections={model.sections} />
      </Split>
    </Stack>
  )
}
