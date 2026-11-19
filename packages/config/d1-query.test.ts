import { strict as assert } from "node:assert"
import { test } from "node:test"

import * as v from "valibot"

import { queryRows } from "./d1-query.ts"
import { fakeD1 } from "./worker-test-kit.ts"

const Row = v.object({ id: v.number(), name: v.nullable(v.string()) })

test("queryRows returns rows that match the schema, in the schema's key order", async () => {
  const db = fakeD1(() => [{ name: "a", id: 1, extra: true }, { id: 2, name: null }])
  const rows = await queryRows(db, "SELECT id, name FROM t", Row)
  assert.deepEqual(rows, [{ id: 1, name: "a" }, { id: 2, name: null }])
  assert.deepEqual(Object.keys(rows[0] ?? {}), ["id", "name"])
})

test("queryRows rejects a row with a missing or wrongly typed column, naming it", async () => {
  await assert.rejects(queryRows(fakeD1(() => [{ id: 1 }]), "SELECT id FROM t", Row), /name/)
  await assert.rejects(queryRows(fakeD1(() => [{ id: "1", name: null }]), "SELECT id, name FROM t", Row), /id/)
})

test("queryRows binds parameters", async () => {
  let bound: unknown[] = []
  const db = fakeD1((_sql, parameters) => ((bound = parameters), []))
  await queryRows(db, "SELECT id, name FROM t WHERE period = ?", Row, "2025")
  assert.deepEqual(bound, ["2025"])
})
