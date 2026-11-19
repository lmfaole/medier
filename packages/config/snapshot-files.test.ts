import { strict as assert } from "node:assert"
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { bareRequests, snapshotAnswers, writeSnapshot } from "./snapshot-files.ts"
import { fakeD1 } from "./worker-test-kit.ts"

test("writes each answer where the Worker reads it and drops the old snapshot", () => {
  const directory = mkdtempSync(join(tmpdir(), "snapshot-"))
  mkdirSync(join(directory, "api"))
  writeFileSync(join(directory, "api", "old.json"), "{}")

  const written = writeSnapshot(
    directory,
    new Map<string, unknown>([
      ["/api/cv.json", { person: "Ada" }],
      ["/api/charts.json?period=2024", { period: "2024" }],
    ]),
  )

  assert.deepEqual(written, ["/api/cv.json", "/api/charts/period=2024.json"])
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "api", "cv.json"), "utf8")), { person: "Ada" })
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "api", "charts", "period=2024.json"), "utf8")), { period: "2024" })
  assert.equal(existsSync(join(directory, "api", "old.json")), false)
})

test("a request that is no API file is an error", () => {
  const directory = mkdtempSync(join(tmpdir(), "snapshot-"))
  assert.throws(() => writeSnapshot(directory, new Map([["/nope", {}]])), /not a request/)
})

test("each request is answered by its own loader, with its parameters", async () => {
  const api = { charts: async (_db: D1Database, url: URL) => ({ period: url.searchParams.get("period") ?? "all" }) }
  const answers = await snapshotAnswers(api, fakeD1(() => []), ["/api/charts.json", "/api/charts.json?period=2024"])
  assert.deepEqual([...answers], [["/api/charts.json", { period: "all" }], ["/api/charts.json?period=2024", { period: "2024" }]])
})

test("a request no loader owns is an error", async () => {
  await assert.rejects(snapshotAnswers({}, fakeD1(() => []), ["/api/constructor.json"]), /not a file/)
})

test("a request that fails or has no answer is left out and reported, when someone is listening", async () => {
  const api = {
    broken: async () => { throw new Error("no such table: cv_person") },
    empty: async () => null,
    fine: async () => [1],
  }
  const skipped: string[] = []
  const answers = await snapshotAnswers(api, fakeD1(() => []), bareRequests(api), (request, reason) => skipped.push(`${request}: ${reason}`))
  assert.deepEqual([...answers.keys()], ["/api/fine.json"])
  assert.deepEqual(skipped, ["/api/broken.json: no such table: cv_person", "/api/empty.json: it has no answer"])
  await assert.rejects(snapshotAnswers(api, fakeD1(() => []), ["/api/broken.json"]), /no such table/)
})

test("an answer that would not read as its type after JSON stops the snapshot, even when someone is listening", async () => {
  const api = { rates: async () => ({ share: Number.NaN }), fine: async () => [1] }
  await assert.rejects(snapshotAnswers(api, fakeD1(() => []), ["/api/rates.json"], () => {}), /would not read as its type after JSON: \$\.share: NaN becomes null/)
  assert.equal((await snapshotAnswers(api, fakeD1(() => []), ["/api/fine.json"], () => {})).size, 1)
})
