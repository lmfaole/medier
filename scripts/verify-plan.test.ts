import assert from "node:assert/strict"
import { test } from "node:test"

import { asAddedDiff, diffViolations, failureSummary, stepsFor, tail } from "./verify-plan.ts"

test("Rust steps are added only when Rust or Cargo files changed", () => {
  assert.deepEqual(stepsFor(["apps/film/web/src/a.ts"]).map((step) => step.name), ["lint", "typecheck", "test", "build", "dupes", "skills"])
  assert.ok(stepsFor(["apps/music/sync-rust/src/main.rs"]).some((step) => step.name === "clippy"))
  assert.ok(stepsFor(["Cargo.lock"]).some((step) => step.name === "cargo test"))
})

test("only added lines count, with the line number of the new file", () => {
  const diff = [
    "+++ b/packages/ui/a.ts",
    "@@ -1,3 +1,4 @@",
    " keep",
    "-console.log(old)",
    "+const ok = 1",
    "+console.log(x)",
    "+  // const gone = 2",
    " tail",
  ].join("\n")
  assert.deepEqual(
    diffViolations(diff).map(({ line, kind }) => [line, kind]),
    [
      [3, "debug call"],
      [4, "commented-out code"],
    ],
  )
})

test("a prose comment and a file that is not source are left alone", () => {
  const diff = ["+++ b/notes.md", "@@ -0,0 +1,1 @@", "+console.log(x)", "+++ b/a.ts", "@@ -0,0 +1,1 @@", "+// returns the total"].join("\n")
  assert.deepEqual(diffViolations(diff), [])
})

test("a command-line script may print, a package may not", () => {
  const added = (file: string) => diffViolations(asAddedDiff(file, "console.log(1)\n")).length
  assert.equal(added("scripts/a.ts"), 0)
  assert.equal(added("apps/film/web/src/a.ts"), 1)
})

test("a new file is scanned as all added", () => {
  assert.equal(diffViolations(asAddedDiff("a.rs", "fn a() {}\ndbg!(1);\n")).length, 1)
})

test("tail keeps the last lines and says what it cut", () => {
  assert.equal(tail("a\nb\nc\nd", 2), "… 2 earlier lines in the log\nc\nd")
  assert.equal(tail("a\nb", 5), "a\nb")
})

test("a failed test run shows the failing tests, not the passing ones", () => {
  const tap = ["ok 1 - a", "not ok 2 - b", "  error: 'boom'", "  location: 'x.ts:1:1'", "ok 3 - c"].join("\n")
  assert.equal(failureSummary(tap, 10), "not ok 2 - b\n  error: 'boom'\n  location: 'x.ts:1:1'")
  assert.equal(failureSummary("lint broke\nline 2", 10), "lint broke\nline 2")
})
