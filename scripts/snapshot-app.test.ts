import { strict as assert } from "node:assert"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import { snapshotApp } from "./snapshot-app.ts"

const root = resolve(import.meta.dirname, "..")

function emptyDatabase(name = "music"): string {
  const file = join(mkdtempSync(join(tmpdir(), "snapshot-db-")), `${name}.db`)
  new DatabaseSync(file).close()
  return file
}

/** A migrations root with one baseline for each of the domains. */
function migrationsFor(...names: string[]): string {
  const base = mkdtempSync(join(tmpdir(), "snapshot-migrations-"))
  for (const name of names) {
    mkdirSync(join(base, name))
    writeFileSync(join(base, name, "0001-baseline.sql"), "SELECT 1")
  }
  return base
}

/** A snapshot of music from an empty database into a fresh public directory. */
async function snapshotMusic(extra: Partial<Parameters<typeof snapshotApp>[0]> = {}): Promise<{ written: string[]; publicDirectory: string }> {
  const publicDirectory = mkdtempSync(join(tmpdir(), "snapshot-public-"))
  const written = await snapshotApp({ appDirectory: join(root, "apps", "music"), rootDirectory: root, databaseFiles: { music: emptyDatabase() }, publicDirectory, ...extra })
  return { written, publicDirectory }
}

test("a table with no rows yet is an empty list, not a missing table", async () => {
  const { written, publicDirectory } = await snapshotMusic()

  assert.ok(written.includes("/api/periods.json"))
  assert.deepEqual(JSON.parse(readFileSync(join(publicDirectory, "api", "periods.json"), "utf8")), [])
})

test("a file that cannot be built yet is reported and left out, so the rest still ships", async () => {
  const skipped: string[] = []
  const { written, publicDirectory } = await snapshotMusic({ log: (message) => skipped.push(message) })

  assert.match(skipped.join("\n"), /skipped \/api\/history\.json: it has no answer/)
  assert.equal(existsSync(join(publicDirectory, "api", "history.json")), false)
  assert.ok(written.includes("/api/periods.json"), "the files that could be built are still written")
})

test("music has a file for each period its page asks for", async () => {
  const { written } = await snapshotMusic()

  assert.ok(written.includes("/api/periods.json"))
  assert.ok(written.includes("/api/recent.json"))
})

test("a database behind the latest migration is refused with the command to run", async () => {
  const file = emptyDatabase()
  const migrations = migrationsFor("music")
  writeFileSync(join(migrations, "music", "0002-add-column.sql"), "SELECT 1")
  const sqlite = new DatabaseSync(file)
  sqlite.exec("CREATE TABLE something (x INTEGER); PRAGMA user_version = 1")
  sqlite.close()

  await assert.rejects(
    snapshotApp({ appDirectory: join(root, "apps", "music"), rootDirectory: root, databaseFiles: { music: file }, migrationsRoot: migrations, publicDirectory: mkdtempSync(join(tmpdir(), "snapshot-public-")) }),
    /npm run data:migrate/,
  )
})

test("an empty database is not behind: the snapshot applies the schema to it and stamps it, so the next snapshot does not refuse it", async () => {
  const file = emptyDatabase()
  const options = { appDirectory: join(root, "apps", "music"), rootDirectory: root, databaseFiles: { music: file }, migrationsRoot: migrationsFor("music"), publicDirectory: mkdtempSync(join(tmpdir(), "snapshot-public-")) }
  await snapshotApp(options)
  await snapshotApp(options)
  const sqlite = new DatabaseSync(file)
  assert.deepEqual(sqlite.prepare("PRAGMA user_version").all().map((row) => row["user_version"]), [1])
  sqlite.close()
})

test("an app that reads two domains gets the first as its database and the second under its own name", async () => {
  const appDirectory = mkdtempSync(join(tmpdir(), "snapshot-app-"))
  const server = join(appDirectory, "web", "src", "server")
  mkdirSync(server, { recursive: true })
  writeFileSync(
    join(server, "api.ts"),
    'export const DOMAINS = ["cv", "github"]\nexport const API = { days: async (db) => ({ days: await db.prepare("SELECT count(*) AS n FROM github.github_days").first("n"), people: await db.prepare("SELECT count(*) AS n FROM cv_person").first("n") }) }\n',
  )
  const github = emptyDatabase("github")
  const publicDirectory = mkdtempSync(join(tmpdir(), "snapshot-public-"))
  const seed = new DatabaseSync(github)
  seed.exec("CREATE TABLE github_days (day TEXT PRIMARY KEY, contributions INTEGER NOT NULL); INSERT INTO github_days VALUES ('2026-01-01', 3), ('2026-01-02', 5); PRAGMA user_version = 1")
  seed.close()

  await snapshotApp({ appDirectory, rootDirectory: root, databaseFiles: { cv: emptyDatabase("cv"), github }, migrationsRoot: migrationsFor("cv", "github"), publicDirectory })

  assert.deepEqual(JSON.parse(readFileSync(join(publicDirectory, "api", "days.json"), "utf8")), { days: { n: 2 }, people: { n: 0 } })
})

test("the snapshot says when the app's sync last ran well, and nothing of the jobs", async () => {
  const platform = join(mkdtempSync(join(tmpdir(), "snapshot-platform-")), "platform.db")
  const runLog = new DatabaseSync(platform)
  runLog.exec(readFileSync(join(root, "db", "platform.sql"), "utf8"))
  runLog.exec("INSERT INTO sync_runs (source, job, started_at, finished_at, ok, error, added) VALUES ('music', 'sync listens', '2026-10-22T02:00:00Z', '2026-10-22T02:03:00Z', 1, NULL, 4)")
  runLog.close()
  const options = { appDirectory: join(root, "apps", "music"), rootDirectory: root, migrationsRoot: migrationsFor("music"), publicDirectory: mkdtempSync(join(tmpdir(), "snapshot-public-")) }

  await snapshotApp({ ...options, databaseFiles: { music: emptyDatabase(), platform } })

  assert.deepEqual(JSON.parse(readFileSync(join(options.publicDirectory, "api", "oppdatert.json"), "utf8")), {
    finishedAt: "2026-10-22T02:03:00Z",
    added: 4,
    one: "avspilling",
    many: "avspillinger",
  })
})
