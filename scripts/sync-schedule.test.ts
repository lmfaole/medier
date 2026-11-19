import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { jobsFor, missingVariables, parseEnv, parseSchedule, unitFiles, unitName, withCargoOnPath } from "./sync-schedule.ts"

const SCHEDULE = parseSchedule({
  requires: ["LISTENBRAINZ_USERNAME"],
  modes: { daily: ["listens", "summaries current-year"], all: ["summaries {mode}", "quiz"] },
  timers: [{ name: "daily", description: "Daily sync", mode: "daily", calendar: "*-*-* 03:17:00", timeout: "10min" }],
})

test("a mode's jobs are split into arguments, with the mode's own name filled in", () => {
  assert.deepEqual(jobsFor(SCHEDULE, "daily"), [["listens"], ["summaries", "current-year"]])
  assert.deepEqual(jobsFor(SCHEDULE, "all"), [["summaries", "all"], ["quiz"]])
})

test("an unknown mode says which ones exist", () => {
  assert.throws(() => jobsFor(SCHEDULE, "weekly"), /daily, all/)
})

test("a timer for a mode with no jobs is refused when the file is read", () => {
  assert.throws(() => parseSchedule({ requires: [], modes: {}, timers: [{ name: "x", description: "", mode: "daily", calendar: "", timeout: "" }] }), /no jobs/)
})

test("what runs after a mode is a script of this repository, nothing else, and none by default", () => {
  assert.deepEqual(parseSchedule({ requires: [], modes: {}, timers: [] }).after, [])
  assert.deepEqual(parseSchedule({ requires: [], modes: {}, after: ["scripts/x-export.ts"], timers: [] }).after, ["scripts/x-export.ts"])
  for (const script of ["/usr/bin/rm", "scripts/../x.ts", "scripts/x.sh", "rm -rf ."]) assert.throws(() => parseSchedule({ requires: [], modes: {}, after: [script], timers: [] }))
})

test("the env file is read like a shell would, without comments or quotes", () => {
  assert.deepEqual(parseEnv("# a comment\nLISTENBRAINZ_USERNAME=\"ole\"\nEMPTY=\n"), { LISTENBRAINZ_USERNAME: "ole", EMPTY: "" })
})

test("an empty variable counts as missing", () => {
  assert.deepEqual(missingVariables(SCHEDULE, { LISTENBRAINZ_USERNAME: "" }), ["LISTENBRAINZ_USERNAME"])
  assert.deepEqual(missingVariables(SCHEDULE, { LISTENBRAINZ_USERNAME: "ole" }), [])
})

test("the units run the given command and fire on the calendar", () => {
  const timer = SCHEDULE.timers[0]
  assert.ok(timer !== undefined)
  const units = unitFiles(timer, "/usr/bin/node scripts/sync-timers.ts music run daily")
  assert.equal(unitName("music", timer), "music-sync-daily")
  assert.match(units.service, /ExecStart=\/usr\/bin\/node scripts\/sync-timers.ts music run daily\nTimeoutStartSec=10min/)
  assert.match(units.timer, /OnCalendar=\*-\*-\* 03:17:00\nPersistent=true/)
})

test("cargo's own directory is put first on a PATH that lacks it, once", () => {
  assert.equal(withCargoOnPath("/usr/bin:/bin", "/home/me"), "/home/me/.cargo/bin:/usr/bin:/bin")
  assert.equal(withCargoOnPath("/home/me/.cargo/bin:/usr/bin", "/home/me"), "/home/me/.cargo/bin:/usr/bin")
  assert.equal(withCargoOnPath(undefined, "/home/me"), "/home/me/.cargo/bin")
})

test("the schedules the apps ship are valid and their timers name modes that have jobs", () => {
  for (const app of ["film", "tv", "music", "work", "podkast", "games", "books", "boardgames"]) {
    const schedule = parseSchedule(JSON.parse(readFileSync(join(import.meta.dirname, "..", "apps", app, "sync-rust", "schedule.json"), "utf8")))
    assert.ok(schedule.timers.length > 0, `${app} has a timer`)
  }
})
