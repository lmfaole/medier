import { useState, type ReactNode } from 'react'
import { formatCount, formatTimes } from '@designsystem/intl/listening'
import { formatRatingOfFive } from '@designsystem/intl/number'
import { pluralize } from '@designsystem/intl/plural'

import { NOTHING_FOUND, NOTHING_YET } from '../lib/empty-states'
import { DEFAULT_STATUS_LABELS, LIBRARY_STATUSES, newestFirst, type LibraryStatus, type LibraryWork } from '../lib/library'
import { librarySearchQuery, matchesQuery, type LibrarySearch } from '../lib/library-search'
import { PageSection } from '@lmfaole/designsystem/components/page-section'
import { Text } from '@lmfaole/designsystem/components/text'
import { appUrl } from '../lib/base-url'
import { Tiles } from '@lmfaole/designsystem/components/tiles'
import { LibraryControls } from './library-controls'
import { PageHeader } from './page-header'
import { formatLabel } from '../lib/ownership'

/** What the app says about its own library: its nouns, its statuses and kinds. `Kind` is the kinds its works have (`LibraryWork`). */
export interface LibraryWords<Kind extends string = string> {
  noun: { one: string; many: string }
  /** The words for the statuses where the app has better than `DEFAULT_STATUS_LABELS`. */
  statusLabels?: Partial<Record<LibraryStatus, string>>
  /** The words for the kinds of work an app has several of (`artist`, `album`, `song`); omitted for an app with one. */
  kindLabels?: Readonly<Record<Kind, string>>
  /** An app with nothing to own (podcasts) lists everything it has instead of what is owned and wanted. */
  everything?: boolean
}

/** Whether the owner has a work or wants it: what the library is about. */
const inCollection = (work: LibraryWork) => work.owned || work.status === 'owned' || work.status === 'want'

/** The formats a work is owned in, each once (`cd, vinyl` is two). */
const formatsOf = (work: LibraryWork) => (work.format ?? '').split(',').map((name) => name.trim()).filter((name) => name !== '')

/**
 * «Bibliotek»: what the owner has and wants, once each, with the form it is owned in, found by `?q=`, and
 * narrowed by `?status=` (has or wants), `?kind=` and `?format=`. What was seen, heard or played is the
 * log's and the history's, so a work only seen is not here; an app with nothing to own (podcasts) lists what it has of
 * everything. The same page for every app; each says only how to link to one of its works and how its covers are
 * shaped. The filtering is done on the page from the address, so the server and the browser agree and it works without
 * JavaScript.
 */
export function LibraryPage<Kind extends string>({ data, search: asked, words, hrefOf, ratio, children: credit }: { data: { works: LibraryWork<Kind>[] }; search: LibrarySearch; words: LibraryWords<Kind>; /** The address of a work's own page. */ hrefOf: (work: LibraryWork<Kind> & { slug: string }) => string; ratio: (work: LibraryWork<Kind>) => 'poster' | 'square'; children?: ReactNode }) {
  const [search, setSearch] = useState(asked)
  const hasCollection = words.everything !== true
  const works = hasCollection ? data.works.filter(inCollection) : data.works
  if (works.length === 0) {
    return (
      <>
        <PageHeader title="Bibliotek" lead={hasCollection ? 'Jeg eier eller ønsker meg ingenting her ennå.' : NOTHING_YET} />
        {credit}
      </>
    )
  }
  const statusLabel = (status: LibraryStatus) => words.statusLabels?.[status] ?? DEFAULT_STATUS_LABELS[status]
  const shown = works.filter(
    (work) =>
      (search.status === undefined || (hasCollection ? (search.status === 'owned' ? work.owned || work.status === 'owned' : work.status === search.status) : work.status === search.status || (search.status === 'owned' && work.owned))) &&
      (search.kind === undefined || work.kind === search.kind) &&
      (search.format === undefined || formatsOf(work).includes(search.format)) &&
      matchesQuery(`${work.title} ${work.creator ?? ''}`, search.q),
  )
  // What is owned and wanted has no last day to be newest by, so the title orders it; the rest is newest first.
  const ordered = hasCollection ? shown.toSorted((a, b) => a.title.localeCompare(b.title, 'nb')) : shown.toSorted(newestFirst)
  const statuses = hasCollection ? (['owned', 'want'] as const) : LIBRARY_STATUSES
  const present = statuses.filter((status) => works.some((work) => work.status === status || (status === 'owned' && work.owned)))
  const kinds = [...new Set(works.map((work) => work.kind))]
  const owned = works.filter((work) => work.owned || work.status === 'owned').length
  const wanted = works.filter((work) => work.status === 'want' && !work.owned).length
  const formatCounts = new Map<string, number>()
  for (const work of works.filter((candidate) => candidate.owned || candidate.status === 'owned')) for (const name of formatsOf(work)) formatCounts.set(name, (formatCounts.get(name) ?? 0) + 1)
  const formats = [...formatCounts].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'nb'))
  return (
    <>
      <PageHeader
        title="Bibliotek"
        lead={hasCollection ? `Det jeg eier og ønsker meg: ${formatCount(owned)} ${statusLabel('owned').toLocaleLowerCase('nb-NO')}, ${formatCount(wanted)} ${statusLabel('want').toLocaleLowerCase('nb-NO')}.` : `Alt som er registrert: ${formatCount(works.length)} ${pluralize(works.length, { one: words.noun.one, other: words.noun.many }, 'nb-NO')}, hver bare én gang.`}
      />
      <div className="grid items-start gap-6 xl:grid-cols-[16rem_minmax(0,1fr)]">
        <LibraryControls
          search={search}
          onChange={(next) => {
            setSearch(next)
            window.history.replaceState(window.history.state, '', `${window.location.pathname}${librarySearchQuery(next)}`)
          }}
          filters={[
            { name: 'status', label: hasCollection ? 'Eierskap' : 'Status', options: present.map((status) => ({ value: status, label: statusLabel(status) })) },
            { name: 'kind', label: 'Type', options: kinds.map((kind) => ({ value: kind, label: words.kindLabels?.[kind] ?? kind })) },
            { name: 'format', label: 'Format', options: formats.map(([name]) => ({ value: name, label: formatLabel(name) ?? name })) },
          ]}
        />
        <PageSection id="library-works" title={hasCollection ? `Eier og ønsker` : `Alle ${words.noun.many}`}>
          <Text size="sm" tone="muted">{`${formatCount(ordered.length)} vist`}</Text>
          {ordered.length === 0 ? (
            <Text size="sm" tone="muted">{NOTHING_FOUND}</Text>
          ) : (
            <Tiles
              tiles={ordered.map((work) => ({
                key: `${work.kind}/${work.slug ?? work.title}/${work.year ?? ''}`,
                href: work.slug === null || work.slug === undefined ? null : hrefOf({ ...work, slug: work.slug }),
                title: work.year === null || work.year === undefined ? work.title : `${work.title} (${work.year})`,
                picture: work.cover === null || work.cover === undefined || work.cover === '' ? null : appUrl(work.cover),
                ratio: ratio(work),
                detail: work.creator,
                lines: hasCollection
                  ? [work.owned || work.status === 'owned' ? statusLabel('owned') : statusLabel('want'), work.owned || work.status === 'owned' ? formatLabel(work.format ?? null) : null].filter((part) => part !== null)
                  : [statusLabel(work.status), work.owned && work.status !== 'owned' ? statusLabel('owned') : null, work.owned ? formatLabel(work.format ?? null) : null, work.rating === null ? null : formatRatingOfFive(work.rating), work.plays > 0 ? formatTimes(work.plays) : null].filter((part) => part !== null),
              }))}
            />
          )}
        </PageSection>
      </div>
      {credit === undefined ? null : <div className="mt-8">{credit}</div>}
    </>
  )
}
