import { strict as assert } from "node:assert"
import { test } from "node:test"

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DEVTOOLS_MARKERS, filesWithDevtools, halvesWithoutFiles, readDistFiles } from "./check-bundles.ts"

test("a bundle that contains a devtools marker is flagged", () => {
  const files = new Map([
    ["dist/client/assets/devtools-abc.js", `...${DEVTOOLS_MARKERS[0]}...`],
    ["dist/client/assets/index-abc.js", "console.log('app')"],
  ])
  assert.deepEqual(filesWithDevtools(files), ["dist/client/assets/devtools-abc.js"])
})

test("Astro's dev toolbar in a bundle is flagged", () => {
  assert.deepEqual(filesWithDevtools(new Map([["server/chunks/page.mjs", "customElements.define('astro-dev-toolbar', X)"]])), ["server/chunks/page.mjs"])
})

test("a clean bundle is not", () => {
  assert.deepEqual(filesWithDevtools(new Map([["dist/client/assets/index-abc.js", "console.log('app')"]])), [])
})

test("readDistFiles reads the .js and .mjs files under a dist, keyed by path from it", () => {
  const dist = mkdtempSync(join(tmpdir(), "dist-"))
  mkdirSync(join(dist, "client", "assets"), { recursive: true })
  mkdirSync(join(dist, "server"), { recursive: true })
  writeFileSync(join(dist, "client", "assets", "index-abc.js"), "client")
  writeFileSync(join(dist, "server", "index.mjs"), "worker")
  writeFileSync(join(dist, "client", "assets", "index-abc.js.map"), "not a bundle")
  assert.deepEqual([...readDistFiles(dist)].toSorted(), [["client/assets/index-abc.js", "client"], ["server/index.mjs", "worker"]])
})

test("a dist with no client files, or no Worker files, is named, so a scan cannot pass without reading both", () => {
  const both = new Map([["client/assets/a.js", ""], ["server/index.js", ""]])
  assert.deepEqual(halvesWithoutFiles(both), [])
  assert.deepEqual(halvesWithoutFiles(new Map([["client/assets/a.js", ""]])), ["server"])
  assert.deepEqual(halvesWithoutFiles(new Map([["server/index.js", ""]])), ["client"])
  assert.deepEqual(halvesWithoutFiles(new Map()), ["client", "server"])
})
