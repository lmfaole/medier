// What BoardGameGeek says about a game, added to the shared work page as data: tiles, facts and sections.

import { formatNumber, formatRating } from '@designsystem/intl/number'
import type { Fact, Section, Text, Tile } from '@designsystem/ui/lib/entity-model'
import type { WorkExtras } from '@designsystem/shelf/entity-model'

import { dashed } from './ranges.ts'
import type { ApiResponses } from './server/api.ts'
import type { BoardgameDetails, Tie } from './server/details.ts'

type BoardgamePage = NonNullable<ApiResponses['entity']>

const decimal = (value: number) => formatNumber(value, 'nb-NO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const count = (value: number | null | undefined) => (value === null || value === undefined ? null : formatNumber(value, 'nb-NO'))
const ofTies = (ties: readonly Tie[]): Text[] => ties.map((tie) => ({ text: tie.name, href: tie.url }))

/** A range with its unit, or none where the register has neither end. */
function rangeTile(label: string, min: number | null, max: number | null, unit: string, note?: string): Tile[] {
  const low = min ?? max
  return low === null ? [] : [{ label, value: { range: [low, max ?? min], unit }, ...(note === undefined ? {} : { note }) }]
}

/** The tiles under the head: players, playing time, age and weight. */
function tilesOf(details: BoardgameDetails): Tile[] {
  const { players, playingTime } = details
  return [
    ...rangeTile('Spillere', players.min, players.max, 'spillere', players.best == null ? undefined : `best med ${dashed(players.best)}`),
    ...rangeTile('Spilletid', playingTime.min ?? playingTime.typical, playingTime.max ?? playingTime.typical, 'min'),
    ...(details.minAge == null ? [] : [{ label: 'Alder', value: { words: `${details.minAge}+` } }]),
    ...(details.weight == null ? [] : [{ label: 'Kompleksitet', value: { words: `${formatRating(details.weight.value)} av 5` } }]),
  ]
}

function registerOf({ community, rating, weight, ranks }: BoardgameDetails): Section {
  return {
    id: 'register',
    title: 'BoardGameGeek',
    kind: 'factlist',
    facts: [
      ['Vurdering', rating === null ? null : `${decimal(rating.average)} av 10`],
      ['Antall vurderinger', count(rating?.count)],
      ['Justert snitt', rating?.bayes == null ? null : decimal(rating.bayes)],
      ['Standardavvik', rating?.deviation == null ? null : decimal(rating.deviation)],
      ['Kompleksitet', weight === null ? null : `${formatNumber(weight.value, 'nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} av 5`],
      ['Antall stemmer på kompleksitet', count(weight?.count)],
      ...ranks.map((rank): Fact => [rank.label, `nr. ${count(rank.position)}`]),
      ['Eies av', count(community.owned)],
      ['Til salgs eller bytte', count(community.trading)],
      ['Ønsker å kjøpe', count(community.wanting)],
      ['På ønskelisten', count(community.wishing)],
      ['Kommentarer', count(community.comments)],
    ],
  }
}

const votesOf = (votes: BoardgameDetails['votes']): Section => ({
  id: 'votes',
  title: 'Antall spillere',
  kind: 'table',
  head: ['Spillere', 'Best', 'Anbefalt', 'Ikke anbefalt'],
  align: ['start', 'end', 'end', 'end'],
  rows: votes.map((vote) => [vote.players, { n: vote.best }, { n: vote.recommended }, { n: vote.notRecommended }]),
})

function tiesOf(details: BoardgameDetails): Section {
  const ties: [string, readonly Tie[]][] = [
    ['Designere', details.designers],
    ['Illustratører', details.artists],
    ['Utgivere', details.publishers],
    ['Mekanikker', details.mechanics],
    ['Familier', details.families],
    ['Utvidelser', details.expansions],
    ['Utgaver', details.implementations],
    ['Kan brukes sammen med', details.integrations],
    ['Samlet i', details.compilations],
    ['Inneholder', details.contains],
  ]
  return { id: 'ties', title: 'Tilknyttet', kind: 'factlist', facts: [...ties.map(([label, list]): Fact => [label, list.length === 0 ? null : ofTies(list)]), ['Andre navn', details.otherNames.length === 0 ? null : details.otherNames]] }
}

export const boardgameExtras: WorkExtras<BoardgamePage> = ({ details }) => ({
  tiles: details === null ? [] : tilesOf(details),
  facts: [['Anbefalt antall', dashed(details?.players.recommended ?? null)]],
  sections: details === null ? [] : [registerOf(details), votesOf(details.votes), tiesOf(details)],
})
