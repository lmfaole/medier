// What IGDB's modes, perspectives and themes are called on the pages: the common ones in Norwegian, the rest as IGDB names
// them. Platforms and series are proper names and stay as they are.

import type { FacetKind, Facets, ToBeat } from './shelf.ts'

const NORWEGIAN: Record<string, string> = {
  'Single player': 'Enspiller',
  Multiplayer: 'Flerspiller',
  'Co-operative': 'Samarbeid',
  'Split screen': 'Delt skjerm',
  'Massively Multiplayer Online (MMO)': 'MMO',
  'Battle Royale': 'Battle royale',
  'First person': 'Førsteperson',
  'Third person': 'Tredjeperson',
  'Bird view / Isometric': 'Fugleperspektiv',
  'Side view': 'Sidevisning',
  Text: 'Tekst',
  Auditory: 'Lyd',
  'Virtual Reality': 'VR',
  Fantasy: 'Fantasi',
  'Science fiction': 'Science fiction',
  Horror: 'Skrekk',
  Survival: 'Overlevelse',
  'Open world': 'Åpen verden',
  Comedy: 'Komedie',
  Historical: 'Historisk',
  Educational: 'Læring',
  Mystery: 'Mysterium',
  Romance: 'Romanse',
  Warfare: 'Krig',
  Kids: 'Barn',
  'Non-fiction': 'Fakta',
}

const LABELS: Record<FacetKind, string> = { platform: 'Plattformer', mode: 'Spillmoduser', theme: 'Temaer', perspective: 'Perspektiv', series: 'Serie' }

/** The name of a mode, perspective or theme as the pages write it. */
export const facetName = (kind: FacetKind, name: string): string => (kind === 'platform' || kind === 'series' ? name : (NORWEGIAN[name] ?? name))

/** The facts a game's page lists, a label and the names, none for a kind the game has nothing of. */
export function facetFacts(facets: Facets): [string, string | null][] {
  return (['platform', 'mode', 'theme', 'perspective', 'series'] as const).map((kind): [string, string | null] => [LABELS[kind], facets[kind].length === 0 ? null : facets[kind].map((name) => facetName(kind, name)).join(', ')])
}

/** Endless games (a battle royale, a sandbox) have times in the hundreds that say nothing about how long they take. */
const LONGEST_KNOWN_HOURS = 300

/** «ca. 70 timer (rask 40, alt 120)», or none where IGDB has no ordinary time or it is one of an endless game. */
export function toBeatLine(toBeat: ToBeat | null): string | null {
  if (toBeat === null || toBeat.normally === null || toBeat.normally > LONGEST_KNOWN_HOURS) return null
  const round = (hours: number) => (hours >= 10 ? String(Math.round(hours)) : hours.toLocaleString('nb-NO'))
  const others = [toBeat.hastily === null ? null : `rask ${round(toBeat.hastily)}`, toBeat.completely === null ? null : `alt ${round(toBeat.completely)}`].filter((part) => part !== null)
  return `ca. ${round(toBeat.normally)} timer${others.length === 0 ? '' : ` (${others.join(', ')})`}`
}

/** The facts a book's page lists beyond the shared ones: its usual page count and its author's country. */
export function bookFacts({ pages, authorCountry }: { pages: number | null; authorCountry: string | null }): [string, string | null][] {
  return [
    ['Sider', pages === null ? null : String(pages)],
    ['Forfatterland', authorCountry],
  ]
}
