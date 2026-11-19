/**
 * Builds and deploys the app in the current directory (`apps/<name>`), run as
 * its `npm run deploy`, locally or as a Workers Build's deploy command. What it does, and
 * in which order, is `planDeploy` in `deploy-plan.ts`, and when it stops is
 * `executePlan` in `deploy-run.ts`; this gives them the real effects.
 *
 * `--dry-run` prints the plan and runs none of it, so a deploy can be read
 * before it is made. */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { forbiddenBindings } from "@designsystem/config/bindings-config"

import { hashBuilt, readHash, writeHash } from "./deploy-hash.ts"
import { filesWithDevtools, halvesWithoutFiles, readDistFiles } from "./check-bundles.ts"
import { acquireLock, fileLockIo } from "./deploy-lock.ts"
import { formatStep, isDryRun, isForced, planDeploy } from "./deploy-plan.ts"
import { executePlan } from "./deploy-run.ts"

const app = basename(process.cwd())
const hashFile = join(import.meta.dirname, "..", ".data", "published", `${app}.dist.sha256`)
const wranglerVersion = (): string => {
  try {
    return String(JSON.parse(readFileSync(join(import.meta.dirname, "..", "node_modules", "wrangler", "package.json"), "utf8")).version)
  } catch {
    return ""
  }
}

const plan = planDeploy({ snapshot: existsSync("web/src/server/api.ts") })

if (isDryRun(process.argv, process.env)) {
  for (const step of plan) console.log(formatStep(step))
} else {
  // One deploy per app: a second build in the same web/dist deletes the first one's built config before it is deployed.
  const release = acquireLock(join(process.env["XDG_RUNTIME_DIR"] ?? tmpdir(), `deploy-${basename(process.cwd())}.lock`), process.pid, {
    ...fileLockIo,
    report: (message) => console.error(`${basename(process.cwd())}: ${message}`),
  })
  process.once("exit", release)
  process.exitCode = executePlan(plan, {
    run: (command, args, env = {}) => {
      console.log(`$ ${command} ${args.join(" ")}`)
      execFileSync(command, args, { stdio: "inherit", env: { ...process.env, ...env } })
    },
    forbiddenBindings: (file) => forbiddenBindings(readFileSync(file, "utf8")),
    devtoolsIn: (directory) => {
      const files = readDistFiles(directory)
      const unread = halvesWithoutFiles(files)
      if (unread.length > 0) throw new Error(`${directory} has no built ${unread.join(" or ")} files, so it cannot be scanned for devtools`)
      return filesWithDevtools(files).map((path) => `${directory}/${path}`)
    },
    report: (message) => console.error(`${app}: ${message}`),
    builtHash: (directory) => hashBuilt(directory, wranglerVersion()),
    deployedHash: () => readHash(hashFile),
    recordDeployed: (hash) => writeHash(hashFile, hash),
    force: isForced(process.argv, process.env),
  })
}
