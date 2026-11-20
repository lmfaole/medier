import { strict as assert } from "node:assert"
import { test } from "node:test"

import { mediumHref, oldAddress } from "./media.ts"

test("each medium has its pages under its own address", () => {
  assert.equal(mediumHref("/", "music", "historikk/"), "/musikk/historikk/")
  assert.equal(mediumHref("/", "film", "uke/", "2026-47"), "/film-og-tv/uke/2026-47/")
  assert.equal(mediumHref("/", "film"), "/film-og-tv/")
})

test("the old shared addresses lead to the music's, with the week or month and the query; others are left alone", () => {
  assert.equal(oldAddress("/", "/historikk/", ""), "/musikk/historikk/")
  assert.equal(oldAddress("/", "/historikk", "?a=1"), "/musikk/historikk/?a=1")
  assert.equal(oldAddress("/", "/uke/", ""), "/musikk/uke/")
  assert.equal(oldAddress("/", "/uke/2026-47/", ""), "/musikk/uke/2026-47/")
  assert.equal(oldAddress("/", "/maned/2026-11/", "?x=y"), "/musikk/maned/2026-11/?x=y")
  assert.equal(oldAddress("/", "/musikk/historikk/", ""), null)
  assert.equal(oldAddress("/", "/uke/2026-47/extra/", ""), null)
})
