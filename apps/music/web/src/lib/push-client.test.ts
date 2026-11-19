import { strict as assert } from "node:assert"
import { test } from "node:test"

import { keyBytes, topicsOf } from "./push-client.ts"

test("a VAPID key in URL-safe base64 is its bytes, with or without padding", () => {
  assert.deepEqual([...keyBytes("-_8")], [251, 255])
  assert.deepEqual([...keyBytes("AQID")], [1, 2, 3])
})

test("stored topics are the ones that are topics, in order, and nothing for text that is not a list", () => {
  assert.deepEqual(topicsOf('["month","week","day"]'), ["week", "month"])
  assert.deepEqual(topicsOf(null), [])
  assert.deepEqual(topicsOf("{not json"), [])
  assert.deepEqual(topicsOf('{"week":true}'), [])
})
