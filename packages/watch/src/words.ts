/**
 * What one watch-log app says: its name, the words of each of its pages and the sentences only its own register can
 * hold. The pages themselves (`./pages/*`) are written once and read by both film and TV, so a sentence the two share
 * is a literal there and only what differs is here. The register's own facts of an item are built from these words by
 * the app's server module and travel with the answer (`ItemPage.facts`).
 */

import { formatCount } from '@designsystem/intl/listening'

import type { Tile } from '@designsystem/ui/lib/entity-model'

import type { Fact, PlacePage } from './viewing.ts'

/** «3 filmer», «1 serie»: a count of one app's items, with its own word for one. */
export function countedItems(noun: { one: string; many: string }, count: number): string {
  return `${formatCount(count)} ${count === 1 ? noun.one : noun.many}`
}

/** What the app's front page says that the shared one cannot. */
export interface FrontWords {
  lead: string
  /** The whole page where nothing has been watched yet. */
  empty: string
  /** What one item is called as a count: «Filmer», «Serier». */
  itemsLabel: string
  /** «3 visninger», «12 episoder». */
  viewingsDetail: (viewings: number) => string
  /** «Der spilletiden er kjent», «Der episodelengden er kjent». */
  timeDetail: string
  yearChartValue: string
  pagesLabel: string
  leadTitle: string
  leadEmpty: string
  /** Where it was seen, ranked: «Kinoene du har vært på», «Nettverkene du har sett fra». */
  placesTitle: string
  placesEmpty: string
}

/** What the app's own page of one item, one person and one place says that the shared page cannot. */
export interface EntityWords {
  /** What an item is called on its own page where the register has no year and no original title: «Film», «Serie». */
  itemTitle: string
  /** «Regissert av X.», «Skapt av X.»: the sentence of the item's own people and of a person's own page. */
  lead: (names: string) => string
  /** What a place is called under its name on its own page: its town, or «Kino» / «Nettverk». */
  placeLead: (place: PlacePage) => string
  /** The numbers of a place, for the tiles of its page: how many visits (or episodes), the first and the last day. */
  placeTiles: (place: PlacePage) => readonly Tile[]
  placeFacts: (place: PlacePage) => readonly Fact[]
  placeLinks: (place: PlacePage) => readonly Fact[]
  /** «Filmene du har sett på X.», «Seriene du har sett på X.» */
  placeTitle: (name: string) => string
}

/**
 * The words of one watch-log app. `itemKind` and `placeKind` are its own literals, so the app's `FILM`/`TV` config
 * takes them from here without a second list of them.
 */
export interface WatchWords<ItemKind extends string = string, PlaceKind extends string = string> {
  /** The app's name in every page header: «Film», «TV-serier». */
  title: string
  /** The kinds of one item and one place, as the entity API names them: `film`/`cinema`, `serie`/`network`. */
  itemKind: ItemKind
  placeKind: PlaceKind
  /** What one item is called as a count in a list: `film`/`filmer`. */
  noun: { one: string; many: string }
  front: FrontWords
  entity: EntityWords
}
