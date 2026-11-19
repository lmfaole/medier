/**
 * Runs shell commands at the same time and waits for all of them: the checks of a push (lint, typecheck,
 * test) and the typechecks of the packages do not depend on each other, so one after another is only slower.
 *
 *   node scripts/run-parallel.ts "npm run lint" "npm run typecheck"
 *
 * Each command's output is printed whole when it ends, under its own heading, so lines of different
 * commands never weave together; the exit code is 1 if any command failed.
 */

import { spawn } from "node:child_process"

export interface Result {
  command: string
  code: number
  output: string
}

function run(command: string): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()))
    child.on("error", (error) => resolve({ command, code: 1, output: output + String(error) }))
    child.on("close", (code) => resolve({ command, code: code ?? 1, output }))
  })
}

/** The results in the order the commands were given. */
export function runParallel(commands: string[]): Promise<Result[]> {
  return Promise.all(commands.map(run))
}

if (import.meta.filename === process.argv[1]) {
  const commands = process.argv.slice(2)
  const results = await runParallel(commands)
  for (const result of results) {
    console.log(`\n== ${result.command} (${result.code === 0 ? "ok" : `exit ${result.code}`})`)
    if (result.output.trim() !== "") console.log(result.output.trimEnd())
  }
  process.exitCode = results.some((result) => result.code !== 0) ? 1 : 0
}
