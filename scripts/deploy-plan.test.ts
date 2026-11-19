import { strict as assert } from "node:assert"
import { test } from "node:test"

import { type DeployStep, isDryRun, isForced, planDeploy } from "./deploy-plan.ts"

const BUILT_CONFIG = "web/dist/server/wrangler.json"

const indexOfStep = (steps: DeployStep[], matches: (step: DeployStep) => boolean): number => steps.findIndex(matches)
const isBindingsCheck = (file: string) => (step: DeployStep) => step.kind === "assertNoBindings" && step.file === file
const startsWith = (...args: string[]) => (step: DeployStep) => (step.kind === "run" || step.kind === "deployIfChanged") && args.every((arg, index) => step.args[index] === arg)

test("bindings are checked, the snapshot written, the app built, its config and bundles checked, then deployed", () => {
  assert.deepEqual(planDeploy(), [
    { kind: "assertNoBindings", file: "wrangler.jsonc" },
    { kind: "run", command: "npm", args: ["run", "snapshot"] },
    { kind: "run", command: "npm", args: ["run", "build"] },
    { kind: "assertNoBindings", file: BUILT_CONFIG },
    { kind: "assertNoDevtools", directory: "web/dist" },
    { kind: "deployIfChanged", directory: "web/dist", command: "npx", args: ["wrangler", "deploy", "--config", BUILT_CONFIG] },
  ])
})

test("an app with no data of its own has no snapshot step", () => {
  assert.ok(!planDeploy({ snapshot: false }).some(startsWith("run", "snapshot")))
})

test("nothing is deployed before the built config is checked for bindings and the build for devtools", () => {
  const steps = planDeploy()
  const check = indexOfStep(steps, isBindingsCheck(BUILT_CONFIG))
  const scan = indexOfStep(steps, (step) => step.kind === "assertNoDevtools")
  const deploy = indexOfStep(steps, startsWith("wrangler", "deploy"))
  assert.ok(check !== -1 && scan !== -1 && deploy > check && deploy > scan, `check ${check}, scan ${scan}, deploy ${deploy}`)
})

test("a dry run is asked for with the flag or through npm's own variable", () => {
  assert.equal(isDryRun(["--dry-run"], {}), true)
  assert.equal(isDryRun([], { npm_config_dry_run: "true" }), true)
  assert.equal(isDryRun([], {}), false)
})

test("a forced deploy is asked for with the flag or DEPLOY_FORCE", () => {
  assert.equal(isForced(["--force"], {}), true)
  assert.equal(isForced([], { DEPLOY_FORCE: "1" }), true)
  assert.equal(isForced([], {}), false)
})
