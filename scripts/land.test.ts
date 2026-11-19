import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { land } from "./land.ts"
import { manifestText, planLanding } from "./land-plan.ts"

test("a landing copies what is new, skips what is there and refuses what differs", () => {
  const plan = planLanding(
    [
      { path: "a", sha256: "1" },
      { path: "b", sha256: "2" },
      { path: "c", sha256: "3" },
    ],
    [
      { path: "b", sha256: "2" },
      { path: "c", sha256: "x" },
    ],
  )
  assert.deepEqual(plan, { copy: ["a"], already: ["b"], conflicts: ["c"] })
})

test("the manifest is sha256sum's form, sorted", () => {
  assert.equal(manifestText("2026-10-09", [{ path: "b", sha256: "2" }, { path: "a", sha256: "1" }]), "1  2026-10-09/a\n2  2026-10-09/b\n")
})

test("landing a folder keeps the original, locks the copy and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "land-"))
  try {
    const from = join(dir, "export")
    mkdirSync(join(from, "sub"), { recursive: true })
    writeFileSync(join(from, "a.json"), "one")
    writeFileSync(join(from, "sub", "b.json"), "two")
    const raw = join(dir, "raw")

    assert.deepEqual(land(from, raw, "demo", "2026-10-09", true).plan.copy.length, 2)
    assert.throws(() => statSync(join(raw, "demo")), "a dry run writes nothing")

    land(from, raw, "demo", "2026-10-09", false)
    assert.equal(readFileSync(join(raw, "demo", "2026-10-09", "sub", "b.json"), "utf8"), "two")
    assert.equal(readFileSync(join(from, "a.json"), "utf8"), "one", "the original stays")
    assert.equal(statSync(join(raw, "demo", "2026-10-09", "a.json")).mode & 0o222, 0, "the copy is read-only")
    assert.match(readFileSync(join(raw, "demo", "2026-10-09.sha256"), "utf8"), /2026-10-09\/sub\/b\.json/)

    const again = land(from, raw, "demo", "2026-10-09", false)
    assert.deepEqual([again.plan.copy.length, again.plan.already.length], [0, 2])

    chmodSync(join(from, "a.json"), 0o644)
    writeFileSync(join(from, "a.json"), "changed")
    const refused = land(from, raw, "demo", "2026-10-09", false)
    assert.deepEqual(refused.plan.conflicts, ["a.json"])
    assert.equal(readFileSync(join(raw, "demo", "2026-10-09", "a.json"), "utf8"), "one", "a landed original is never rewritten")
  } finally {
    spawnSync("chmod", ["-R", "u+w", dir])
    rmSync(dir, { recursive: true, force: true })
  }
})
