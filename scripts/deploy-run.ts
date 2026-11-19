/**
 * Carries out a deploy plan. Every effect (running a command, reading a config,
 * scanning a build, saying something) is passed in, so what the runner decides,
 * which is when a deploy stops, can be tested without a deploy.
 */

import type { DeployStep } from "./deploy-plan.ts"

/** What `deploy-app` prints when it skips the upload; `ship` reads it from the log to say "unchanged". */
export const UNCHANGED_MARK = "deploy skipped"

export interface DeployIo {
  /** Runs one command; throws when it fails. */
  run: (command: string, args: string[], env?: Record<string, string>) => void
  /** The data-store bindings the config at `file` has; empty when it binds none. */
  forbiddenBindings: (file: string) => string[]
  /** The files under `directory` that contain the devtools. */
  devtoolsIn: (directory: string) => string[]
  report: (message: string) => void
  /** One hash of the built output under `directory` (`deploy-hash.ts`). Optional: without it every deploy is made. */
  builtHash?: (directory: string) => string
  /** The hash of the output last deployed from this app; null when none is recorded. */
  deployedHash?: () => string | null
  /** Records the hash once `wrangler deploy` has succeeded. */
  recordDeployed?: (hash: string) => void
  /** Deploy even when the output is the one last deployed. */
  force?: boolean
}

/** Runs the steps in order and stops at the first refusal; the result is the exit code. A failed command throws. */
export function executePlan(steps: DeployStep[], io: DeployIo): number {
  for (const step of steps) {
    if (step.kind === "assertNoBindings") {
      const bound = io.forbiddenBindings(step.file)
      if (bound.length === 0) continue
      io.report(`refusing to deploy a Worker that binds a data store (${bound.join(", ")} in ${step.file})`)
      return 1
    }
    if (step.kind === "assertNoDevtools") {
      const flagged = io.devtoolsIn(step.directory)
      if (flagged.length === 0) continue
      io.report(`refusing to deploy a build that contains the devtools:\n${flagged.map((path) => `  ${path}`).join("\n")}`)
      return 1
    }
    if (step.kind === "deployIfChanged") {
      const hash = io.builtHash?.(step.directory) ?? null
      if (hash !== null && !io.force && hash === io.deployedHash?.()) {
        io.report(`${UNCHANGED_MARK}: ${step.directory} is the output last deployed, nothing to upload (--force deploys anyway)`)
        continue
      }
      io.run(step.command, step.args)
      if (hash !== null) io.recordDeployed?.(hash)
      continue
    }
    io.run(step.command, step.args, step.env)
  }
  return 0
}
