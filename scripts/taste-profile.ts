/**
 * What the owner's taste is, counted from the local databases: films and series seen (genres, decades, directors or
 * creators, actors, countries, the average rating), and the music (the artists scrobbled most, the genres, and what was
 * heard without a scrobble). Printed as Markdown by `npm run seen -- profile`, and kept in `.data/profile/taste.md`,
 * which is private like everything under `.data/`. The queries are the ones the media page reads
 * (`@designsystem/contracts/media-taste`).
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { CountRow, MUSIC_TASTE_SQL, WatchTotalsRow, watchTasteSql, type WatchDomain } from "@designsystem/contracts/media-taste"
import * as v from "valibot"

const root = join(import.meta.dirname, "..")

function open(domain: string): DatabaseSync | undefined {
  const file = join(root, ".data", `${domain}.db`)
  return existsSync(file) ? new DatabaseSync(file, { readOnly: true }) : undefined
}

const counts = (db: DatabaseSync, sql: string) => v.parse(v.array(CountRow), db.prepare(sql).all())

function list(title: string, rows: readonly { label: string; n: number }[], unit = ""): string {
  return rows.length === 0 ? "" : `\n### ${title}\n${rows.map((row) => `- ${row.label} (${row.n}${unit})`).join("\n")}\n`
}

function watching(domain: WatchDomain, noun: string, lead: string): string {
  const db = open(domain)
  if (db === undefined) return ""
  const sql = watchTasteSql(domain)
  const totals = v.parse(v.array(WatchTotalsRow), db.prepare(sql.totals).all())[0]
  return [
    `\n## ${noun}\n${totals?.items ?? 0} ${noun.toLowerCase()}, ${totals?.viewings ?? 0} visninger${totals?.rating == null ? "" : `, snittvurdering ${totals.rating} av 5`}.`,
    list("Sjangre", counts(db, sql.genres)),
    list("Tiår", counts(db, sql.decades)),
    list(lead, counts(db, sql.lead)),
    list("Skuespillere", counts(db, sql.cast)),
    list("Land", counts(db, sql.countries)),
  ].join("")
}

function music(): string {
  const db = open("music")
  if (db === undefined) return ""
  // Written by `music-sync add-heard`, which makes the table; before the first one there is none.
  const hasHeard = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'music_heard'").all().length > 0
  const heard = hasHeard ? counts(db, MUSIC_TASTE_SQL.heard).map((row) => `${row.n} ${row.label}`).join(", ") : ""
  const listens = counts(db, MUSIC_TASTE_SQL.listens.replace("count(*) AS n", "'' AS label, count(*) AS n"))[0]?.n ?? 0
  return [
    `\n## Musikk\n${listens} avspillinger${heard === "" ? "" : `, og hørt uten scrobble: ${heard}`}.`,
    list("Artister", counts(db, MUSIC_TASTE_SQL.artists), " avspillinger"),
    list("Sjangre i avspillingene", counts(db, MUSIC_TASTE_SQL.genres), " avspillinger"),
    list("Sjangre i det du har hørt uten scrobble", hasHeard ? counts(db, MUSIC_TASTE_SQL.heardGenres) : []),
  ].join("")
}

export function profile(): string {
  return ["# Min smak\n", watching("film", "Filmer", "Regissører"), watching("tv", "Serier", "Serieskapere"), music()].join("")
}
