// The page of one item, one person or one place as data: what the register and the log say, in the shape `EntityView` draws.
// No React: the page's answer, the app's words and its addresses are all there is, so a node test can read the result.

import { formatDay } from '@designsystem/intl/listening'
import { formatRatingOfFive } from '@designsystem/intl/number'
import { pluralize } from '@designsystem/intl/plural'
import { titleWithYear } from '@designsystem/intl/text'
import type { EntityModel, Fact, Row, Section, Text, Tile } from '@designsystem/ui/lib/entity-model'
import { ownershipRating } from '@designsystem/ui/lib/ownership'

import { companyLabel, crewLabel, departmentName, seatParts } from '../format.ts'
import type { FranchiseShelf, ItemLink, ItemPage, Listing, PersonPage, PlacePage, RelatedWork, Seen } from '../viewing.ts'
import type { WatchWords } from '../words.ts'

type EntityData = ItemPage | PersonPage | PlacePage

/** The page of an item, a person and a place by slug: the app's addresses, so the model needs no router. */
export interface Hrefs {
  item: (slug: string) => string
  person: (slug: string) => string
  place: (slug: string) => string
}

/** The app's «Regissert» / «Skapt»: the first word of its lead sentence («Regissert av X.»), as the title of the section of the people it names. */
const leadTitle = (words: WatchWords): string => words.entity.lead('').split(' ')[0] ?? ''

const capital = (word: string): string => word.charAt(0).toLocaleUpperCase('nb-NO') + word.slice(1)

const people = (list: readonly ItemLink[], href: Hrefs): Text[] => list.map((person) => ({ text: person.name, href: href.person(person.slug) }))

/** A list of works as rows: the poster, the title with its page, the year, and how it went (the rating, how often it was seen). */
function listingRows(items: readonly Listing[], href: Hrefs): Row[] {
  return items.map((item) => ({
    name: { text: item.title, href: href.item(item.slug) },
    picture: item.cover,
    ...(item.year === null ? {} : { detail: String(item.year) }),
    count: [...(item.rating === null ? [] : [{ words: formatRatingOfFive(item.rating) }]), ...(item.rating === null || item.plays > 1 ? [{ times: item.plays }] : [])],
  }))
}

const worksSection = (id: string, title: string, items: readonly Listing[], href: Hrefs, note?: string): Section => ({ id, title, ...(note === undefined ? {} : { note }), kind: 'rows', shape: 'poster', rows: listingRows(items, href) })

function franchiseSection(franchise: FranchiseShelf, href: Hrefs): Section {
  return {
    id: 'franchise',
    title: 'Franchise',
    note: `Del av ${franchise.name}: ${franchise.seen} av ${franchise.total} sett.`,
    kind: 'rows',
    shape: 'poster',
    rows: franchise.parts.map((part) => ({
      name: part.slug === null || part.current ? titleWithYear(part.title, part.year) : { text: titleWithYear(part.title, part.year), href: href.item(part.slug) },
      picture: part.cover,
      seen: part.seen,
      current: part.current,
    })),
  }
}

const relatedSection = (related: readonly RelatedWork[], href: Hrefs): Section => ({
  id: 'related',
  title: 'TMDB anbefaler',
  kind: 'rows',
  shape: 'poster',
  rows: related.map((work) => ({ name: work.slug === null ? titleWithYear(work.title, work.year) : { text: titleWithYear(work.title, work.year), href: href.item(work.slug) }, seen: work.seen })),
})

const placeText = (seen: Seen, href: Hrefs): Text | null => (seen.place === null ? null : { text: seen.place.name, href: href.place(seen.place.slug) })

/** The facts of the register that are numbers of the page (the running time, the seasons): they are tiles, not rows of the about. */
const TILE_FACTS = ['Spilletid', 'Sesonger', 'Episoder']

/** What the log says in numbers: how often, first and last (or the one day), where, and the register's own lengths. */
function itemTiles(data: ItemPage, places: readonly { name: string; slug: string }[], href: Hrefs): Tile[] {
  const days = data.seen.flatMap((seen) => (seen.on === null ? [] : [seen.on])).toSorted()
  const first = days[0]
  const last = days.at(-1)
  const register = data.facts.flatMap(([label, value]): Tile[] => (TILE_FACTS.includes(label) && value !== null && value !== '' ? [{ label, value: { words: value } }] : []))
  return [
    ...(data.seen.length === 0 ? [] : [{ label: 'Visninger', value: { n: data.seen.length } }]),
    ...(first === undefined || last === undefined ? [] : first === last || days.length === 1 ? [{ label: 'Sett', value: { day: first } }] : [{ label: 'Første', value: { day: first } }, { label: 'Sist', value: { day: last } }]),
    ...(places.length === 0 ? [] : [{ label: 'Sett på', value: { words: places.map((place) => place.name).join(', ') }, ...(places.length === 1 && places[0] !== undefined ? { href: href.place(places[0].slug) } : {}) }]),
    ...register,
  ]
}

/** How a cinema visit went: where, and with how many tickets (one per seat), which says whether anyone came along. */
function howSeen(seen: Seen, index: number, several: boolean, href: Hrefs): Section {
  const parts = seen.seat === null ? null : seatParts(seen.seat)
  const facts: Fact[] =
    parts === null
      ? [['Kino', placeText(seen, href)], ['Plass', seen.seat]]
      : [['Kino', placeText(seen, href)], ['Sal', parts.hall], ['Rad', parts.row], [pluralize(parts.tickets, { one: 'Sete', other: 'Seter' }, 'nb-NO'), parts.seats], ['Billetter', String(parts.tickets)], ['Følge', companyLabel(parts.tickets)]]
  const day = seen.on === null ? null : formatDay(seen.on)
  return { id: `how-seen-${index}`, title: several && day !== null ? `Slik så du den ${day}` : 'Slik så du den', band: 'mine', kind: 'factlist', ...(!several && day !== null ? { lead: day } : {}), facts }
}

function itemModel(data: ItemPage, words: WatchWords, href: Hrefs): EntityModel {
  const rated = data.seen.find((seen) => seen.rating !== null)
  const rating = rated?.rating ?? ownershipRating(data.ownership)
  const places = [...new Map(data.seen.flatMap((seen) => (seen.place === null ? [] : [[seen.place.slug, seen.place] as const]))).values()]
  const seated = data.seen.filter((seen) => seen.seat !== null)
  const kind = words.itemKind === 'film' ? 'film' : 'tv'
  return {
    kind,
    name: data.title,
    picture: { cover: data.cover, banner: data.backdrop },
    ...(words.entity.itemTitle === (kind === 'film' ? 'Film' : 'Serie') ? {} : { kindLabel: words.entity.itemTitle }),
    subtitle: [data.year === null ? null : String(data.year), data.originalTitle].filter((line) => line !== null),
    facts: data.facts.filter(([label]) => !TILE_FACTS.includes(label)),
    tiles: itemTiles(data, places, href),
    paragraphs: [
      ...(data.tagline === null ? [] : [{ text: data.tagline, style: 'italic' as const }]),
      ...(data.overview === null ? [] : [{ text: data.overview }]),
      ...(data.keywords.length === 0 ? [] : [{ text: data.keywords.join(', '), lang: 'en' }]),
    ],
    rating: rating === null ? null : { value: rating, scale: 5 },
    ownership: data.ownership,
    links: data.links.map(([label, target]) => ({ label, href: target })),
    notice: { kind: 'tmdb' },
    sections: [
      { id: 'lead', title: leadTitle(words), kind: 'text', lines: people(data.lead, href) },
      { id: 'cast', title: 'På rollelisten', kind: 'rows', rows: data.cast.map((person) => ({ name: { text: person.name, href: href.person(person.slug) }, ...(person.character === null || person.character === '' ? {} : { detail: person.character }) })) },
      { id: 'crew', title: 'Bak kamera', kind: 'factlist', facts: data.crew.map((group): Fact => [crewLabel(group.job), people(group.people, href)]) },
      {
        id: 'log',
        title: 'Når du så den',
        kind: 'log',
        entries: data.seen.map((seen) => ({ on: seen.on, amount: null })),
        noun: { one: 'visning', many: 'visninger' },
      },
      ...seated.map((seen, index) => howSeen(seen, index, seated.length > 1, href)),
      ...(data.franchise === null ? [] : [franchiseSection(data.franchise, href)]),
      relatedSection(data.related, href),
    ],
  }
}

function personModel(data: PersonPage, words: WatchWords, href: Hrefs): EntityModel {
  const seen = new Set([...data.lead, ...data.acted, ...data.crewed.flatMap((group) => group.works)].map((item) => item.key)).size
  return {
    kind: 'person',
    name: data.name,
    ...(data.department === null ? {} : { subtitle: [departmentName(data.department)] }),
    facts: [
      ['Født', data.born === null ? null : [formatDay(data.born), data.placeOfBirth].filter(Boolean).join(', ')],
      ['Død', data.died === null ? null : formatDay(data.died)],
    ],
    paragraphs: data.biography === null ? [] : [{ text: data.biography, ...(data.biographyLanguage === null ? {} : { lang: data.biographyLanguage }) }],
    links: [
      { label: 'IMDb', href: data.imdbId === null ? null : `https://www.imdb.com/name/${data.imdbId}/` },
      { label: 'TMDB', href: `https://www.themoviedb.org/person/${data.tmdbId}` },
    ],
    notice: { kind: 'tmdb' },
    tiles: [{ label: `${capital(words.noun.many)} sett`, value: { n: seen } }],
    sections: [
      worksSection('lead', leadTitle(words), data.lead, href),
      worksSection('acted', 'På rollelisten', data.acted, href),
      ...data.crewed.map((group, index) => worksSection(`crewed-${index}`, crewLabel(group.job), group.works, href)),
    ],
  }
}

function placeModel(data: PlacePage, words: WatchWords, href: Hrefs): EntityModel {
  const { entity } = words
  return {
    kind: 'place',
    name: data.name,
    picture: { banner: data.image },
    subtitle: [entity.placeLead(data)],
    facts: entity.placeFacts(data),
    tiles: [...entity.placeTiles(data), ...(data.works.length === 0 ? [] : [{ label: capital(words.noun.many), value: { n: data.works.length } }])],
    links: entity.placeLinks(data).map(([label, target]) => ({ label, href: target })),
    notice: { kind: 'tmdb' },
    sections:
      data.halls.length === 0
        ? [worksSection('seen-here', 'Sett her', data.works, href)]
        : data.halls.map((hall, index) => worksSection(`hall-${index}`, hall.name ?? 'Sal ikke oppgitt', hall.works, href, `${hall.visits} besøk`)),
  }
}

/** The model of the answer of `entityRequest(slug, kind)`; the answer says which of the three it is. */
export function toModel(data: EntityData, words: WatchWords, href: Hrefs): EntityModel {
  switch (data.kind) {
    case 'place':
      return placeModel(data, words, href)
    case 'person':
      return personModel(data, words, href)
    case 'item':
      return itemModel(data, words, href)
  }
}
