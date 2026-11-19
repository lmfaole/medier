/**
 * `npm run verify`: the checks AGENTS.md asks for before a change is called done, in one call and
 * in one short answer. The steps run at the same time; a step that passes is one line, a step that
 * fails gets the end of its log, and every whole log is under `.data/tmp/verify/`. Rust runs only
 * when the change touches Rust, and the diff is read for the debug calls and commented-out code
 * the rules forbid.
 */

import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { runParallel } from "./run-parallel.ts"
import { asAddedDiff, diffViolations, failureSummary, stepsFor } from "./verify-plan.ts"

const root = join(import.meta.dirname, "..")
const LOG_LINES = 40

function git(...args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return result.stdout
}

/** Paths from `git status --porcelain`, and which of them git does not track yet. */
function changes(): { files: string[]; untracked: string[] } {
  const files: string[] = []
  const untracked: string[] = []
  // -z: raw paths, so a name with a space is not quoted. A rename lists its old path as the next entry.
  const entries = git("status", "--porcelain", "-z", "-uall").split("\0")
  for (let at = 0; at < entries.length; at++) {
    const entry = entries[at] ?? ""
    if (entry.length < 4) continue
    const path = entry.slice(3)
    if (entry[0] === "R" || entry[0] === "C") at++
    files.push(path)
    if (entry.startsWith("??")) untracked.push(path)
  }
  return { files, untracked }
}

const { files, untracked } = changes()
const steps = stepsFor(files)
const logs = join(root, ".data", "tmp", "verify")
mkdirSync(logs, { recursive: true })

const started = Date.now()
const results = await runParallel(steps.map((step) => step.command))
const seconds = ((Date.now() - started) / 1000).toFixed(0)
let failed = false

for (const [index, result] of results.entries()) {
  const name = steps[index]?.name ?? result.command
  const log = join(logs, `${name.replace(/\W+/g, "-")}.log`)
  writeFileSync(log, result.output)
  if (result.code === 0) {
    console.log(`ok     ${name}`)
    continue
  }
  failed = true
  console.log(`FAILED ${name} (exit ${result.code}, whole log: ${log})\n${failureSummary(result.output, LOG_LINES)}\n`)
}

const generated = git("status", "--porcelain", "--", "apps/*/web/src/generated/").trim()
if (generated !== "") {
  failed = true
  console.log(`FAILED generated types: uncommitted change under apps/*/web/src/generated/\n${generated}`)
}

const diff = [git("diff", "HEAD"), ...untracked.map((file) => asAddedDiff(file, readFileSync(join(root, file), "utf8")))].join("\n")
const violations = diffViolations(diff)
for (const violation of violations) console.log(`FAILED ${violation.kind}: ${violation.file}:${violation.line}  ${violation.text}`)
if (violations.length === 0) console.log("ok     diff (no debug calls, no commented-out code)")

console.log(`${failed || violations.length > 0 ? "NOT DONE" : "ALL OK"} in ${seconds}s`)
process.exitCode = failed || violations.length > 0 ? 1 : 0
