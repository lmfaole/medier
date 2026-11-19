import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { gatingRuns, hashTree, newSinceLastPublish, shouldPublish } from "./publish-plan.ts"
import { publishersOf } from "./publish-schedule.ts"

test("a changed snapshot is published after a good sync, and nothing else is", () => {
  assert.deepEqual(shouldPublish({ syncsOk: true, hash: "b", publishedHash: "a" }), { publish: true })
  assert.deepEqual(shouldPublish({ syncsOk: true, hash: "a", publishedHash: null }), { publish: true })
  assert.equal(shouldPublish({ syncsOk: true, hash: "a", publishedHash: "a" }).publish, false)
  assert.equal(shouldPublish({ syncsOk: false, hash: "b", publishedHash: "a" }).publish, false)
})

test("the hash of a tree follows what is in it and what the files are called", () => {
  const directory = mkdtempSync(join(tmpdir(), "publish-"))
  mkdirSync(join(directory, "api"))
  writeFileSync(join(directory, "api", "a.json"), "{}")
  const first = hashTree(directory)
  assert.equal(hashTree(directory), first)
  writeFileSync(join(directory, "api", "a.json"), '{"x":1}')
  assert.notEqual(hashTree(directory), first)
})

test("only the listed jobs of a source hold a publication back, and every job of a source with no list", () => {
  const runs = [
    { source: "music", job: "sync-lastfm" },
    { source: "music", job: "entities" },
    { source: "film", job: "import-log" },
    { source: "film", job: "tmdb" },
  ]
  const publishing = { sources: ["music", "film"], jobs: { music: ["sync-lastfm"] } }
  assert.deepEqual(gatingRuns(runs, publishing).map((run) => run.job), ["sync-lastfm", "import-log", "tmdb"])
})

test("an ignored job never holds a publication back, whatever arguments the log kept with its name", () => {
  const runs = [
    { source: "music", job: "entities" },
    { source: "music", job: "likes-push 50" },
    { source: "music", job: "spotify-recent" },
  ]
  const publishing = { sources: ["music"], ignoring: { music: ["likes-push", "spotify-recent"] } }
  assert.deepEqual(gatingRuns(runs, publishing).map((run) => run.job), ["entities"])
})

test("a sync starts the publication of every app that shows its data", () => {
  assert.deepEqual(publishersOf("music"), ["forside"])
  assert.deepEqual(publishersOf("work"), ["work"])
  assert.deepEqual(publishersOf("nothing"), [])
})

test("the snapshot is built again only when a run finished after the last good publication started", () => {
  const last = { startedAt: "2026-11-04T18:40:00.000Z", finishedAt: "2026-11-04T18:43:00.000Z", ok: true }
  assert.equal(newSinceLastPublish(undefined, []), true)
  assert.equal(newSinceLastPublish({ ...last, ok: false }, []), true)
  assert.equal(newSinceLastPublish({ ...last, finishedAt: null }, []), true)
  assert.equal(newSinceLastPublish(last, [{ finishedAt: "2026-11-04T18:20:00.000Z" }, { finishedAt: null }]), false)
  assert.equal(newSinceLastPublish(last, [{ finishedAt: "2026-11-04T18:41:00.000Z" }]), true)
})
