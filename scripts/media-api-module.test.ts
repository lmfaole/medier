import { strict as assert } from "node:assert"
import { test } from "node:test"

import { parseApiModule } from "./media-api-module.ts"

const loader = async () => ({})

test("a module with domains is SQLite-backed, one with none is file-backed", () => {
  assert.equal(parseApiModule({ API: { a: loader }, DOMAINS: ["film", "platform"] }).kind, "sqlite")
  assert.equal(parseApiModule({ API: { a: loader }, DOMAINS: [] }).kind, "files")
})

test("a broken module is refused as the kind it claims, not as the other", () => {
  assert.throws(() => parseApiModule({ API: { a: 1 }, DOMAINS: [] }), /not a loader function/)
  assert.throws(() => parseApiModule({ API: {}, DOMAINS: "film" }), /Expected Array/)
  assert.throws(() => parseApiModule({ API: {} }), /"DOMAINS"/)
  assert.throws(() => parseApiModule(undefined))
})
