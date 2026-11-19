/**
 * The tables of `db/games.sql`, `db/books.sql` and `db/boardgames.sql` that the three shelf apps (games, books, board
 * games) read. The three keep the same tables under their own prefix (`game_`, `book_`, `boardgame_`), so one set of
 * row schemas is checked against all three, and the one query that reads a line with the work the register matched.
 */

import * as v from "valibot"

/** What a log line says on its own: the same in its table and in the line a page reads. */
const lineHead = {
  id: v.number(),
  on_date: v.nullable(v.string()),
  title: v.string(),
  year: v.nullable(v.number()),
  status: v.string(),
  rating: v.nullable(v.number()),
  amount: v.nullable(v.number()),
}

/** One row of `<prefix>_entry`: a line of the log, as the log has it. `on_date` is `YYYY-MM-DD`, or none when the day is not known. */
export const ShelfEntryRow = v.object({
  ...lineHead,
  note: v.nullable(v.string()),
  ext_id: v.nullable(v.string()),
  source: v.nullable(v.string()),
  /** What the owner has when the line says owned: `cd`, `digital`, a platform. */
  format: v.nullable(v.string()),
  /** The moment in Unix seconds where the source knew it; `on_date` is then its day. */
  at: v.nullable(v.number()),
})

/** One row of `<prefix>_match`: what the register answered for a title and year. */
export const ShelfMatchRow = v.object({
  title: v.string(),
  year: v.number(),
  ext_id: v.nullable(v.string()),
  candidates: v.nullable(v.string()),
  tried_at: v.number(),
})

/** One row of `<prefix>_item`: a work, as the register has it. */
export const ShelfItemRow = v.object({
  ext_id: v.string(),
  title: v.string(),
  creator: v.nullable(v.string()),
  year: v.nullable(v.number()),
  summary: v.nullable(v.string()),
  cover: v.nullable(v.string()),
  url: v.nullable(v.string()),
  fetched_at: v.number(),
  banner: v.nullable(v.string()),
})

/** One row of `<prefix>_genre`. */
export const ShelfGenreRow = v.object({
  ext_id: v.string(),
  genre: v.string(),
})

/**
 * A line of the log and the work the register matched to it: the log's own number first, else the register's answer for
 * its title and year. The owner's `note` and the service's `source` number stay in the database: they are not for a page.
 */
export const ShelfLine = v.object({
  ...lineHead,
  format: v.nullable(v.string()),
  ext_id: v.nullable(v.string()),
  item_id: v.nullable(v.string()),
  item_title: v.nullable(v.string()),
  creator: v.nullable(v.string()),
  item_year: v.nullable(v.number()),
  summary: v.nullable(v.string()),
  cover: v.nullable(v.string()),
  banner: v.nullable(v.string()),
  url: v.nullable(v.string()),
})

/** The three prefixes a shelf app's tables are named with. */
export type ShelfPrefix = "game" | "book" | "boardgame"

/** The columns a line of the log and a line of the collection are read with, from either table (`entry` or `collection`) and the work the register matched. */
function linesSql(prefix: ShelfPrefix, table: "entry" | "collection"): string {
  // A RetroAchievements line has no register number of its own; the ROM that names the same RA game has the register's.
  const rommItem = prefix === "game" && table === "entry" ? "(SELECT MIN(romm.igdb_id) FROM game_romm AS romm WHERE entry.source = 'ra:' || romm.ra_id), " : ""
  return `SELECT entry.id, entry.on_date, entry.title, entry.year, entry.status, entry.rating, entry.amount, entry.format, entry.ext_id,
  item.ext_id AS item_id, item.title AS item_title, item.creator, item.year AS item_year, item.summary, item.cover, item.banner, item.url
FROM ${prefix}_${table} AS entry
LEFT JOIN ${prefix}_match AS match ON match.title = entry.title AND match.year = COALESCE(entry.year, 0)
LEFT JOIN ${prefix}_item AS item ON item.ext_id = COALESCE(entry.ext_id, ${rommItem}match.ext_id)
ORDER BY entry.id`
}

/** The lines of one app's log, each with its matched work (none where there is no match yet), oldest id first. */
export function shelfLinesSql(prefix: ShelfPrefix): string {
  return linesSql(prefix, "entry")
}

/** The lines of one app's collection (what the owner has or wants), in the shape of the log's, each with its matched work. A work here needs no line in the log. */
export function shelfHoldingsSql(prefix: ShelfPrefix): string {
  return linesSql(prefix, "collection")
}

/** The genres of every work of one app. */
export function shelfGenresSql(prefix: ShelfPrefix): string {
  return `SELECT ext_id, genre FROM ${prefix}_genre ORDER BY ext_id, genre`
}

/** What an achievement is, in the table and as a page reads it. */
const ACHIEVEMENT_FIELDS = {
  title: v.string(),
  description: v.nullable(v.string()),
  icon: v.nullable(v.string()),
  points: v.nullable(v.number()),
  rarity: v.nullable(v.number()),
  unlocked_at: v.nullable(v.number()),
  progress: v.nullable(v.number()),
  target: v.nullable(v.number()),
  tier: v.nullable(v.number()),
  tiers: v.nullable(v.number()),
}

/** One row of `game_achievement` (games only): an achievement of a game, locked while `unlocked_at` is none. */
export const GameAchievementRow = v.object({
  source: v.string(),
  game: v.string(),
  id: v.string(),
  ...ACHIEVEMENT_FIELDS,
})

/** An achievement and the log line of its game, as a page reads it: the service's numbers stay in the database, and the picture's address goes only to the script that lands it. */
export const GameAchievementLine = v.object({
  /** The log line of the game, or none for a game only a ROM names (`item_id`). */
  entry_id: v.nullable(v.number()),
  /** The register's number of the work, for a game a ROM names that the log has no line for. */
  item_id: v.nullable(v.string()),
  service: v.string(),
  ...ACHIEVEMENT_FIELDS,
})

/**
 * The achievements of every log line that has a game number from Steam, RetroAchievements or Xbox (`source` is
 * `<service>:<game>`), and the RetroAchievements lists of games a ROM of RomM names that the log has no line for
 * (`game_romm.ra_id` and the register's number `igdb_id`): a game owned but not yet played has its list, all locked.
 */
export const GAME_ACHIEVEMENTS_SQL = `SELECT * FROM (
SELECT entry.id AS entry_id, NULL AS item_id, achievement.source AS service, achievement.title, achievement.description, achievement.icon,
  achievement.points, achievement.rarity, achievement.unlocked_at, achievement.progress, achievement.target, achievement.tier, achievement.tiers
FROM game_achievement AS achievement
JOIN game_entry AS entry ON entry.source = achievement.source || ':' || achievement.game
UNION ALL
SELECT NULL AS entry_id, rom.igdb_id AS item_id, achievement.source AS service, achievement.title, achievement.description, achievement.icon,
  achievement.points, achievement.rarity, achievement.unlocked_at, achievement.progress, achievement.target, achievement.tier, achievement.tiers
FROM game_achievement AS achievement
JOIN (SELECT ra_id, MIN(igdb_id) AS igdb_id FROM game_romm WHERE ra_id IS NOT NULL AND igdb_id IS NOT NULL GROUP BY ra_id) AS rom
  ON achievement.source = 'ra' AND achievement.game = rom.ra_id
WHERE NOT EXISTS (SELECT 1 FROM game_entry AS entry WHERE entry.source = 'ra:' || achievement.game)
)
ORDER BY entry_id, item_id, unlocked_at IS NULL, unlocked_at DESC, title`

/** Where the player stands at a service (games only): the newest reading of each number, and the earlier ones oldest first for the line of how it grew. */
export const GameProfileRow = v.object({
  source: v.string(),
  key: v.string(),
  day: v.string(),
  label: v.string(),
  value: v.number(),
  max: v.nullable(v.number()),
})

export const GAME_PROFILE_SQL = `SELECT source, key, day, label, value, max FROM game_profile ORDER BY source, key, day`

/** One developer's logo (games only): the register's address of it. Only a name with a logo is read. */
export const GameCompanyRow = v.object({
  name: v.string(),
  logo: v.string(),
})

export const GAME_COMPANIES_SQL = `SELECT name, logo FROM game_company WHERE logo IS NOT NULL ORDER BY name`

/** What Open Library and Wikidata say of a book beyond its register row (books only): the usual page count, the languages (ISO 639-2 codes, comma-separated) and the country of its first author. */
export const BookFactRow = v.object({
  ext_id: v.string(),
  pages: v.nullable(v.number()),
  languages: v.nullable(v.string()),
  author_country: v.nullable(v.string()),
})

export const BOOK_FACTS_SQL = `SELECT ext_id, pages, languages, author_country FROM book_fact`

/** One platform, mode, theme, perspective or series of a game (games only), as IGDB names it. */
export const GameFacetRow = v.object({
  ext_id: v.string(),
  kind: v.picklist(["platform", "mode", "theme", "perspective", "series"]),
  name: v.string(),
})

export const GAME_FACETS_SQL = `SELECT ext_id, kind, name FROM game_facet ORDER BY ext_id, kind, name`

/** How long a game takes by IGDB's players, in hours, quickly through it, at an ordinary pace and everything (games only). */
export const GameTimeRow = v.object({
  ext_id: v.string(),
  hastily_hours: v.nullable(v.number()),
  normally_hours: v.nullable(v.number()),
  completely_hours: v.nullable(v.number()),
})

export const GAME_TIMES_SQL = `SELECT ext_id, hastily_hours, normally_hours, completely_hours FROM game_time_to_beat`

/** A work's ROM in RomM (games only): only the number the link is built from, never a file name, a platform or a hash. */
export const GameRomLine = v.object({
  item_id: v.string(),
  romm_id: v.number(),
})

/** One ROM per work, matched by the register's number; where a game has several the lowest number is the one linked. */
export const GAME_ROMS_SQL = `SELECT igdb_id AS item_id, MIN(romm_id) AS romm_id
FROM game_romm
WHERE igdb_id IS NOT NULL
GROUP BY igdb_id`
