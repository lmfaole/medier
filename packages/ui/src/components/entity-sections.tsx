// The sections of an `EntityModel`, one renderer per kind. Each takes closed data and decides how it looks.

import { Fragment, useId, type ReactNode } from "react"

import { formatCount, formatTimestampDay } from "@designsystem/intl/listening"
import { formatNumber } from "@designsystem/intl/number"
import { ColumnChart } from "@lmfaole/designsystem/components/column-chart"
import { Picture } from "@lmfaole/designsystem/components/picture"
import { DataCell } from "@lmfaole/designsystem/components/data-cell"
import { EntityRow, EntityRows } from "@lmfaole/designsystem/components/entity-rows"
import { ExternalLink } from "@lmfaole/designsystem/components/external-link"
import { FactList } from "@lmfaole/designsystem/components/fact-list"
import { FoldList } from "@lmfaole/designsystem/components/fold-list"
import { Tiles } from "@lmfaole/designsystem/components/tiles"
import { Stack } from "@lmfaole/designsystem/components/layout"
import { Lines } from "@lmfaole/designsystem/components/lines"
import { NumberCell, NumberHead } from "@lmfaole/designsystem/components/number-cell"
import { PageSection } from "@lmfaole/designsystem/components/page-section"
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@lmfaole/designsystem/components/table"
import { Rows } from "@lmfaole/designsystem/components/rows"
import { StackedColumnChart } from "@lmfaole/designsystem/components/stacked-column-chart"
import { Heading, Text as Words, TextLink } from "@lmfaole/designsystem/components/text"

import { appUrl } from "../lib/base-url"
import { foldGroups, foldIsOpen, formatAmount, formatNum, isFromExport, isList, isNum, plainOf, rowInfo, SERVICES, mainSections, mapSections, type AchievementData, type Num, type Row, type Section, type Text, type Value } from "../lib/entity-model"
import { factPairs } from "./entity-facts"
import { PhotoGrid } from "./photo-grid"
import { LogChart } from "./log-chart"

/** A chart with no colour of its own is in the first series colour of the theme, never the page's black. */
const SERIES_COLOR = "var(--series-1)"

/** The height of a chart across the whole main column. */
const CHART_HEIGHT = 180

const isExternal = (href: string) => /^https?:\/\//.test(href)

/** A text: a link to its page, a link out, or plain words, in its own language where it says so. */
export function TextView({ value }: { value: Text }) {
  if (typeof value === "string") return value
  const words = value.lang === undefined ? value.text : <span lang={value.lang}>{value.text}</span>
  if (value.href === undefined) return words
  return isExternal(value.href) ? <ExternalLink href={value.href}>{words}</ExternalLink> : <TextLink href={value.href}>{words}</TextLink>
}

/** A value: one text, or several as «a, b, c». */
export function ValueView({ value }: { value: Value }) {
  if (!isList(value)) return <TextView value={value} />
  return (
    <>
      {value.map((part, index) => (
        <Fragment key={index}>
          {index === 0 ? "" : ", "}
          <TextView value={part} />
        </Fragment>
      ))}
    </>
  )
}

const countText = (count: Num | readonly Num[]): string => ("length" in count ? count.map(formatNum).join(", ") : formatNum(count))

const cellOf = (cell: Value | Num | null): ReactNode => (cell === null ? null : isNum(cell) ? formatNum(cell) : <ValueView value={cell} />)

type Of<Kind extends Section["kind"]> = Extract<Section, { kind: Kind }>

/** A row's detail, then «sett» and «denne» where the row says so, so nothing rests on a colour alone. */
function RowDetail({ row }: { row: Row }) {
  const said = [row.seen === true ? "sett" : null, row.current === true ? "denne" : null].filter((word) => word !== null).join(", ")
  return (
    <>
      {row.detail === undefined ? null : <TextView value={row.detail} />}
      {row.detail !== undefined && said !== "" ? ", " : ""}
      {said}
    </>
  )
}

/** A list of rows. The pictures column is there only where every row has a picture: a grey box in front of some of the names says nothing. */
function RowList({ rows, shape, caption }: { rows: readonly Row[]; shape: "poster" | "square"; caption: string }) {
  const pictures = rows.every((row) => row.picture !== undefined && row.picture !== null && row.picture !== "")
  return (
    <EntityRows caption={caption}>
      {rows.map((row, index) => (
        <EntityRow
          key={`${plainOf(row.name)}/${index}`}
          picture={pictures ? <Picture src={row.picture === undefined || row.picture === null || row.picture === "" ? null : appUrl(row.picture)} ratio={shape} /> : undefined}
          name={<TextView value={row.name} />}
          label={plainOf(row.name)}
          detail={row.detail === undefined && row.seen !== true && row.current !== true ? undefined : <RowDetail row={row} />}
          count={row.count === undefined ? "" : countText(row.count)}
          muted={row.muted === true}
          info={rowInfo(row).length === 0 ? undefined : <FactList facts={factPairs(rowInfo(row))} />}
        />
      ))}
    </EntityRows>
  )
}

function RowsSection({ section }: { section: Of<"rows"> }) {
  return (
    <PageSection id={section.id} title={section.title}>
      {section.note === undefined ? null : <Words size="sm" tone="muted">{section.note}</Words>}
      <RowList rows={section.rows} shape={section.shape ?? "square"} caption={section.title} />
    </PageSection>
  )
}

/** A chart is a section like the others: its title is the h2, its note a line under it, and the chart takes the whole width of the column. */
function ChartSection({ section }: { section: Of<"chart"> }) {
  return (
    <PageSection id={section.id} title={section.title}>
      {section.note === undefined ? null : <Words size="sm" tone="muted">{section.note}</Words>}
      {section.stacked === undefined ? (
        <ColumnChart data={[...section.series]} ariaLabel={section.ariaLabel ?? `${section.valueLabel}: ${section.title}`} valueLabel={section.valueLabel} height={section.height ?? CHART_HEIGHT} color={section.color ?? SERIES_COLOR} {...(section.labelEvery === undefined ? {} : { labelEvery: section.labelEvery })} />
      ) : (
        <StackedColumnChart data={[...section.stacked.data]} series={[...section.stacked.series]} colors={section.stacked.colors ?? []} ariaLabel={section.ariaLabel ?? `${section.valueLabel}: ${section.title}`} height={section.height ?? CHART_HEIGHT} />
      )}
    </PageSection>
  )
}

function LogSection({ section }: { section: Of<"log"> }) {
  const amount = section.amount ?? null
  return <LogChart title={section.title} entries={section.entries} noun={section.noun} amount={amount === null ? null : { label: amount.label, format: (value) => formatAmount(amount.unit, value) }} />
}

function TableSection({ section }: { section: Of<"table"> }) {
  const end = (column: number) => section.align?.[column] === "end"
  return (
    <PageSection id={section.id} title={section.title}>
      <Table>
        {section.head === undefined ? null : (
          <TableHeader>
            <TableRow>
              {section.head.map((label, column) => (end(column) ? <NumberHead key={label}>{label}</NumberHead> : <TableHead key={label}>{label}</TableHead>))}
            </TableRow>
          </TableHeader>
        )}
        <TableBody>
          {section.rows.map((row, index) => (
            <TableRow key={index}>
              {row.map((cell, column) => (end(column) ? <NumberCell key={column}>{cellOf(cell)}</NumberCell> : <DataCell key={column} tone={column === 0 ? "default" : "muted"}>{cellOf(cell)}</DataCell>))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </PageSection>
  )
}

function FactListSection({ section }: { section: Of<"factlist"> }) {
  return (
    <PageSection id={section.id} title={section.title}>
      {section.lead === undefined ? null : <Words size="sm" tone="muted"><TextView value={section.lead} /></Words>}
      <FactList facts={factPairs(section.facts)} />
    </PageSection>
  )
}

function TextSection({ section }: { section: Of<"text"> }) {
  return (
    <PageSection id={section.id} title={section.title}>
      <Words as="div" size="sm" tone="muted">
        <ul className="grid gap-1">
          {section.lines.map((line, index) => (
            <li key={index}>{isNum(line) ? formatNum(line) : <TextView value={line} />}</li>
          ))}
        </ul>
      </Words>
    </PageSection>
  )
}

const TIER_NAMES = ["bronse", "sølv", "gull", "platina"] as const
const TIER_MARKS = ["B", "S", "G", "P"] as const

const tierName = (achievement: AchievementData) => (achievement.tier === null ? null : (TIER_NAMES[achievement.tier - 1] ?? null))
const fraction = (achievement: AchievementData) => (achievement.progress === null || achievement.target === null || achievement.target <= 0 ? null : Math.min(1, achievement.progress / achievement.target))

/** What the next step asks, with the tier it leads to: «Neste nivå (platina) ved ca. 10 000, nå 4 198». */
function nextStep(achievement: AchievementData): string | null {
  if (achievement.target === null) return null
  const next = achievement.tier === null ? null : (TIER_NAMES[achievement.tier] ?? null)
  const asked = `${next === null ? "Mål" : `Neste nivå (${next})`} ved ${achievement.tier === null ? "" : "ca. "}${formatCount(achievement.target)}`
  return achievement.progress === null ? asked : `${asked}, nå ${formatCount(Math.round(achievement.progress))}`
}

/** One achievement as a tile: its picture and name, and what it asks, when and how rare in a popover from the tile, so an open one never moves the gallery. */
function AchievementTile({ achievement }: { achievement: AchievementData }) {
  const id = useId()
  const locked = achievement.unlockedAt === null
  const facts = [
    SERVICES[achievement.service] ?? achievement.service,
    locked ? "Låst" : achievement.unlockedAt === 0 ? "Dato ukjent" : formatTimestampDay(achievement.unlockedAt ?? 0),
    tierName(achievement) === null ? null : `${tierName(achievement)} (${achievement.tier} av ${achievement.tiers})`,
    achievement.points === null ? null : `${formatCount(achievement.points)} poeng`,
    achievement.rarity === null ? null : `${formatNumber(achievement.rarity / 100, "nb-NO", { style: "percent", maximumFractionDigits: 1 })} har den`,
  ]
  // An achievement with no picture has none: a dashed box in its place says nothing.
  const picture = achievement.icon === null ? null : <img src={appUrl(achievement.icon)} alt="" loading="lazy" className="aspect-square w-full rounded-md object-cover" />
  return (
    <li>
      <button type="button" popoverTarget={id} className="grid w-full cursor-pointer content-start gap-1 text-left text-xs">
        {picture}
        <span className={locked ? "line-clamp-2 text-muted-foreground" : "line-clamp-2 font-medium"}>
          {achievement.title}
          {achievement.tier === null ? null : <span className="ml-1 text-muted-foreground">{TIER_MARKS[achievement.tier - 1] ?? ""}</span>}
          {locked && picture === null ? <span className="ml-1 text-muted-foreground">(låst)</span> : null}
        </span>
        {fraction(achievement) === null ? null : <progress value={fraction(achievement) ?? 0} max={1} aria-hidden="true" className="h-1 w-full" />}
      </button>
      <div id={id} popover="auto" className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-popover p-4 text-sm text-popover-foreground backdrop:bg-black/30">
        <div className={picture === null ? "" : "grid grid-cols-[4rem_1fr] items-center gap-3"}>
          {picture === null ? null : <div className="w-16">{picture}</div>}
          <p className="font-medium">{achievement.title}</p>
        </div>
        <p className="mt-3 grid gap-1 text-muted-foreground">
          {achievement.description === null ? null : <span>{achievement.description}</span>}
          <Lines items={facts} />
          {nextStep(achievement) === null ? null : <span className="text-xs">{nextStep(achievement)}</span>}
          {fraction(achievement) === null ? null : <progress value={fraction(achievement) ?? 0} max={1} aria-label="Framgang mot neste nivå" className="h-1.5 w-full" />}
        </p>
      </div>
    </li>
  )
}

/** A game's achievements as a gallery, with the count in a sentence over it. */
function AchievementsSection({ section }: { section: Of<"achievements"> }) {
  const { achievements } = section
  const unlocked = achievements.filter((achievement) => achievement.unlockedAt !== null).length
  const partial = achievements.some(isFromExport)
  const gamerscore = achievements.filter((achievement) => achievement.service === "xbox")
  const earned = gamerscore.reduce((sum, achievement) => sum + (achievement.unlockedAt === null ? 0 : (achievement.points ?? 0)), 0)
  const possible = gamerscore.reduce((sum, achievement) => sum + (achievement.points ?? 0), 0)
  const scoreText = earned === 0 ? "" : `, ${formatCount(earned)}${partial ? "" : ` av ${formatCount(possible)}`} gamerscore`
  const sentence = partial ? `${formatCount(unlocked)} achievements låst opp${scoreText}` : `${formatCount(unlocked)} av ${formatCount(achievements.length)} achievements${scoreText}`
  return (
    <PageSection id={section.id} title={section.title}>
      <Words size="sm" tone="muted">{`${sentence}.`}</Words>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] items-start gap-3">
        {achievements.map((achievement, index) => (
          <AchievementTile key={`${achievement.service}/${index}`} achievement={achievement} />
        ))}
      </ul>
    </PageSection>
  )
}

function GallerySection({ section }: { section: Of<"gallery"> }) {
  // Tiles with a picture missing would be grey boxes: the things are then a list of names instead.
  const pictured = section.items.every((item) => item.cover !== null && item.cover !== "")
  return (
    <PageSection id={section.id} title={section.title}>
      {pictured ? (
        <Tiles tiles={section.items.map((item, index) => ({ key: `${item.name}/${index}`, href: item.href, title: item.name, picture: item.cover === null || item.cover === undefined ? null : appUrl(item.cover), ratio: item.ratio, detail: item.subtitle ?? null }))} />
      ) : (
        <RowList rows={section.items.map((item): Row => ({ name: item.href === null ? item.name : { text: item.name, href: item.href }, ...(item.subtitle == null || item.subtitle === "" ? {} : { detail: item.subtitle }) }))} shape="square" caption={section.title} />
      )}
    </PageSection>
  )
}

function PhotosSection({ section }: { section: Of<"photos"> }) {
  return (
    <PageSection id={section.id} title={section.title}>
      <PhotoGrid photos={section.photos} href={section.href} />
    </PageSection>
  )
}

/** The map of a place: its picture, the link to the whole map and the credit its licence asks for. It stands in the rail, so it has no heading of its own. */
function MapSection({ section }: { section: Of<"map"> }) {
  return (
    <Stack as="section" gap="sm" aria-label={section.title}>
      <Picture src={appUrl(section.src)} ratio="square" size="fill" />
      <Words size="sm" tone="muted">
        <TextView value={section.link} />
        {" · Kart © "}
        <TextView value={section.credit} />
      </Words>
    </Stack>
  )
}

/** Lines in groups: folded under a summary each, or open under a heading when there are few groups. */
function FoldSection({ section }: { section: Of<"fold"> }) {
  const groups = foldGroups(section)
  const open = foldIsOpen({ groups, ...(section.openBelow === undefined ? {} : { openBelow: section.openBelow }) })
  return (
    <PageSection id={section.id} title={section.title}>
      <Stack gap="lg">
        {groups.map((group) =>
          open ? (
            <Stack key={group.summary} gap="md">
              {groups.length === 1 ? null : <Heading level={3} look="item">{group.heading ?? group.summary}</Heading>}
              <Rows rows={group.items.map((item, index) => ({ key: `${index}`, body: item, trailing: `${index + 1}` }))} columns={{ name: section.head?.[0] ?? "Navn", value: section.head?.[1] ?? "Nummer" }} />
            </Stack>
          ) : (
            <FoldList key={group.summary} summary={group.summary} items={group.items.map((item, index) => ({ key: `${index}`, text: `${index + 1}. ${item}` }))} />
          ),
        )}
        {section.source === undefined || section.source.length === 0 ? null : (
          <Words size="sm" tone="muted">
            {"Fra "}
            {section.source.map((part, index) => (
              <Fragment key={index}>
                {index === 0 ? null : ", "}
                <TextView value={part} />
              </Fragment>
            ))}
          </Words>
        )}
      </Stack>
    </PageSection>
  )
}

function SectionView({ section }: { section: Section }) {
  switch (section.kind) {
    case "rows":
      return <RowsSection section={section} />
    case "chart":
      return <ChartSection section={section} />
    case "log":
      return <LogSection section={section} />
    case "table":
      return <TableSection section={section} />
    case "factlist":
      return <FactListSection section={section} />
    case "text":
      return <TextSection section={section} />
    case "achievements":
      return <AchievementsSection section={section} />
    case "gallery":
      return <GallerySection section={section} />
    case "photos":
      return <PhotosSection section={section} />
    case "map":
      return <MapSection section={section} />
    case "fold":
      return <FoldSection section={section} />
  }
}

/** The maps of the page, for the rail. */
export function Maps({ sections }: { sections: readonly Section[] }) {
  return (
    <>
      {mapSections(sections).map((section) => (
        <SectionView key={section.id} section={section} />
      ))}
    </>
  )
}

/** The main column: the sections that have something to show, one under the other, the owner's own first (`mainSections`), each the width of the column. */
export function Sections({ sections }: { sections: readonly Section[] }) {
  // One reading direction: down. Every section stands under the one before it, in the order it matters (the design system's rule 7).
  return (
    <Stack gap="xl">
      {mainSections(sections).map((section) => (
        <SectionView key={section.id} section={section} />
      ))}
    </Stack>
  )
}
