/** A music database in memory with the given plays (`[local time, artist]`), for the tests of the period summaries. */
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

export const at = (iso: string) => Date.parse(`${iso}Z`) / 1000

export function listensDatabase(plays: [string, string][]): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(readFileSync(new URL("../../../../../db/music.sql", import.meta.url), "utf8"))
  const insert = sqlite.prepare("INSERT INTO listens (listened_at, track_name, artist_name, release_name) VALUES (?, ?, ?, 'Album')")
  plays.forEach(([when, artist], index) => insert.run(at(when), `Låt ${index}`, artist))
  return sqlite
}
