import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import type * as v from "valibot"

import { GithubProjectCommitRow } from "./github-tables.ts"
import { ListenRow, MUSIC_ONLY_SQL, MusicCollectionRow, MusicHeardRow, RecordingGenreRow, SummaryPeriodRow } from "./music-tables.ts"
import { PodcastHistoryActionRow } from "./podcast-history-tables.ts"
import { FilmCinemaRow, FilmCollectionRow, FilmCompanyRow, FilmCountryRow, FilmCreditRow, FilmGenreRow, FilmKeywordRow, FilmLanguageRow, FilmMatchRow, FilmFranchisePartRow, FilmFranchiseRow, FilmPersonRow, FilmPlannedRow, FilmRelatedRow, FilmTitleRow, FilmWatchRow } from "./film-tables.ts"
import { BoardgameDetailRow, BoardgameLinkRow, BoardgameNameRow, BoardgamePlayerPollRow, BoardgameRankRow } from "./boardgame-tables.ts"
import { GameAchievementRow, ShelfEntryRow, ShelfGenreRow, ShelfItemRow, ShelfMatchRow } from "./shelf-tables.ts"
import { TvCollectionRow, TvCompanyRow, TvCountryRow, TvCreditRow, TvGenreRow, TvKeywordRow, TvRelatedRow, TvLanguageRow, TvMatchRow, TvNetworkRow, TvNextRow, TvPersonRow, TvTitleRow, TvWatchRow } from "./tv-tables.ts"
import { PodcastFeedChoiceRow, PodcastFeedEpisodeRow, PodcastListenRow, PodcastPersonRow, PodcastPlayRow, PodcastShowCountryRow, PodcastShowInfoRow, PodcastShowRow } from "./podcast-tables.ts"

/** The owner's schema, `db/<owner>.sql`. */
const schemaFile = (owner: string) => join(import.meta.dirname, "..", "..", "..", "db", `${owner}.sql`)

interface Column {
  name: string
  type: "string" | "number"
  nullable: boolean
}

/** The columns of `table` in a hand-written `schema.sql`, in order. */
function tableColumns(sql: string, table: string): Column[] {
  const body = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1]
  assert.ok(body !== undefined, `no CREATE TABLE ${table}`)
  return body
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trim())
    .filter((line) => line !== "" && !/^(PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|CONSTRAINT)\b/.test(line))
    .map((line) => {
      const [, name = "", sqlType = "", rest = ""] = /^(\w+)\s+(\w+)(.*)$/.exec(line) ?? []
      return {
        name,
        type: sqlType === "TEXT" ? "string" : "number",
        nullable: !/NOT NULL|PRIMARY KEY/.test(rest),
      }
    })
}

/** The columns a contract's object schema promises, from valibot's own description of it. */
function contractColumns(schema: v.ObjectSchema<v.ObjectEntries, undefined>): Column[] {
  return Object.entries(schema.entries).map(([name, entry]) => {
    const nullable = entry.type === "nullable"
    const inner: unknown = nullable && "wrapped" in entry ? entry.wrapped : entry
    const type = typeof inner === "object" && inner !== null && "type" in inner && inner.type === "string" ? "string" : "number"
    return { name, type, nullable }
  })
}

const cases = [
  { owner: "music", table: "summary_periods", schema: SummaryPeriodRow },
  { owner: "music", table: "listens", schema: ListenRow },
  { owner: "music", table: "recording_genres", schema: RecordingGenreRow },
  { owner: "music", table: "music_heard", schema: MusicHeardRow },
  { owner: "github", table: "github_project_commits", schema: GithubProjectCommitRow },
  { owner: "podcast_history", table: "episode_actions", schema: PodcastHistoryActionRow },
  { owner: "podcasts", table: "podcast_shows", schema: PodcastShowRow },
  { owner: "podcasts", table: "podcast_plays", schema: PodcastPlayRow },
  { owner: "podcasts", table: "podcast_listens", schema: PodcastListenRow },
  { owner: "podcasts", table: "podcast_show_info", schema: PodcastShowInfoRow },
  { owner: "podcasts", table: "podcast_feed_episode", schema: PodcastFeedEpisodeRow },
  { owner: "podcasts", table: "podcast_person", schema: PodcastPersonRow },
  { owner: "podcasts", table: "podcast_show_country", schema: PodcastShowCountryRow },
  { owner: "podcasts", table: "podcast_feed_choice", schema: PodcastFeedChoiceRow },
  { owner: "film", table: "film_watch", schema: FilmWatchRow },
  { owner: "film", table: "film_match", schema: FilmMatchRow },
  { owner: "film", table: "film_title", schema: FilmTitleRow },
  { owner: "film", table: "film_genre", schema: FilmGenreRow },
  { owner: "film", table: "film_country", schema: FilmCountryRow },
  { owner: "film", table: "film_credit", schema: FilmCreditRow },
  { owner: "film", table: "film_cinema", schema: FilmCinemaRow },
  { owner: "film", table: "film_related", schema: FilmRelatedRow },
  { owner: "film", table: "film_franchise", schema: FilmFranchiseRow },
  { owner: "film", table: "film_franchise_part", schema: FilmFranchisePartRow },
  { owner: "film", table: "film_language", schema: FilmLanguageRow },
  { owner: "film", table: "film_planned", schema: FilmPlannedRow },
  { owner: "film", table: "film_company", schema: FilmCompanyRow },
  { owner: "film", table: "film_keyword", schema: FilmKeywordRow },
  { owner: "film", table: "film_person", schema: FilmPersonRow },
  { owner: "film", table: "film_collection", schema: FilmCollectionRow },
  { owner: "tv", table: "tv_collection", schema: TvCollectionRow },
  { owner: "music", table: "music_collection", schema: MusicCollectionRow },
  { owner: "tv", table: "tv_watch", schema: TvWatchRow },
  { owner: "tv", table: "tv_match", schema: TvMatchRow },
  { owner: "tv", table: "tv_title", schema: TvTitleRow },
  { owner: "tv", table: "tv_next", schema: TvNextRow },
  { owner: "tv", table: "tv_genre", schema: TvGenreRow },
  { owner: "tv", table: "tv_country", schema: TvCountryRow },
  { owner: "tv", table: "tv_language", schema: TvLanguageRow },
  { owner: "tv", table: "tv_network", schema: TvNetworkRow },
  { owner: "tv", table: "tv_credit", schema: TvCreditRow },
  { owner: "tv", table: "tv_company", schema: TvCompanyRow },
  { owner: "tv", table: "tv_keyword", schema: TvKeywordRow },
  { owner: "tv", table: "tv_related", schema: TvRelatedRow },
  { owner: "tv", table: "tv_person", schema: TvPersonRow },
  { owner: "games", table: "game_entry", schema: ShelfEntryRow },
  { owner: "games", table: "game_match", schema: ShelfMatchRow },
  { owner: "games", table: "game_item", schema: ShelfItemRow },
  { owner: "games", table: "game_genre", schema: ShelfGenreRow },
  { owner: "games", table: "game_achievement", schema: GameAchievementRow },
  { owner: "books", table: "book_entry", schema: ShelfEntryRow },
  { owner: "books", table: "book_match", schema: ShelfMatchRow },
  { owner: "books", table: "book_item", schema: ShelfItemRow },
  { owner: "books", table: "book_genre", schema: ShelfGenreRow },
  { owner: "boardgames", table: "boardgame_entry", schema: ShelfEntryRow },
  { owner: "boardgames", table: "boardgame_match", schema: ShelfMatchRow },
  { owner: "boardgames", table: "boardgame_item", schema: ShelfItemRow },
  { owner: "boardgames", table: "boardgame_genre", schema: ShelfGenreRow },
  { owner: "boardgames", table: "boardgame_detail", schema: BoardgameDetailRow },
  { owner: "boardgames", table: "boardgame_link", schema: BoardgameLinkRow },
  { owner: "boardgames", table: "boardgame_name", schema: BoardgameNameRow },
  { owner: "boardgames", table: "boardgame_player_poll", schema: BoardgamePlayerPollRow },
  { owner: "boardgames", table: "boardgame_rank", schema: BoardgameRankRow },
]

for (const { owner, table, schema } of cases) {
  test(`the contract for ${owner}'s ${table} matches its schema, column for column`, () => {
    const sql = readFileSync(schemaFile(owner), "utf8")
    assert.deepEqual(contractColumns(schema), tableColumns(sql, table))
  })
}

test("the Rust sync and the Workers keep a listen under the same condition", () => {
  const scope = readFileSync(join(import.meta.dirname, "..", "..", "..", "apps", "music", "sync-rust", "src", "scope.rs"), "utf8")
  const literal = /macro_rules! music_only \{\s*\(\) => \{\s*"([\s\S]*?)"\s*\};?\s*\}/.exec(scope)?.[1]
  assert.ok(literal !== undefined, "scope.rs has no music_only! literal")
  // In a Rust string a backslash at the end of a line drops the line break and the next line's indentation.
  assert.equal(literal.replace(/\\\n\s*/g, ""), MUSIC_ONLY_SQL.replace(/\s+/g, " "))
})

test("a listen is music unless it is a long clip with no album and no recording, and a missing duration counts as short", () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(readFileSync(schemaFile("music"), "utf8"))
  sqlite.exec(`
    INSERT INTO listens (listened_at, track_name, artist_name, release_name, recording_mbid, duration_ms) VALUES
      (1, 'song', 'Band', 'Album', NULL, 200000),
      (2, 'unmapped song, no duration', 'Someone', NULL, NULL, NULL),
      (3, 'unmapped song, short', 'Someone', NULL, NULL, 240000),
      (4, 'long mix with a recording', 'DJ', NULL, 'r1', 5400000),
      (5, 'long with an album', 'Debatten', 'NRK', NULL, 3000000),
      (6, 'a headline clip', 'Rentekutt', NULL, NULL, 3540000);
  `)
  const tracks = (sql: string) => sqlite.prepare(sql).all().map((row) => String(row["track_name"]))
  const music = tracks(`SELECT track_name FROM listens WHERE ${MUSIC_ONLY_SQL} ORDER BY listened_at`)
  assert.deepEqual(music, ["song", "unmapped song, no duration", "unmapped song, short", "long mix with a recording", "long with an album"])
})
