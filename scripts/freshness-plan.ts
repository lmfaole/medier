/**
 * The sentence at the foot of every app ("Sist oppdatert …, 3 nye visninger") starts here: `sync-timers.ts` counts
 * the rows of the app's main table around a timer run and keeps the difference in the run log, and `npm run snapshot`
 * writes the newest such run as `api/oppdatert.json` (`readFreshness`).
 */

import { existsSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import * as v from "valibot"

import type { Freshness } from "@designsystem/ui/lib/freshness"

import type { DatabaseName } from "./data.ts"

interface Counted {
  database: DatabaseName
  table: string
  one: string
  many: string
}

/** The table that grows when an app's sync brings something new, and what one of its rows is called. */
export const COUNTED: Readonly<Record<string, Counted>> = {
  music: { database: "music", table: "listens", one: "avspilling", many: "avspillinger" },
  podkast: { database: "podcast_history", table: "episode_actions", one: "hendelse", many: "hendelser" },
  film: { database: "film", table: "film_watch", one: "visning", many: "visninger" },
  tv: { database: "tv", table: "tv_watch", one: "visning", many: "visninger" },
  games: { database: "games", table: "game_entry", one: "oppføring", many: "oppføringer" },
  books: { database: "books", table: "book_entry", one: "oppføring", many: "oppføringer" },
  boardgames: { database: "boardgames", table: "boardgame_entry", one: "oppføring", many: "oppføringer" },
  work: { database: "github", table: "github_items", one: "sak", many: "saker" },
}

const NEWEST_COUNTED_RUN = `
  SELECT finished_at, added FROM sync_runs
  WHERE source = ? AND added IS NOT NULL AND ok = 1 AND finished_at IS NOT NULL
  ORDER BY finished_at DESC, id DESC LIMIT 1`
const CountedRun = v.object({ finished_at: v.string(), added: v.number() })
const RowCount = v.object({ count: v.number() })

/** A sync can also delete (the log is the record, so an import makes the table exactly its rows); only growth is news. */
export function addedRows(before: number, after: number): number {
  return Math.max(after - before, 0)
}

/** The row count of an app's main table, or `null` where the database or the table is not there (yet). */
export function countRows(databaseFile: string, table: string): number | null {
  if (!existsSync(databaseFile)) return null
  const sqlite = new DatabaseSync(databaseFile, { readOnly: true })
  try {
    sqlite.exec("PRAGMA busy_timeout = 5000")
    const [row] = v.parse(v.array(RowCount), sqlite.prepare(`SELECT count(*) AS count FROM "${table}"`).all())
    return row?.count ?? null
  } catch {
    return null
  } finally {
    sqlite.close()
  }
}

/** The newest run of `source` that finished well with every job, or `null` for an app with no sync or none counted yet. */
export function readFreshness(runLog: DatabaseSync, source: string): Freshness | null {
  const counted = COUNTED[source]
  if (counted === undefined) return null
  const [run] = v.parse(v.array(CountedRun), runLog.prepare(NEWEST_COUNTED_RUN).all(source))
  return run === undefined ? null : { finishedAt: run.finished_at, added: run.added, one: counted.one, many: counted.many }
}
