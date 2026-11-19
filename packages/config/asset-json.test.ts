import { strict as assert } from "node:assert"
import { test } from "node:test"

import * as v from "valibot"

import { assetJson } from "./asset-json.ts"

const Episodes = v.array(v.object({ id: v.number() }))
const json = (body: string, init: ResponseInit = {}) =>
  new Response(body, { ...init, headers: { "Content-Type": "application/json", ...init.headers } })

test("assetJson returns JSON that matches the schema", async () => {
  assert.deepEqual(await assetJson(json('[{"id":1}]'), Episodes, "episoder.json"), [{ id: 1 }])
})

test("assetJson refuses an HTML answer with a clear error, not a SyntaxError", async () => {
  const shell = new Response("<html>", { headers: { "Content-Type": "text/html" } })
  await assert.rejects(assetJson(shell, Episodes, "episoder.json"), (error: unknown) => {
    assert.ok(error instanceof Error && !(error instanceof SyntaxError))
    assert.match(error.message, /episoder\.json.*text\/html/)
    return true
  })
})

test("assetJson refuses a non-ok answer and JSON of the wrong shape", async () => {
  await assert.rejects(assetJson(json("[]", { status: 404 }), Episodes, "episoder.json"), /404/)
  await assert.rejects(assetJson(json('[{"id":"1"}]'), Episodes, "episoder.json"), /episoder\.json/)
})
