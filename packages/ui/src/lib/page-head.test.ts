import { strict as assert } from "node:assert"
import { test } from "node:test"

import { appPathOf } from "./page-head.ts"

test("the base is taken off a path of the app", () => {
  assert.equal(appPathOf(new URL("https://sky.lmfaole.party/apps/film/historikk?period=2025"), "/apps/film/"), "/historikk")
  assert.equal(appPathOf(new URL("https://sky.lmfaole.party/apps/film/film/heat-1995"), "/apps/film"), "/film/heat-1995")
})

test("the root of the app is /", () => {
  assert.equal(appPathOf(new URL("https://sky.lmfaole.party/apps/film/"), "/apps/film/"), "/")
  assert.equal(appPathOf(new URL("https://sky.lmfaole.party/apps/film"), "/apps/film"), "/")
})

test("an app at the root of its host keeps the path, and a path that only starts like the base is not cut", () => {
  assert.equal(appPathOf(new URL("https://lmfaole.party/kilder"), "/"), "/kilder")
  assert.equal(appPathOf(new URL("https://sky.lmfaole.party/apps/filmer"), "/apps/film/"), "/apps/filmer")
})
