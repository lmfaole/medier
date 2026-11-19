import { strict as assert } from "node:assert"
import { test } from "node:test"

import { formatObserved, hasProblems, isProblem, pageUrl, type Observed } from "./page-check-plan.ts"

test("a page's address follows how the app is mounted", () => {
  assert.equal(pageUrl(5188, "/apps/film", "/"), "http://localhost:5188/apps/film/")
  assert.equal(pageUrl(5188, "/apps/film/", "historikk"), "http://localhost:5188/apps/film/historikk")
  assert.equal(pageUrl(5184, undefined, "/medier"), "http://localhost:5184/medier")
})

test("the dev server's own chatter is not a problem", () => {
  assert.equal(isProblem("[vite] connecting..."), false)
  assert.equal(isProblem("Hydration failed because the server rendered HTML didn't match"), true)
})

const fine: Observed = {
  viewport: "desktop",
  status: 200,
  h1: "Film",
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  axe: [],
  noJs: { h1: "Film", textLength: 900 },
  screenshot: "shot.jpg",
}

test("a clean page is one line; each problem is a line of its own", () => {
  assert.equal(formatObserved("/", fine).split("\n").length, 1)
  assert.equal(hasProblems([fine]), false)
  const bad: Observed = { ...fine, consoleErrors: ["boom"], axe: ["color-contrast (2): low"], noJs: { h1: null, textLength: 10 } }
  const lines = formatObserved("/", bad).split("\n")
  assert.equal(lines.length, 4)
  assert.match(lines[0] ?? "", /^PROBLEM/)
  assert.equal(hasProblems([bad]), true)
})
