import { strict as assert } from "node:assert"
import { test } from "node:test"

import { sqlDump, sqlLiteral } from "./sql-dump.ts"

test("sqlLiteral writes NULL, numbers, blobs and quoted text", () => {
  assert.equal(sqlLiteral(null), "NULL")
  assert.equal(sqlLiteral(undefined), "NULL")
  assert.equal(sqlLiteral(42), "42")
  assert.equal(sqlLiteral(2n ** 63n - 1n), "9223372036854775807")
  assert.equal(sqlLiteral(new Uint8Array([0, 255])), "X'00ff'")
  assert.equal(sqlLiteral("it's"), "'it''s'")
})

test("sqlLiteral refuses a number SQL cannot hold", () => {
  assert.throws(() => sqlLiteral(Number.NaN), /not a finite number/)
  assert.throws(() => sqlLiteral(Number.POSITIVE_INFINITY), /not a finite number/)
})

test("sqlDump empties children before parents, then inserts parents first", () => {
  const rows: Record<string, Record<string, unknown>[]> = {
    parent: [{ id: 1, name: "a" }],
    child: [],
    other: [{ id: 2, parent_id: 1 }],
  }
  const { sql, counts } = sqlDump(["parent", "child", "other"], (table) => rows[table] ?? [], "test.db")
  const statements = sql.split("\n").filter((line) => !line.startsWith("--") && line.trim() !== "")
  assert.deepEqual(statements, [
    "DELETE FROM other;",
    "DELETE FROM child;",
    "DELETE FROM parent;",
    'INSERT INTO parent ("id", "name") VALUES',
    "  (1, 'a');",
    'INSERT INTO other ("id", "parent_id") VALUES',
    "  (2, 1);",
  ])
  assert.deepEqual(counts, { parent: 1, child: 0, other: 1 })
})
