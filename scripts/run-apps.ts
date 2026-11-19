// Runs one npm script across every app's outer package.json (the Worker +
// Rust-data side, in `apps/<name>`), not just its `web/` workspace.
//
// `apps/<name>` is deliberately not an npm workspace (see `dev-all.ts`): it
// mixes Cargo, Wrangler and D1 commands that do not fit the uniform
// "install once, run the same script everywhere" shape npm workspaces
// assume. That means `npm run lint --workspaces` silently never touches
// `apps/*/src` at all — this script is what root's `lint`/`build`/
// `typecheck`/`check` actually rely on to reach it. Each app's own `lint`/
// `check` already chains its worker and its `web/` workspace together, so
// running it once here covers both sides without double-running `web/`.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { APPS, partitionByScript } from "./apps.ts"

const rootDirectory = join(import.meta.dirname, "..")

/** Runs `script` in every app that has it; the exit code is 1 if any run failed. */
function runEverywhere(script: string): number {
  const { run, skipped } = partitionByScript(
    APPS.map((app) => app.name),
    (appName) => {
      const packageJson: { scripts?: Record<string, string> } = JSON.parse(readFileSync(join(rootDirectory, "apps", appName, "package.json"), "utf8"))
      return Boolean(packageJson.scripts?.[script])
    },
  )
  for (const appName of skipped) console.log(`[${appName}] no "${script}" script, skipped`)

  let failed = false
  for (const appName of run) {
    console.log(`[${appName}] npm run ${script}`)
    try {
      execFileSync("npm", ["run", script], {
        cwd: join(rootDirectory, "apps", appName),
        stdio: "inherit",
        shell: process.platform === "win32",
      })
    } catch {
      failed = true
    }
  }
  return failed ? 1 : 0
}

const script = process.argv[2]
if (script) {
  process.exitCode = runEverywhere(script)
} else {
  console.error("Usage: node scripts/run-apps.ts <npm-script>")
  process.exitCode = 1
}
