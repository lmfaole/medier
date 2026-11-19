import { strict as assert } from "node:assert"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { dumpDatabase, restoreDatabase, rowCounts, shrunkTables, tableNames } from "./data-dump-plan.ts"

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS thing (id INTEGER PRIMARY KEY, name TEXT, score REAL, big INTEGER, data BLOB, note TEXT);
  CREATE TABLE IF NOT EXISTS pair (a TEXT NOT NULL, b INTEGER NOT NULL, PRIMARY KEY (a, b)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS empty_one (x INTEGER);
  CREATE TABLE IF NOT EXISTS seeded (id INTEGER PRIMARY KEY, n INTEGER);
  INSERT OR IGNORE INTO seeded VALUES (1, 0);
`

function seeded(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(SCHEMA)
  const insert = sqlite.prepare("INSERT INTO thing (id, name, score, big, data, note) VALUES (?, ?, ?, ?, ?, ?)")
  insert.run(1, "plain", 4.5, 3, new Uint8Array([0, 1, 255]), null)
  insert.run(2, 'quote " and, comma\nand a newline ø', 5.0, 9_007_199_254_740_993n, null, "")
  insert.run(3, null, 0, -7, new Uint8Array([]), "NULL")
  sqlite.exec("INSERT INTO pair VALUES ('b', 2), ('a', 9), ('a', 1)")
  sqlite.exec("UPDATE seeded SET n = 5")
  return sqlite
}

test("a database restored from its dump has the same values, down to NULL against empty text, a whole real and a big integer", () => {
  const source = seeded()
  const dump = dumpDatabase(source)
  assert.deepEqual([...dump.keys()], ["pair", "seeded", "thing"], "an empty table has no file")
  const target = new DatabaseSync(":memory:")
  // The schema seeds `seeded` with its own row; the dump's row replaces it instead of meeting it.
  assert.equal(restoreDatabase(target, SCHEMA, 3, dump), 7)
  const rows = (sqlite: DatabaseSync, sql: string) => {
    const statement = sqlite.prepare(sql)
    statement.setReadBigInts(true)
    return statement.all().map((row) => ({ ...row }))
  }
  const read = (sqlite: DatabaseSync) => ({
    things: rows(sqlite, "SELECT id, name, score, typeof(score) AS score_type, big, typeof(big) AS big_type, hex(data) AS data, typeof(data) AS data_type, note, typeof(note) AS note_type FROM thing ORDER BY id"),
    pairs: rows(sqlite, "SELECT a, b FROM pair ORDER BY a, b"),
    seeded: rows(sqlite, "SELECT id, n FROM seeded"),
  })
  assert.deepEqual(read(target), read(source))
  assert.deepEqual(target.prepare("PRAGMA user_version").all().map((row) => row["user_version"]), [3])
  // The same rows are the same text, so a dump of the restored database changes nothing in git.
  assert.deepEqual(dumpDatabase(target), dump)
})

test("a row that does not fit its table's columns is refused and nothing is left half restored", () => {
  const target = new DatabaseSync(":memory:")
  assert.throws(() => restoreDatabase(target, SCHEMA, 1, new Map([["thing", '["id","name"]\n[1,"a"]\n[2]\n']])), /does not have 2 values/)
  assert.equal(target.prepare("SELECT count(*) AS n FROM thing").get()?.["n"], 0)
})

test("a table that loses a fifth of its rows, or vanishes, is flagged; a small clean-up or a growing table is not", () => {
  const before = new Map([["big", 1000], ["gone", 50], ["small", 30], ["grew", 100]])
  const after = new Map([["big", 700], ["small", 20], ["grew", 400]])
  assert.deepEqual(shrunkTables(before, after), ["big: 1000 rows in the dump, 700 in the database", "gone: 50 rows in the dump, 0 in the database"])
  assert.deepEqual(rowCounts(new Map([["t", '["a"]\n[1]\n[2]\n']])), new Map([["t", 2]]))
})

test("a table the schema has dropped (a rename) is not a loss, one that still exists and was emptied is", () => {
  const before = new Map([["renamed_away", 30], ["emptied", 30]])
  const after = new Map<string, number>()
  assert.deepEqual(shrunkTables(before, after, new Set(["emptied"])), ["emptied: 30 rows in the dump, 0 in the database"])
  const sqlite = seeded()
  assert.deepEqual(tableNames(sqlite), ["empty_one", "pair", "seeded", "thing"], "an empty table still exists")
})

test("a text with a NUL in it survives the dump whole, and two keys that differ only after the NUL stay two", () => {
  const schema = "CREATE TABLE IF NOT EXISTS keyed (k TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (k, n))"
  const source = new DatabaseSync(":memory:")
  source.exec(schema)
  const insert = source.prepare("INSERT INTO keyed VALUES (CAST(? AS TEXT), ?)")
  insert.run(new Uint8Array(Buffer.from("collection:A\u0000Silent Night")), 1)
  insert.run(new Uint8Array(Buffer.from("collection:A\u0000Honey")), 1)
  insert.run(new Uint8Array(Buffer.from("plain")), 1)
  const target = new DatabaseSync(":memory:")
  assert.equal(restoreDatabase(target, schema, 1, dumpDatabase(source)), 3)
  const keys = (sqlite: DatabaseSync) => sqlite.prepare("SELECT hex(k) AS k FROM keyed ORDER BY k").all().map((row) => row["k"])
  assert.deepEqual(keys(target), keys(source))
  assert.equal(keys(target).length, 3)
})
