import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"
import * as v from "valibot"

import { jsonFile, type FileApi } from "@designsystem/config/apper-files"

import { createFilesData, directorySource } from "./media-files.ts"

let directory = ""
const logged: string[] = []

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "media-files-"))
  mkdirSync(join(directory, "logg"))
  writeFileSync(join(directory, "status.json"), JSON.stringify({ at: "2026-11-12T10:00:00Z", failed: ["x"] }))
  writeFileSync(join(directory, "logg", "2026-10.json"), JSON.stringify({ month: "2026-10" }))
  logged.length = 0
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

const Status = v.object({ at: v.string(), failed: v.array(v.string()) })
const api: FileApi = {
  status: jsonFile("status.json", Status),
  log: async (source, url) => {
    const month = url.searchParams.get("month") ?? ""
    return JSON.parse((await source.read(`logg/${month}.json`)) ?? "null")
  },
  gone: jsonFile("gone.json", Status),
  traversal: async (source) => source.read("../outside.json"),
}
const data = () => createFilesData({ name: "stub", base: "/apps/hjemmeserver/stub", api, directory, log: (message) => logged.push(message) })
const ask = (path: string) => data().fetcher.fetch(new Request(`http://app.test/apps/hjemmeserver/stub${path}`))

test("a file is read only from the folder, by a plain name; anything else is not there", async () => {
  const source = directorySource(directory)
  assert.match((await source.read("status.json")) ?? "", /"failed"/)
  for (const name of ["../x.json", "/etc/passwd", "logg", "logg/../status.json", "missing.json", "status.txt", "logg/2026-10.json/x.json"]) assert.equal(await source.read(name), null, name)
  // A sibling folder of the same prefix must not pass for the folder itself.
  const sibling = `${directory}-other`
  mkdirSync(sibling)
  try {
    writeFileSync(join(sibling, "secret.json"), "{}")
    assert.equal(await source.read(`../${sibling.split("/").pop()}/secret.json`), null)
  } finally {
    rmSync(sibling, { recursive: true, force: true })
  }
})

test("an API file is the file parsed by its schema, never kept: no-store and no ETag, read fresh every time", async () => {
  const first = await ask("/api/status.json")
  assert.equal(first.status, 200)
  assert.equal(first.headers.get("Cache-Control"), "no-store")
  assert.equal(first.headers.get("ETag"), null)
  assert.deepEqual(await first.json(), { at: "2026-11-12T10:00:00Z", failed: ["x"] })
  writeFileSync(join(directory, "status.json"), JSON.stringify({ at: "later", failed: [] }))
  assert.deepEqual(await (await ask("/api/status.json")).json(), { at: "later", failed: [] })
})

test("a parameter picks a file below the folder, and an unsafe one is refused before any loader runs", async () => {
  assert.deepEqual(await (await ask("/api/log.json?month=2026-10")).json(), { month: "2026-10" })
  assert.equal((await ask("/api/log.json?month=2026-11")).status, 404)
  assert.equal((await ask("/api/log.json?month=../status")).status, 404)
})

test("a missing file, an unknown name and a name of Object.prototype are 404; a name that reaches out finds nothing", async () => {
  for (const path of ["/api/gone.json", "/api/nope.json", "/api/constructor.json", "/api/traversal.json", "/status.json", "/api/status.json/x"]) assert.equal((await ask(path)).status, 404, path)
})

test("a file that does not match its schema is a 502 and a log line, not an empty page; another failure is a 503", async () => {
  writeFileSync(join(directory, "status.json"), JSON.stringify({ at: 1, failed: [] }))
  const broken = await ask("/api/status.json")
  assert.equal(broken.status, 502)
  assert.equal(broken.headers.get("Cache-Control"), "no-store")
  assert.match(logged.join("\n"), /status\.json: .* at at/)
  writeFileSync(join(directory, "status.json"), "{")
  assert.equal((await ask("/api/status.json")).status, 502)
  const failing = createFilesData({ name: "stub", base: "/apps/hjemmeserver/stub", api: { boom: async () => Promise.reject(new Error("disk")) }, directory })
  assert.equal((await failing.fetcher.fetch(new Request("http://app.test/apps/hjemmeserver/stub/api/boom.json"))).status, 503)
})

test("the data layer has nothing to refresh or warm: a files app has no generation", async () => {
  const app = data()
  assert.equal(app.refresh(), false)
  assert.equal(app.generation(), 0)
  await app.warm(["/api/status.json"])
})
