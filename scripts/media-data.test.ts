import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import type { ApiLoader } from "@designsystem/config/api-files"
import { readOnce } from "@designsystem/config/d1-read-once"

import { createAppData, type AppData, type AppDataOptions } from "./media-data.ts"

let directory = ""
let clock = 0

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "media-data-"))
  clock = 1_000_000
  mkdirSync(join(directory, "migrations", "film"), { recursive: true })
  writeFileSync(join(directory, "migrations", "film", "0001-baseline.sql"), "")
  writeFileSync(join(directory, "migrations", "film", "0002-more.sql"), "")
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

function database(name: string, version: number, statements: string): string {
  const file = join(directory, `${name}.db`)
  const sqlite = new DatabaseSync(file)
  sqlite.exec(`${statements}; PRAGMA user_version = ${version}`)
  sqlite.close()
  return file
}

const rows = (file: string, sql: string) => {
  const sqlite = new DatabaseSync(file)
  sqlite.exec(sql)
  sqlite.close()
  // The same instant would hide a change from a clock that only has milliseconds.
  const later = new Date(clock + 5000)
  utimesSync(file, later, later)
  clock += 5000
}

const countFilms: ApiLoader = async (db) => ({ films: (await db.prepare("SELECT count(*) AS n FROM film").first<{ n: number }>())?.n })

function setup(extra: Partial<AppDataOptions> = {}, api: Record<string, ApiLoader> = {}): AppData {
  return createAppData({
    name: "film",
    base: "/apps/film",
    api: { count: countFilms, ...api },
    domains: ["film"],
    fileOf: (domain) => join(directory, `${domain}.db`),
    platformFile: join(directory, "platform.db"),
    migrationsRoot: join(directory, "migrations"),
    now: () => clock,
    log: () => {},
    ...extra,
  })
}

const ask = (data: AppData, path: string, headers: Record<string, string> = {}) => data.fetcher.fetch(new Request(`http://app.test${path}`, { headers }))

test("an API file is the loader's answer, read from a read-only database", async () => {
  database("film", 2, "CREATE TABLE film(id); INSERT INTO film VALUES (1), (2)")
  const data = setup()
  const response = await ask(data, "/apps/film/api/count.json")
  assert.equal(response.status, 200)
  assert.match(response.headers.get("Content-Type") ?? "", /application\/json/)
  assert.deepEqual(await response.json(), { films: 2 })
  data.close()
})

test("the snapshot's file name and the query form are the same request", async () => {
  database("film", 2, "CREATE TABLE film(id)")
  const seen: string[] = []
  const data = setup({}, { echo: async (_db, url) => (seen.push(url.search), { search: url.search }) })
  assert.deepEqual(await (await ask(data, "/apps/film/api/echo.json?b=2&a=1")).json(), { search: "?a=1&b=2" })
  assert.deepEqual(await (await ask(data, "/apps/film/api/echo/a=1,b=2.json")).json(), { search: "?a=1&b=2" })
  assert.deepEqual(seen, ["?a=1&b=2"], "one computation: the second was the same key")
  data.close()
})

test("only names of the API are served: nothing from Object.prototype, nothing unknown", async () => {
  database("film", 2, "CREATE TABLE film(id)")
  const data = setup()
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "nope", "oppdatert"]) {
    assert.equal((await ask(data, `/apps/film/api/${name}.json`)).status, 404, name)
  }
  data.close()
})

test("a parameter outside the file-name rule is refused before any loader runs", async () => {
  database("film", 2, "CREATE TABLE film(id)")
  let calls = 0
  const data = setup({}, { echo: async () => (calls++, {}) })
  for (const path of ["/api/echo.json?x=../etc", "/api/echo.json?x=a%20b", "/api/echo.json?x=%27", "/api/echo.json?a+b=1", "/api/../echo.json", "/api/echo.json/extra", "/other"]) {
    assert.equal((await ask(data, `/apps/film${path}`)).status, 404, path)
  }
  assert.equal(calls, 0)
  data.close()
})

test("a loader that answers null or throws is a 404, and an answer that is not JSON-safe is a 500", async () => {
  database("film", 2, "CREATE TABLE film(id)")
  const log: string[] = []
  const data = setup({ log: (message) => log.push(message) }, { none: async () => null, boom: async () => Promise.reject(new Error("bad slug")), nan: async () => ({ x: Number.NaN }) })
  assert.equal((await ask(data, "/apps/film/api/none.json")).status, 404)
  assert.equal((await ask(data, "/apps/film/api/boom.json")).status, 404)
  assert.equal((await ask(data, "/apps/film/api/nan.json")).status, 500)
  assert.ok(log.some((line) => line.includes("bad slug")))
  assert.ok(log.some((line) => line.includes("JSON")))
  data.close()
})

test("a database behind the latest migration is refused, never migrated", async () => {
  database("film", 1, "CREATE TABLE film(id)")
  const data = setup()
  const response = await ask(data, "/apps/film/api/count.json")
  assert.equal(response.status, 503)
  data.close()
})

test("an empty database is not behind, and a missing one is unavailable", async () => {
  const empty = setup({}, { tables: async (db) => ({ n: (await db.prepare("SELECT count(*) AS n FROM sqlite_schema").first<{ n: number }>())?.n }) })
  database("film", 0, "")
  assert.equal((await ask(empty, "/apps/film/api/tables.json")).status, 200)
  rmSync(join(directory, "film.db"))
  const missing = setup()
  assert.equal((await ask(missing, "/apps/film/api/count.json")).status, 503)
})

test("nothing can be written through the loaders' connection", async () => {
  database("film", 2, "CREATE TABLE film(id)")
  const data = setup({}, { write: async (db) => (await db.prepare("INSERT INTO film VALUES (9)").run(), { ok: true }) })
  assert.equal((await ask(data, "/apps/film/api/write.json")).status, 404)
  assert.deepEqual(await (await ask(data, "/apps/film/api/count.json")).json(), { films: 0 })
  data.close()
})

test("the other domains are attached under their name, read-only", async () => {
  database("film", 2, "CREATE TABLE film(id)")
  database("tv", 0, "CREATE TABLE show(id); INSERT INTO show VALUES (1)")
  const data = setup({ domains: ["film", "tv"] }, { shows: async (db) => ({ n: (await db.prepare("SELECT count(*) AS n FROM tv.show").first<{ n: number }>())?.n }) })
  assert.deepEqual(await (await ask(data, "/apps/film/api/shows.json")).json(), { n: 1 })
  data.close()
})

test("an answer carries an ETag and is a 304 for the browser that has it", async () => {
  database("film", 2, "CREATE TABLE film(id)")
  const data = setup()
  const first = await ask(data, "/apps/film/api/count.json")
  const etag = first.headers.get("ETag")
  assert.match(etag ?? "", /^"[A-Za-z0-9_-]+"$/)
  const again = await ask(data, "/apps/film/api/count.json", { "If-None-Match": etag ?? "" })
  assert.equal(again.status, 304)
  assert.equal(await again.text(), "")
  assert.equal((await ask(data, "/apps/film/api/count.json", { "If-None-Match": `W/${etag}, "other"` })).status, 304)
  assert.equal((await ask(data, "/apps/film/api/count.json", { "If-None-Match": '"other"' })).status, 200)
  data.close()
})

test("an answer is computed once until the files change, and then again from a fresh connection", async () => {
  const file = database("film", 2, "CREATE TABLE film(id); INSERT INTO film VALUES (1)")
  let reads = 0
  const once = readOnce(async (db) => {
    reads += 1
    return (await db.prepare("SELECT count(*) AS n FROM film").first<{ n: number }>())?.n
  })
  const data = setup({}, { cached: async (db) => ({ n: await once(db) }) })
  const first = await ask(data, "/apps/film/api/cached.json")
  assert.deepEqual(await first.json(), { n: 1 })
  await ask(data, "/apps/film/api/cached.json")
  assert.equal(reads, 1)

  // The files are looked at once a second: right after, the change is not seen, a second later it is.
  rows(file, "INSERT INTO film VALUES (2)")
  clock -= 4500
  const generation = data.generation()
  assert.deepEqual(await (await ask(data, "/apps/film/api/cached.json")).json(), { n: 1 })
  clock += 4500
  const changed = await ask(data, "/apps/film/api/cached.json")
  assert.deepEqual(await changed.json(), { n: 2 })
  assert.equal(reads, 2, "the readOnce cache of the old wrapper was not reused")
  assert.equal(data.generation(), generation + 1)
  assert.notEqual(changed.headers.get("ETag"), first.headers.get("ETag"))
  data.close()
})

test("the files are looked at once a second at most", async () => {
  const file = database("film", 2, "CREATE TABLE film(id)")
  const data = setup()
  assert.equal(data.refresh(), false, "the first look only records")
  rows(file, "INSERT INTO film VALUES (1)")
  clock -= 5000
  assert.equal(data.refresh(), false, "too soon")
  clock += 1500
  assert.equal(data.refresh(), true)
  assert.equal(data.refresh(), false)
  data.close()
})

test("an answer that depends on the clock expires on its own", async () => {
  database("film", 2, "CREATE TABLE film(id)")
  let calls = 0
  const data = setup({ volatile: { clocked: 60_000 }, defaultTtlMs: 600_000, checkEveryMs: 10_000_000 }, { clocked: async () => ({ calls: ++calls }), steady: async () => ({ calls: ++calls }) })
  await ask(data, "/apps/film/api/clocked.json")
  await ask(data, "/apps/film/api/steady.json")
  clock += 59_000
  await ask(data, "/apps/film/api/clocked.json")
  assert.equal(calls, 2)
  clock += 2000
  assert.deepEqual(await (await ask(data, "/apps/film/api/clocked.json")).json(), { calls: 3 })
  await ask(data, "/apps/film/api/steady.json")
  assert.equal(calls, 3, "the steady one is still kept")
  clock += 600_000
  await ask(data, "/apps/film/api/steady.json")
  assert.equal(calls, 4)
  data.close()
})

test("two requests for the same answer at once share one computation", async () => {
  database("film", 2, "CREATE TABLE film(id)")
  let calls = 0
  const data = setup({}, { slow: async () => (calls++, await new Promise((done) => setTimeout(done, 20)), { calls }) })
  const [one, two] = await Promise.all([ask(data, "/apps/film/api/slow.json"), ask(data, "/apps/film/api/slow.json", { "If-None-Match": '"nope"' })])
  assert.equal(calls, 1)
  assert.equal(one.status, 200)
  assert.equal(two.status, 200)
  data.close()
})

test("oppdatert.json is the newest good run of the app in the run log, and a 404 where there is none", async () => {
  database("film", 2, "CREATE TABLE film(id)")
  const data = setup()
  assert.equal((await ask(data, "/apps/film/api/oppdatert.json")).status, 404, "no run log yet")
  database("platform", 0, "CREATE TABLE sync_runs(id INTEGER PRIMARY KEY, source TEXT, added INTEGER, ok INTEGER, finished_at TEXT); INSERT INTO sync_runs(source, added, ok, finished_at) VALUES ('film', 3, 1, '2026-11-01T10:00:00Z'), ('tv', 9, 1, '2026-11-02T10:00:00Z')")
  clock += 2000
  const response = await ask(data, "/apps/film/api/oppdatert.json")
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { finishedAt: "2026-11-01T10:00:00Z", added: 3, one: "visning", many: "visninger" })
  data.close()
})

test("warm asks for each request, so the first visitor finds it kept", async () => {
  database("film", 2, "CREATE TABLE film(id)")
  let calls = 0
  const data = setup({}, { heavy: async () => ({ calls: ++calls }) })
  await data.warm(["/api/heavy.json"])
  await ask(data, "/apps/film/api/heavy.json")
  assert.equal(calls, 1)
  data.close()
})

test("the cache stays within its budget, oldest first", async () => {
  database("film", 2, "CREATE TABLE film(id)")
  let calls = 0
  const data = setup({ maxCacheSize: 60 }, { big: async (_db, url) => ({ text: "x".repeat(30), key: url.search, calls: ++calls }) })
  for (const key of ["a", "b", "c", "d"]) await ask(data, `/apps/film/api/big.json?k=${key}`)
  assert.equal(calls, 4)
  await ask(data, "/apps/film/api/big.json?k=d")
  assert.equal(calls, 4, "the newest is kept")
  await ask(data, "/apps/film/api/big.json?k=a")
  assert.equal(calls, 5, "the oldest was dropped")
  data.close()
})
