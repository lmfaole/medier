import { strict as assert } from "node:assert"
import { test } from "node:test"

import { jsonResponse } from "./json-response.ts"
import { CACHE_API, SECURITY_HEADERS } from "./security-headers.ts"

test("a 200 carries the API cache rule and the headers it was given", () => {
  const response = jsonResponse({ ok: true }, SECURITY_HEADERS)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), CACHE_API)
  assert.equal(response.headers.get("X-Frame-Options"), SECURITY_HEADERS["X-Frame-Options"])
  assert.match(response.headers.get("Content-Type") ?? "", /application\/json/)
})

test("anything but a 200 is never stored by the browser", () => {
  for (const status of [404, 503]) assert.equal(jsonResponse({ error: "x" }, SECURITY_HEADERS, status).headers.get("Cache-Control"), "no-store", String(status))
})
