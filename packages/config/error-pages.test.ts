import { strict as assert } from "node:assert"
import { test } from "node:test"

import { errorPageHtml, errorResponse, withServerErrorPage } from "./error-pages.ts"

const HEADERS = { "X-Content-Type-Options": "nosniff" }

test("errorPageHtml is a complete page naming the status, with a way out", () => {
  const html = errorPageHtml(404)
  assert.match(html, /^<!doctype html>/)
  assert.match(html, /<h1>Siden finnes ikke<\/h1>/)
  assert.match(html, /href="\/"/)
  assert.doesNotMatch(html, /<script/)
})

test("errorResponse answers JSON under /api/ and HTML elsewhere, uncached, with the app's headers", async () => {
  const api = errorResponse(new Request("https://app.test/api/salary.json"), 500, HEADERS)
  assert.equal(api.status, 500)
  assert.match(api.headers.get("Content-Type") ?? "", /application\/json/)
  assert.deepEqual(await api.json(), { error: "Noe gikk galt" })

  const page = errorResponse(new Request("https://app.test/charts"), 403, HEADERS)
  assert.match(page.headers.get("Content-Type") ?? "", /text\/html/)
  assert.equal(page.headers.get("Cache-Control"), "no-store")
  assert.equal(page.headers.get("X-Content-Type-Options"), "nosniff")
})

test("withServerErrorPage turns a thrown error into the 500 page and passes success through", async () => {
  const originalError = console.error
  console.error = () => {}
  try {
    const failing = withServerErrorPage(async () => { throw new Error("boom") }, HEADERS)
    const response = await failing(new Request("https://app.test/"))
    assert.equal(response.status, 500)
    assert.match(await response.text(), /Noe gikk galt/)
  } finally {
    console.error = originalError
  }

  const working = withServerErrorPage(async (_request: Request, environment: { greeting: string }) => new Response(environment.greeting), HEADERS)
  assert.equal(await (await working(new Request("https://app.test/"), { greeting: "hi" })).text(), "hi")
})
