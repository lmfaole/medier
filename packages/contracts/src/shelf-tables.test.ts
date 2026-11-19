import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import * as v from "valibot"

import { ShelfLine, shelfGenresSql, shelfHoldingsSql, shelfLinesSql, type ShelfPrefix } from "./shelf-tables.ts"

const owners: readonly (readonly [string, ShelfPrefix])[] = [["games", "game"], ["books", "book"], ["boardgames", "boardgame"]]

for (const [owner, prefix] of owners) {
  test(`${owner}: a line gets the work its number names, else the register's answer for its title and year, else none`, () => {
    const sqlite = new DatabaseSync(":memory:")
    sqlite.exec(readFileSync(join(import.meta.dirname, "..", "..", "..", "db", `${owner}.sql`), "utf8"))
    sqlite.exec(`
      INSERT INTO ${prefix}_item (ext_id, title, creator, year, fetched_at) VALUES ('1', 'By number', 'A', 2000, 1), ('2', 'By match', 'B', 2001, 1);
      INSERT INTO ${prefix}_match (title, year, ext_id, candidates, tried_at) VALUES ('Matched', 2001, '2', NULL, 1), ('Unsure', 0, NULL, '[]', 1);
      INSERT INTO ${prefix}_genre (ext_id, genre) VALUES ('1', 'Z'), ('1', 'A');
      INSERT INTO ${prefix}_entry (on_date, title, year, status, ext_id, note, source) VALUES
        ('2026-01-01', 'Named', 1999, '${owner === "boardgames" ? "played" : "done"}', '1', 'private', 'svc:1'),
        (NULL, 'Matched', 2001, '${owner === "boardgames" ? "played" : "done"}', NULL, NULL, NULL),
        (NULL, 'Unsure', NULL, '${owner === "boardgames" ? "played" : "done"}', NULL, NULL, NULL),
        (NULL, 'Matched', NULL, '${owner === "boardgames" ? "played" : "done"}', NULL, NULL, NULL);
    `)
    const lines = v.parse(v.array(ShelfLine), sqlite.prepare(shelfLinesSql(prefix)).all())
    assert.deepEqual(lines.map((line) => line.item_id), ["1", "2", null, null])
    assert.equal(lines[0]?.item_title, "By number")
    // A line's note and the service's number are not columns a page can read.
    assert.ok(!("note" in (lines[0] ?? {})) && !("source" in (lines[0] ?? {})))
    // The collection is read in the same shape, with its work matched the same way, and a work in it needs no line in the log.
    sqlite.exec(`INSERT INTO ${prefix}_collection (title, year, status, format) VALUES ('Matched', 2001, 'owned', 'fysisk'), ('Only wanted', NULL, 'want', NULL)`)
    const holdings = v.parse(v.array(ShelfLine), sqlite.prepare(shelfHoldingsSql(prefix)).all())
    assert.deepEqual(holdings.map((line) => [line.title, line.status, line.item_id, line.format]), [["Matched", "owned", "2", "fysisk"], ["Only wanted", "want", null, null]])
    assert.deepEqual(sqlite.prepare(shelfGenresSql(prefix)).all().map((row) => row["genre"]), ["A", "Z"])
  })
}
