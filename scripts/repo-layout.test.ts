import { strict as assert } from "node:assert"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { DATABASES } from "./data.ts"

const root = join(import.meta.dirname, "..")

interface PackageJson {
  exports?: Record<string, unknown>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readPackage(directory: string): PackageJson {
  return JSON.parse(readFileSync(join(root, directory, "package.json"), "utf8"))
}

test("every package export points at a file that exists", () => {
  for (const packageName of ["ui", "config"]) {
    const directory = join("packages", packageName)
    for (const [key, target] of Object.entries(readPackage(directory).exports ?? {})) {
      if (key.includes("*") || typeof target !== "string") continue
      assert.ok(existsSync(join(root, directory, target)), `${directory}: "${key}" points at ${target}, which does not exist`)
    }
  }
})

test("worker-app no longer carries the asset-only path", async () => {
  const workerApp = await import("../packages/config/worker-app.ts")
  assert.equal("d1JsonRoute" in workerApp, false)
})

test("no Worker binds a database, a bucket or a key-value store, in any env", () => {
  for (const app of readdirSync(join(root, "apps"))) {
    const file = join(root, "apps", app, "wrangler.jsonc")
    if (!existsSync(file)) continue
    const config = readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "")
    for (const binding of ["d1_databases", "r2_buckets", "kv_namespaces", "hyperdrive", "vpc_services"]) {
      assert.ok(!config.includes(binding), `apps/${app}/wrangler.jsonc binds ${binding}`)
    }
  }
})

test("every database has a schema, a migrations folder and a registry entry in both languages, and is git-ignored", () => {
  const rust = readFileSync(join(root, "crates", "data-migrate", "src", "main.rs"), "utf8")
  const inRust = [...rust.matchAll(/^\s*\("(\w+)", "\w+_DB", "\.data\/\w+\.db", include_str!/gm)].map((match) => match[1])
  assert.deepEqual(inRust.toSorted(), [...DATABASES].toSorted(), "crates/data-migrate/src/main.rs lists other databases than scripts/data.ts")
  for (const name of DATABASES) {
    assert.ok(existsSync(join(root, "db", `${name}.sql`)), `db/${name}.sql is missing`)
    assert.ok(existsSync(join(root, "db", "migrations", name, "0001-baseline.sql")), `db/migrations/${name}/0001-baseline.sql is missing`)
  }
  // The only other .sql file is a seed, named in the one place that applies it.
  assert.deepEqual(readdirSync(join(root, "db")).filter((file) => file.endsWith(".sql") && !DATABASES.some((name) => file === `${name}.sql`)), ["podcast-countries.sql", "podcast-feeds.sql", "podcast-shows.sql"])
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /^\.data\/?$/m)
})
