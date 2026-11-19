/**
 * What BoardGameGeek says about a game besides the facts the three shelf apps share: players, playing time, age, how its
 * users rate and weigh it, its ranks, the people and companies behind it and the games it is tied to. Read from the tables
 * `boardgames-sync bgg` fills (`@designsystem/contracts/boardgame-tables`) and published with the game's page.
 */

import type * as v from 'valibot'

import { queryRows } from '@designsystem/config/d1-query'
import {
  BOARDGAME_DETAILS_SQL, BOARDGAME_LINKS_SQL, BOARDGAME_NAMES_SQL, BOARDGAME_POLLS_SQL, BOARDGAME_RANKS_SQL,
  BoardgameDetailRow, BoardgameLinkRow, BoardgameNameRow, BoardgamePlayerPollRow, BoardgameRankRow,
} from '@designsystem/contracts/boardgame-tables'
import { readOnce } from '@designsystem/config/d1-read-once'

/** A person, company, mechanic or game the register ties to a game, with its page there. */
export interface Tie {
  name: string
  url: string
}

export interface PlayerVotes {
  players: string
  best: number
  recommended: number
  notRecommended: number
}

export interface BoardgameDetails {
  thumbnail: string | null
  players: { min: number | null; max: number | null; best: string | null; recommended: string | null }
  /** Minutes, as the publisher states it. */
  playingTime: { typical: number | null; min: number | null; max: number | null }
  minAge: number | null
  rating: { average: number; bayes: number | null; deviation: number | null; count: number | null } | null
  /** How complex its users find it, 1 to 5. */
  weight: { value: number; count: number | null } | null
  ranks: { label: string; position: number }[]
  community: { owned: number | null; trading: number | null; wanting: number | null; wishing: number | null; comments: number | null }
  votes: PlayerVotes[]
  designers: Tie[]
  artists: Tie[]
  publishers: Tie[]
  mechanics: Tie[]
  families: Tie[]
  expansions: Tie[]
  implementations: Tie[]
  integrations: Tie[]
  compilations: Tie[]
  contains: Tie[]
  otherNames: string[]
}

type Detail = v.InferOutput<typeof BoardgameDetailRow>
type Link = v.InferOutput<typeof BoardgameLinkRow>

/** The register's link types and what the page calls each. */
const KINDS = {
  designers: 'boardgamedesigner',
  artists: 'boardgameartist',
  publishers: 'boardgamepublisher',
  mechanics: 'boardgamemechanic',
  families: 'boardgamefamily',
  expansions: 'boardgameexpansion',
  implementations: 'boardgameimplementation',
  integrations: 'boardgameintegration',
  compilations: 'boardgamecompilation',
  contains: 'boardgamecontains',
} as const

/** Where each kind of tie has its page in the register. */
const PAGES: Record<string, string> = {
  boardgamedesigner: 'boardgamedesigner',
  boardgameartist: 'boardgameartist',
  boardgamepublisher: 'boardgamepublisher',
  boardgamemechanic: 'boardgamemechanic',
  boardgamefamily: 'boardgamefamily',
  boardgameexpansion: 'boardgame',
  boardgameimplementation: 'boardgame',
  boardgameintegration: 'boardgame',
  boardgamecompilation: 'boardgame',
  boardgamecontains: 'boardgame',
}

const tieOf = (link: Link): Tie => ({ name: link.name, url: `https://boardgamegeek.com/${PAGES[link.kind] ?? 'boardgame'}/${link.bgg_id}` })

/** A figure that is none when the register had nothing for it (it writes 0 for unknown, which the sync already turns into none). */
function ratingOf(detail: Detail): BoardgameDetails['rating'] {
  if (detail.rating_average === null) return null
  return { average: detail.rating_average, bayes: detail.rating_bayes, deviation: detail.rating_deviation, count: detail.rating_count }
}

/** One game's details from the rows of its tables. */
export function detailsOf(detail: Detail, links: readonly Link[], names: readonly string[], votes: readonly PlayerVotes[], ranks: readonly { label: string; position: number }[]): BoardgameDetails {
  const tiesOf = (kind: string): Tie[] => links.filter((link) => link.kind === kind).map(tieOf)
  return {
    thumbnail: detail.thumbnail,
    players: { min: detail.min_players, max: detail.max_players, best: detail.best_players, recommended: detail.recommended_players },
    playingTime: { typical: detail.playing_time, min: detail.min_playtime, max: detail.max_playtime },
    minAge: detail.min_age,
    rating: ratingOf(detail),
    weight: detail.weight === null ? null : { value: detail.weight, count: detail.weight_count },
    ranks: [...ranks],
    community: { owned: detail.owned_count, trading: detail.trading_count, wanting: detail.wanting_count, wishing: detail.wishing_count, comments: detail.comment_count },
    votes: [...votes],
    designers: tiesOf(KINDS.designers),
    artists: tiesOf(KINDS.artists),
    publishers: tiesOf(KINDS.publishers),
    mechanics: tiesOf(KINDS.mechanics),
    families: tiesOf(KINDS.families),
    expansions: tiesOf(KINDS.expansions),
    implementations: tiesOf(KINDS.implementations),
    integrations: tiesOf(KINDS.integrations),
    compilations: tiesOf(KINDS.compilations),
    contains: tiesOf(KINDS.contains),
    otherNames: [...names],
  }
}

/** The details of every game that has them, by the register's number; read once per database, as the works are. */
export const detailsFrom = readOnce(async (db: D1Database): Promise<Map<string, BoardgameDetails>> => {
  const [details, links, names, polls, ranks] = await Promise.all([
    queryRows(db, BOARDGAME_DETAILS_SQL, BoardgameDetailRow),
    queryRows(db, BOARDGAME_LINKS_SQL, BoardgameLinkRow),
    queryRows(db, BOARDGAME_NAMES_SQL, BoardgameNameRow),
    queryRows(db, BOARDGAME_POLLS_SQL, BoardgamePlayerPollRow),
    queryRows(db, BOARDGAME_RANKS_SQL, BoardgameRankRow),
  ])
  const ofGame = <Row extends { ext_id: string }>(rows: readonly Row[], id: string) => rows.filter((row) => row.ext_id === id)
  return new Map(details.map((detail) => [detail.ext_id, detailsOf(
    detail,
    ofGame(links, detail.ext_id),
    ofGame(names, detail.ext_id).map((row) => row.name),
    ofGame(polls, detail.ext_id).map((row) => ({ players: row.players, best: row.best, recommended: row.recommended, notRecommended: row.not_recommended })),
    ofGame(ranks, detail.ext_id).map((row) => ({ label: row.label, position: row.position })),
  )]))
})
