// Runs every app's dev server at once, each on its own port, so the
// shared sidebar has somewhere to link to. Every app is on Astro, so
// `astro dev` runs its Worker too and there is nothing else to start. No
// dependencies: a one-off `concurrently` package would do the same job, but
// this repository has no runtime or dev dependencies, so a small built-in
// spawn loop replaces it.

import { type Readable } from "node:stream"
import { spawn } from "node:child_process"
import { join } from "node:path"

import { APPS } from "./apps.ts"

const rootDirectory = join(import.meta.dirname, "..")

// Each app's dev Worker gets its own inspector port: the plugin scans for a
// free one when no port is set, but dev:all starts every app at once and they
// all pick the same port before any has bound it (EADDRINUSE).
const INSPECTOR_PORT_BASE = 9229

/** Prefixes every line from `stream` with `[label]`, so interleaved output stays readable. */
function logPrefixed(stream: Readable, label: string): void {
  let buffer = ""
  stream.on("data", (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      console.log(`[${label}] ${line}`)
    }
  })
}

const children = APPS.flatMap(({ name, port }, index) => {
  if (port === undefined) return []
  const frontend = spawn("npm", ["run", "dev", "--workspace", `apps/${name}/web`, "--", "--port", String(port)], {
    cwd: rootDirectory,
    stdio: "pipe",
    shell: process.platform === "win32",
    env: { ...process.env, WORKER_INSPECTOR_PORT: String(INSPECTOR_PORT_BASE + index) },
  })
  logPrefixed(frontend.stdout, name)
  logPrefixed(frontend.stderr, name)
  return [frontend]
})

/** Stops every dev server when this script is interrupted, so none leak as orphans. */
function stopAll(): void {
  for (const child of children) {
    child.kill()
  }
}

// With the children stopped nothing keeps the process alive, so it ends on its own with code 0.
process.on("SIGINT", stopAll)
process.on("SIGTERM", stopAll)
