import { strict as assert } from "node:assert"
import { test } from "node:test"

import * as v from "valibot"

import rows from "./og-pages.json" with { type: "json" }
import { fill, OgPageRow, pageHeader, pageOg, pageRow, PLACEHOLDERS, splitId } from "./og-pages.ts"
import { ogImageIds } from "./og-images.ts"

const ROWS = v.parse(v.array(OgPageRow), rows)

test("an id splits into its app and path, and anything else does not", () => {
  assert.deepEqual(splitId("music:/historikk"), { app: "music", path: "/historikk" })
  assert.deepEqual(splitId("music:/"), { app: "music", path: "/" })
  for (const id of ["", "music", "music:wrapped", "nowhere:/x", ":/x"]) assert.equal(splitId(id), undefined, id)
})

test("a path with no row of its own takes the nearest page above it, then the app's root", () => {
  assert.equal(pageRow("music", "/historikk/2025")?.path, "/historikk")
  assert.equal(pageRow("music", "/historikk/")?.path, "/historikk")
  assert.equal(pageRow("music", "/historikk")?.path, "/historikk")
  assert.equal(pageRow("music", "/nowhere")?.path, "/")
})

test("the tags carry the page's own address on the app's origin", () => {
  const preview = pageOg("music", "/historikk")
  assert.equal(preview?.og.url, "https://sky.lmfaole.party/apps/medier/musikk/historikk")
  assert.equal(preview?.title, preview?.og.title)
})

test("a page with no uploaded image keeps the shared card", () => {
  assert.equal(pageOg("music", "/historikk")?.og.image, undefined)
  assert.ok(ogImageIds() instanceof Set)
})

test("a lead's placeholders are filled from the values, and a lead missing one is hidden rather than shown with braces", () => {
  assert.equal(fill("{count} bilder", { count: 77 }), "77 bilder")
  assert.equal(fill("fra {first} til {last}", { first: "2017", last: "2020" }), "fra 2017 til 2020")
  assert.equal(fill("{count} bilder"), undefined)
  assert.equal(fill("no placeholders"), "no placeholders")
})

test("a page's header is its heading (else its title) and its lead, and nothing for an unknown page", () => {
  assert.deepEqual(pageHeader("music:/bibliotek", { count: 1_204 }), { title: "Bibliotek", lead: "Alle 1204 artister, album og låter jeg har hørt, med søk og filter." })
  assert.deepEqual(pageHeader("music:/historikk"), { title: "Historikk", lead: "Hver avspilling, en måned om gangen, nyeste først." })
  assert.deepEqual(pageHeader("nowhere:/x"), {})
})

test("a row's text names only placeholders a page fills in", () => {
  for (const row of ROWS) {
    for (const [, name] of (row.lead ?? "").matchAll(/\{(\w+)\}/g)) assert.ok(PLACEHOLDERS.some((known) => known === name), `${row.id} uses {${name}}`)
  }
})
