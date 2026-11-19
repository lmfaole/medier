import { strict as assert } from "node:assert"
import { test } from "node:test"

import { forbiddenBindings } from "./bindings-config.ts"

test("a config with no data store is fine", () => {
  assert.deepEqual(forbiddenBindings('{ "name": "music", "assets": { "binding": "ASSETS" } }'), [])
})

test("a database, bucket or key-value store at the top level is named", () => {
  const config = '{ "d1_databases": [{ "binding": "DB" }], "r2_buckets": [{ "binding": "B" }], "kv_namespaces": [{ "binding": "K" }], "vpc_services": [{ "binding": "HOME" }] }'
  assert.deepEqual(forbiddenBindings(config), ["d1_databases", "kv_namespaces", "r2_buckets", "vpc_services"])
})

test("an empty list binds nothing", () => {
  assert.deepEqual(forbiddenBindings('{ "d1_databases": [] }'), [])
})

test("a binding in a named env is not the deployed Worker's, and a commented-out one is not there at all", () => {
  const config = `{
    // "d1_databases": [{ "binding": "DB" }],
    "env": { "local": { "d1_databases": [{ "binding": "DB" }] } }
  }`
  assert.deepEqual(forbiddenBindings(config), [])
})

test("a config that cannot be read is refused, not waved through", () => {
  assert.deepEqual(forbiddenBindings("{ not json"), ["unreadable config"])
})
