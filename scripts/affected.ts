/**
 * `npm run affected [-- --since <ref>]`: lint, typecheck and the tests of only what changed, in one short
 * answer, for the loop between edits. Changed means the working tree, or everything since `<ref>`.
 * `npm run verify` is still the whole gate before a change is called done.
 */

import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { checksFor, unitsOf } from "./affected-plan.ts"
import { runParallel } from "./run-parallel.ts"
import { failureSummary } from "./verify-plan.ts"

const root = join(import.meta.dirname, "..")
const args = process.argv.slice(2)
const since = args[args.indexOf("--since") + 1]

function git(...gitArgs: string[]): string {
  return spawnSync("git", gitArgs, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout
}

const files =
  args.includes("--since") && since !== undefined
    ? git("diff", "--name-only", since).split("\n")
    : git("status", "--porcelain", "-uall")
        .split("\n")
        .filter((entry) => entry.length > 3)
        .map((entry) => entry.slice(3).split(" -> ").at(-1) ?? "")
const units = unitsOf(files.filter((file) => file !== ""))
const checks = checksFor(units)

if (checks.length === 0) {
  console.log("nothing to check: no app, package, script or e2e file changed")
} else {
  const logs = join(root, ".data", "tmp", "affected")
  mkdirSync(logs, { recursive: true })
  const results = await runParallel(checks.map((check) => check.command))
  for (const [index, result] of results.entries()) {
    const name = checks[index]?.name ?? result.command
    writeFileSync(join(logs, `${name.replace(/\W+/g, "-")}.log`), result.output)
    console.log(result.code === 0 ? `ok     ${name}` : `FAILED ${name}\n${failureSummary(result.output, 30)}\n`)
  }
  process.exitCode = results.some((result) => result.code !== 0) ? 1 : 0
}
if (units.other.length > 0) console.log(`not covered here (run npm run verify): ${units.other.join(", ")}`)
if (units.crates) console.log("not covered here: crates (run npm run verify, it runs clippy and cargo test)")
