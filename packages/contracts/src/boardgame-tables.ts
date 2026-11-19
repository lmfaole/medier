/**
 * The tables of `db/boardgames.sql` that only board games have: what BoardGameGeek says about a game besides the facts
 * all three shelf apps keep (`shelf-tables.ts`). The boardgames app reads them for a game's own page.
 */

import * as v from "valibot"

/** One row of `boardgame_detail`: players, playing time, age and how the register's users rate and weigh a game. */
export const BoardgameDetailRow = v.object({
  ext_id: v.string(),
  thumbnail: v.nullable(v.string()),
  min_players: v.nullable(v.number()),
  max_players: v.nullable(v.number()),
  playing_time: v.nullable(v.number()),
  min_playtime: v.nullable(v.number()),
  max_playtime: v.nullable(v.number()),
  min_age: v.nullable(v.number()),
  best_players: v.nullable(v.string()),
  recommended_players: v.nullable(v.string()),
  rating_average: v.nullable(v.number()),
  rating_bayes: v.nullable(v.number()),
  rating_deviation: v.nullable(v.number()),
  rating_count: v.nullable(v.number()),
  weight: v.nullable(v.number()),
  weight_count: v.nullable(v.number()),
  owned_count: v.nullable(v.number()),
  trading_count: v.nullable(v.number()),
  wanting_count: v.nullable(v.number()),
  wishing_count: v.nullable(v.number()),
  comment_count: v.nullable(v.number()),
})

/** One row of `boardgame_link`: a designer, artist, publisher, mechanic, family or related game, by the register's own link type. */
export const BoardgameLinkRow = v.object({
  ext_id: v.string(),
  kind: v.string(),
  bgg_id: v.string(),
  name: v.string(),
})

/** One row of `boardgame_name`: another name the game goes by. */
export const BoardgameNameRow = v.object({
  ext_id: v.string(),
  name: v.string(),
})

/** One row of `boardgame_player_poll`: the votes for one player count. */
export const BoardgamePlayerPollRow = v.object({
  ext_id: v.string(),
  players: v.string(),
  best: v.number(),
  recommended: v.number(),
  not_recommended: v.number(),
})

/** One row of `boardgame_rank`: the game's place in one of the register's lists. */
export const BoardgameRankRow = v.object({
  ext_id: v.string(),
  name: v.string(),
  label: v.string(),
  position: v.number(),
  bayes: v.nullable(v.number()),
})

export const BOARDGAME_DETAILS_SQL = `SELECT * FROM boardgame_detail ORDER BY ext_id`
export const BOARDGAME_LINKS_SQL = `SELECT * FROM boardgame_link ORDER BY ext_id, kind, name`
export const BOARDGAME_NAMES_SQL = `SELECT * FROM boardgame_name ORDER BY ext_id, name`
export const BOARDGAME_POLLS_SQL = `SELECT * FROM boardgame_player_poll ORDER BY ext_id, CAST(players AS INTEGER), players`
export const BOARDGAME_RANKS_SQL = `SELECT * FROM boardgame_rank ORDER BY ext_id, position`
