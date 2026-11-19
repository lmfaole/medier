import { strict as assert } from "node:assert"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"

import { sqliteAsD1 } from "./sqlite-d1.ts"

function database() {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
  return { sqlite, db: sqliteAsD1(sqlite) }
}

test("batch is one transaction: a failing statement leaves none of them applied, as on D1", async () => {
  const { sqlite, db } = database()
  await assert.rejects(
    db.batch([db.prepare("INSERT INTO t VALUES (?1, ?2)").bind(1, "a"), db.prepare("INSERT INTO t VALUES (?1, ?2)").bind(1, "duplicate")]),
  )
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM t").get()?.n, 0)
})
