import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { sqliteAsD1 } from "@designsystem/config/sqlite-d1"

import { COLLECTIONS } from "./collections.ts"
import { rows } from "./fixtures/rows.ts"
import { readContentFromDatabase } from "./read-database.ts"
import { CONTENT_DATABASES, contentSchemaSql } from "./tables.ts"
import { contentRowsSql } from "./to-sql.ts"

const db = (file: string) => readFileSync(join(import.meta.dirname, "..", "..", "..", "db", file), "utf8")
const schema = CONTENT_DATABASES.map((name) => db(`${name}.sql`)).join("\n")

for (const name of CONTENT_DATABASES) {
  test(`db/${name}.sql holds the tables the specs say; run \`npm run generate --workspace @designsystem/content\``, () => {
    assert.equal(db(`${name}.sql`), contentSchemaSql(name))
  })
}

test("the rows go to SQL and come back from the database exactly as they went in", async () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(schema)
  const original = rows
  sqlite.exec(contentRowsSql(original))
  const back = await readContentFromDatabase(sqliteAsD1(sqlite), COLLECTIONS.map((collection) => collection.type))
  for (const collection of COLLECTIONS) assert.deepEqual(back.get(collection.type), original.get(collection.type), collection.type)
  assert.ok((back.get("cvPosition") ?? []).length > 0)
})

test("loading the rows twice replaces them instead of adding to them", async () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(schema)
  const original = rows
  sqlite.exec(contentRowsSql(original))
  sqlite.exec(contentRowsSql(original))
  const back = await readContentFromDatabase(sqliteAsD1(sqlite), ["cvEmployer"])
  assert.deepEqual(back.get("cvEmployer"), original.get("cvEmployer"))
})

test("a collection with no table is an error at the read", async () => {
  await assert.rejects(() => readContentFromDatabase(sqliteAsD1(new DatabaseSync(":memory:")), ["nothing"]), /not a collection/)
})
