/**
 * What `npm run verify` runs and what it reads out of a diff, as data and pure functions, so a test can
 * pin the choice of steps and the scan without a shell, a build or git. The effects are `verify.ts`'s.
 */

export interface VerifyStep {
  name: string
  command: string
}

const WEB_STEPS: readonly VerifyStep[] = [
  { name: "lint", command: "npm run -s lint" },
  { name: "typecheck", command: "npm run -s typecheck" },
  { name: "test", command: "npm test --silent" },
  { name: "build", command: "npm run -s build" },
  { name: "dupes", command: "npm run -s dupes" },
  { name: "skills", command: "npm run -s skills:check" },
]

const RUST_STEPS: readonly VerifyStep[] = [
  { name: "clippy", command: "cargo clippy --workspace -q -- -D warnings" },
  { name: "cargo test", command: "cargo test --workspace -q" },
]

/** Whether a changed path is Rust or what builds it. */
export function touchesRust(files: readonly string[]): boolean {
  return files.some((file) => file.endsWith(".rs") || file === "Cargo.toml" || file === "Cargo.lock" || file.endsWith("/Cargo.toml"))
}

/** The checks AGENTS.md asks for before a change is called done; Rust's only when Rust changed. */
export function stepsFor(files: readonly string[]): VerifyStep[] {
  return [...WEB_STEPS, ...(touchesRust(files) ? RUST_STEPS : [])]
}

const SCANNED = /\.(ts|tsx|rs)$/
const NOT_SCANNED = /(^|\/)verify-plan(\.test)?\.ts$/
// Built from parts so this file does not match its own scan.
const DEBUG_CALL = new RegExp(String.raw`\b(console\.` + `log|dbg!)\\(`)
/** Command-line scripts answer on stdout; the rule is about what an app or package leaves behind. */
const PRINTS_ON_PURPOSE = /^(scripts|e2e|scripts-local)\//
const COMMENTED_CODE = /^\s*(\/\/|\/\*)\s*(const|let|var|import|export|function|return|await|pub fn|fn|use|let mut)\s/

export interface Violation {
  file: string
  line: number
  kind: "debug call" | "commented-out code"
  text: string
}

/** Added lines of a unified diff that break rule 5: a debug call or code left in a comment. */
export function diffViolations(diff: string): Violation[] {
  const found: Violation[] = []
  let file = ""
  let line = 0
  for (const text of diff.split("\n")) {
    if (text.startsWith("+++ ")) {
      file = text.slice(4).replace(/^b\//, "")
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text)
    if (hunk !== null) {
      line = Number(hunk[1]) - 1
      continue
    }
    if (text.startsWith("-") || text.startsWith("\\")) continue
    line += 1
    if (!text.startsWith("+") || text.startsWith("+++") || !SCANNED.test(file) || NOT_SCANNED.test(file)) continue
    const added = text.slice(1)
    if (DEBUG_CALL.test(added) && !PRINTS_ON_PURPOSE.test(file)) found.push({ file, line, kind: "debug call", text: added.trim() })
    else if (COMMENTED_CODE.test(added)) found.push({ file, line, kind: "commented-out code", text: added.trim() })
  }
  return found
}

/** A file's lines as the diff that adds all of it, for files git does not track yet. */
export function asAddedDiff(file: string, content: string): string {
  const lines = content.split("\n")
  if (lines.at(-1) === "") lines.pop()
  return [`+++ b/${file}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join("\n")
}

/** The last `count` lines of a log, with a first line saying how many were left out. */
export function tail(output: string, count: number): string {
  const lines = output.trimEnd().split("\n")
  if (lines.length <= count) return lines.join("\n")
  return [`… ${lines.length - count} earlier lines in the log`, ...lines.slice(-count)].join("\n")
}

/** What a failed step shows: the failing tests with their errors when the log is TAP, else the end of the log. */
export function failureSummary(output: string, count: number): string {
  const lines = output.split("\n")
  const wanted = lines.filter((line) => /^\s*(not ok\b|error:|location:)/.test(line))
  return wanted.some((line) => line.trimStart().startsWith("not ok")) ? tail(wanted.join("\n"), count) : tail(output, count)
}
