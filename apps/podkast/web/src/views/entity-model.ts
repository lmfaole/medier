// A show's or an episode's page as data: what it is from its feed (who makes it, in which language, what it is about, who is
// in it) and what the owner did with it. The description is the publisher's text.

import { formatClock, formatSeconds, languageName } from '@designsystem/intl/listening'
import { pluralize } from '@designsystem/intl/plural'
import { pageHref } from '@designsystem/ui/lib/detail-state'
import type { EntityModel, Section, Tile } from '@designsystem/ui/lib/entity-model'

import type { EntityData } from '@/server/page-data'

type Person = NonNullable<Extract<EntityData, { kind: 'show' }>['about']>['people'][number]

function tilesOf({ totals }: EntityData): Tile[] {
  return [
    { label: 'Avspillinger', value: { n: totals.plays } },
    ...(totals.minutes > 0 ? [{ label: 'Tid', value: { minutes: totals.minutes } }] : []),
    ...(totals.firstAt === null ? [] : [{ label: 'Første', value: { ts: totals.firstAt } }]),
    ...(totals.lastAt === null ? [] : [{ label: 'Sist', value: { ts: totals.lastAt } }]),
  ]
}

const peopleOf = (people: readonly Person[]): Section => ({
  id: 'people',
  title: 'Personer',
  kind: 'rows',
  rows: people.map((person) => ({ name: person.href === null ? person.name : { text: person.name, href: person.href }, ...(person.role === null || person.role === '' ? {} : { detail: person.role }) })),
})

export function toModel(data: EntityData): EntityModel {
  const base = { name: data.name, picture: { cover: data.cover, shape: 'square' as const }, tiles: tilesOf(data) }
  if (data.kind === 'show') {
    const about = data.about
    return {
      kind: 'show',
      ...base,
      paragraphs: about?.description ? [{ text: about.description }] : [],
      facts: about === null ? [] : [['Utgiver', about.owner ?? about.author], ['Land', about.country], ['Språk', about.language === null ? null : languageName(about.language)], ['Sjanger', about.genre]],
      links: about === null ? [] : [{ label: 'Nettside', href: about.website }, { label: 'Apple Podcasts', href: about.appleUrl }, { label: 'RSS', href: about.feedUrl }],
      sections: [
        { id: 'years', title: 'Avspillinger per år', kind: 'chart', series: data.years.map((entry) => ({ label: String(entry.year), value: entry.plays })), valueLabel: 'Avspillinger', ariaLabel: `Avspillinger av ${data.name} per år` },
        {
          id: 'top-episodes',
          title: 'Mest spilte episoder',
          band: 'mine',
          note: `Du hørte ${pluralize(data.totals.episodes, { one: '{count} episode', other: '{count} episoder' }, 'nb-NO')}.`,
          kind: 'rows',
          shape: 'square',
          rows: data.topEpisodes.map((episode) => ({ name: { text: episode.name, href: pageHref({ kind: 'episode', slug: episode.slug }) }, picture: data.cover, count: { times: episode.plays } })),
        },
        peopleOf(about?.people ?? []),
      ],
    }
  }
  const about = data.about
  const season = about?.season == null ? null : `Sesong ${about.season}${about.episode === null ? '' : `, episode ${about.episode}`}`
  return {
    kind: 'episode',
    ...base,
    subtitle: [{ text: data.show.name, href: pageHref({ kind: 'show', slug: data.show.slug }) }],
    paragraphs: about?.description ? [{ text: about.description }] : [],
    facts: about === null ? [] : [['Utgitt', about.publishedAt === null ? null : (formatClock(about.publishedAt).split(',')[0] ?? null)], ['Varighet', about.durationSeconds === null ? null : formatSeconds(about.durationSeconds)], ['Sesong', season]],
    links: about === null ? [] : [{ label: 'Åpne episoden', href: about.link }],
    sections: [
      // One listen is the tiles' first and last day already.
      { id: 'listens', title: 'Avspillinger', band: 'mine', kind: 'text', lines: data.listens.length > 1 ? data.listens.map((at) => ({ at })) : [] },
      peopleOf(about?.people ?? []),
    ],
  }
}
