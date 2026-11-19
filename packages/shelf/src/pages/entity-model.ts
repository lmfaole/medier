// A work's page as data: what a game, a book or a board game says about itself, in the shape `EntityView` draws.
// No React: the app's extras and this are plain functions of the page's answer.

import { formatCount } from '@designsystem/intl/listening'
import { KIND_LABEL, SERVICES, type EntityModel, type Fact, type Section, type Tile } from '@designsystem/ui/lib/entity-model'

import { bookFacts, facetFacts, toBeatLine } from '../facets.ts'
import type { Reading, WorkPage } from '../shelf.ts'
import type { ShelfWords } from '../words.ts'

/** RomM's page for a ROM; it is behind a login, so the link is for the owner only. */
const ROMM_ROM = 'https://spill.lmfaole.party/rom/'

/** What an app whose works have more to say than the shared page adds to it, as data: tiles, facts after the shared ones, and sections before the log. */
export type WorkExtras<Page extends WorkPage> = (data: Page) => { tiles?: Tile[]; facts?: Fact[]; sections?: Section[] }

const reading = (value: Reading) => `${formatCount(Math.round(value.value))}${value.max === null ? '' : ` av ${formatCount(value.max)}`}`

/** One fact for each number of each service a game has achievements from, as «Pokémon GO: Nivå»: «53». */
export function accountFacts(readings: readonly Reading[]): Fact[] {
  return readings.map((value): Fact => [`${SERVICES[value.service] ?? value.service}: ${value.label}`, reading(value)])
}

/** What the owner's log says in numbers: lines, the total amount (hours, pages, partier), the first and the last day. None for a work that is not in the log. */
function logTiles(page: WorkPage, words: ShelfWords): Tile[] {
  if (page.entries.length === 0) return []
  const days = page.entries.flatMap((entry) => (entry.on === null ? [] : [entry.on])).toSorted()
  const first = days[0]
  const last = days.at(-1)
  const total = page.entries.reduce((sum, entry) => sum + (entry.amount ?? 0), 0)
  return [
    { label: 'Linjer', value: { n: page.entries.length } },
    ...(words.amount === null || total <= 0 ? [] : [{ label: words.amount.label, value: { words: words.amount.format(total) } }]),
    ...(first === undefined || last === undefined ? [] : first === last ? [{ label: 'Dato', value: { day: first } }] : [{ label: 'Første', value: { day: first } }, { label: 'Siste', value: { day: last } }]),
  ]
}

export function toModel<Page extends WorkPage>(page: Page, words: ShelfWords, extras?: WorkExtras<Page>): EntityModel {
  const more = extras?.(page) ?? {}
  const kindLabel = words.itemTitle === KIND_LABEL[words.kind] ? {} : { kindLabel: words.itemTitle }
  return {
    kind: words.kind,
    name: page.title,
    picture: { cover: page.cover, banner: page.banner, shape: words.coverRatio },
    ...kindLabel,
    facts: [
      ['Utgitt', page.year === null ? null : String(page.year)],
      [words.creatorLabel, page.creator],
      ['Sjangre', page.genres.length === 0 ? null : page.genres],
      ...facetFacts(page.facets),
      ['Vanlig spilletid', toBeatLine(page.toBeat)],
      ...bookFacts(page),
      ...accountFacts(page.profile),
      ...(more.facts ?? []),
    ],
    paragraphs: page.summary === null ? [] : [{ text: page.summary }],
    tiles: [...logTiles(page, words), ...(more.tiles ?? [])],
    rating: page.rating === null ? null : { value: page.rating, scale: 5 },
    ownership: page.collection,
    links: [
      { label: words.credit.name, href: page.url },
      { label: 'Spill', href: page.rommId === null ? null : `${ROMM_ROM}${page.rommId}` },
    ],
    ...(page.creator === null ? {} : { mark: { names: page.creator.split(', '), logos: page.logos } }),
    notice: { kind: 'credit', name: words.credit.name, href: words.credit.href },
    sections: [
      ...(more.sections ?? []),
      { id: 'log', title: 'Loggen', kind: 'log', entries: page.entries, noun: { one: 'linje', many: 'linjer' }, amount: words.amount === null ? null : { label: words.amount.label, unit: words.amount.unit } },
      { id: 'achievements', title: 'Achievements', kind: 'achievements', achievements: page.achievements },
    ],
  }
}
