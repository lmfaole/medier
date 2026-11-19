import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { after, before, test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { createAppHost, type AppHost } from "./media-app-host.ts"

let directory = ""
let host: AppHost

before(async () => {
  directory = mkdtempSync(join(tmpdir(), "media-app-host-"))
  mkdirSync(join(directory, "migrations", "film"), { recursive: true })
  writeFileSync(join(directory, "migrations", "film", "0001-baseline.sql"), "")
  writeFileSync(join(directory, "migrations", "film", "0002-more.sql"), "")
  const film = new DatabaseSync(join(directory, "film.db"))
  film.exec("CREATE TABLE film(id); INSERT INTO film VALUES (1), (2); PRAGMA user_version = 2")
  film.close()
  // The app's own API module, as the worker imports it: one loader that counts the rows.
  const api = join(directory, "api.ts")
  writeFileSync(api, 'export const DOMAINS = ["film"]\nexport const API = { count: async (db: { prepare(sql: string): { first<T>(): Promise<T | null> } }) => ({ films: (await db.prepare("SELECT count(*) AS n FROM film").first<{ n: number }>())?.n }) }\n')
  host = createAppHost({
    name: "film",
    base: "/apps/film",
    apiModule: pathToFileURL(api).href,
    dataDirectory: directory,
    migrationsRoot: join(directory, "migrations"),
    volatile: {},
    warm: [],
    log: () => {},
  })
  await host.ready
})

after(async () => {
  await host.close()
  rmSync(directory, { recursive: true, force: true })
})

test("an answer comes from the app's worker, and asking again with its ETag is a 304", async () => {
  const first = await host.fetcher.fetch(new Request("http://app.test/apps/film/api/count.json"))
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), { films: 2 })
  const etag = first.headers.get("ETag")
  assert.ok(etag, "the answer carries its ETag")
  const again = await host.fetcher.fetch(new Request("http://app.test/apps/film/api/count.json", { headers: { "If-None-Match": etag } }))
  assert.equal(again.status, 304)
})

test("a name the app does not have is a 404, not a call into the worker", async () => {
  const missing = await host.fetcher.fetch(new Request("http://app.test/apps/film/api/nope.json"))
  assert.equal(missing.status, 404)
})

test("a file-backed app (DOMAINS = []) is served from the folder through the same host, with no database and no ETag", async () => {
  const folder = mkdtempSync(join(tmpdir(), "media-app-host-files-"))
  try {
    writeFileSync(join(folder, "status.json"), JSON.stringify({ n: 3 }))
    const api = join(folder, "api.ts")
    const files = new URL("../packages/config/apper-files.ts", import.meta.url).href
    writeFileSync(api, `import * as v from ${JSON.stringify(import.meta.resolve("valibot"))}\nimport { jsonFile } from ${JSON.stringify(files)}\nexport const DOMAINS = []\nexport const API = { status: jsonFile("status.json", v.object({ n: v.number() })) }\n`)
    const filesHost = createAppHost({ name: "stub", base: "/apps/hjemmeserver/stub", apiModule: pathToFileURL(api).href, dataDirectory: join(folder, "no-data"), migrationsRoot: join(folder, "no-migrations"), apperDirectory: folder, volatile: {}, warm: [], log: () => {} })
    try {
      await filesHost.ready
      const answer = await filesHost.fetcher.fetch(new Request("http://app.test/apps/hjemmeserver/stub/api/status.json"))
      assert.equal(answer.status, 200)
      assert.deepEqual(await answer.json(), { n: 3 })
      assert.equal(answer.headers.get("Cache-Control"), "no-store")
      assert.equal(answer.headers.get("ETag"), null)
      assert.equal((await filesHost.fetcher.fetch(new Request("http://app.test/apps/hjemmeserver/stub/api/other.json"))).status, 404)
    } finally {
      await filesHost.close()
    }
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
