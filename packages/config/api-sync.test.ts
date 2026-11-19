import { strict as assert } from "node:assert"
import { test } from "node:test"

import { apiSyncProblems, fnv1aHex, recordedSources } from "./api-sync.ts"

// The same vectors as `crates/shared-data/src/fingerprint.rs`: if the two
// sides ever differ, every app's `check:api` reports every file as stale.
test("fnv1aHex matches the Rust tool's fingerprint", () => {
  assert.equal(fnv1aHex(new Uint8Array()), "cbf29ce484222325")
  assert.equal(fnv1aHex(new TextEncoder().encode("hello")), "a430d84680aabd0b")
})

test("recordedSources reads both meta.json shapes", () => {
  const dataDir = recordedSources({ kilder: [{ fil: "cv.json", fingeravtrykk: "aa" }] }, "data-dir")
  assert.deepEqual([...(dataDir ?? [])], [["data/cv.json", "aa"]])
  const listed = recordedSources({ sources: [{ file: "../cv/data/cv.json", fingerprint: "bb" }] }, "listed")
  assert.deepEqual([...(listed ?? [])], [["../cv/data/cv.json", "bb"]])
  assert.equal(recordedSources({}, "data-dir"), null)
})

test("apiSyncProblems names a changed, a vanished and an unrecorded file", () => {
  const recorded = new Map([
    ["data/a.json", fnv1aHex(new TextEncoder().encode("a"))],
    ["data/b.json", "0000000000000000"],
    ["data/gone.json", "1111111111111111"],
  ])
  const files: Record<string, string> = { "data/a.json": "a", "data/b.json": "b", "data/new.json": "n" }
  const read = (path: string) => (path in files ? new TextEncoder().encode(files[path]) : null)
  assert.deepEqual(apiSyncProblems(recorded, read, ["data/a.json", "data/b.json", "data/new.json"]), [
    "data/b.json has changed",
    "data/gone.json is gone",
    "data/new.json is not read by data-rust",
  ])
})
