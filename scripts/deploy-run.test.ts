import { strict as assert } from "node:assert"
import { test } from "node:test"

import type { DeployStep } from "./deploy-plan.ts"
import { type DeployIo, executePlan, UNCHANGED_MARK } from "./deploy-run.ts"

const BINDINGS: DeployStep = { kind: "assertNoBindings", file: "wrangler.jsonc" }
const SCAN: DeployStep = { kind: "assertNoDevtools", directory: "web/dist" }
const BUILD: DeployStep = { kind: "run", command: "npm", args: ["run", "build"] }
const DEPLOY: DeployStep = { kind: "deployIfChanged", directory: "web/dist", command: "npx", args: ["wrangler", "deploy"] }

/** Real behaviour, fake effects: what ran and what was said, in order. */
function fakeIo(overrides: Partial<DeployIo> = {}): { log: string[]; io: DeployIo } {
  const log: string[] = []
  const io: DeployIo = {
    run: (command, args) => void log.push(`run ${command} ${args.join(" ")}`),
    forbiddenBindings: () => [],
    devtoolsIn: () => [],
    report: (message) => void log.push(`report ${message}`),
    ...overrides,
  }
  return { log, io }
}

test("a plan that passes every check runs its steps in order and exits 0", () => {
  const { log, io } = fakeIo()
  assert.equal(executePlan([BINDINGS, BUILD, SCAN, DEPLOY], io), 0)
  assert.deepEqual(log, ["run npm run build", "run npx wrangler deploy"])
})

test("a config that binds a data store stops the deploy before anything runs", () => {
  const { log, io } = fakeIo({ forbiddenBindings: () => ["d1_databases", "r2_buckets"] })
  assert.equal(executePlan([BINDINGS, BUILD, DEPLOY], io), 1)
  assert.equal(log.filter((line) => line.startsWith("run ")).length, 0)
  assert.equal(log.length, 1)
  assert.match(log[0] ?? "", /refusing to deploy a Worker that binds a data store \(d1_databases, r2_buckets in wrangler\.jsonc\)/)
})

test("a bundle with devtools stops the deploy before wrangler deploy", () => {
  const { log, io } = fakeIo({ devtoolsIn: () => ["client/assets/app-devtools-abc.js"] })
  assert.equal(executePlan([BINDINGS, BUILD, SCAN, DEPLOY], io), 1)
  assert.deepEqual(log.filter((line) => line.startsWith("run ")), ["run npm run build"])
  assert.match(log.at(-1) ?? "", /devtools.*app-devtools-abc\.js/s)
})

test("a step that fails ends the deploy, and nothing after it runs", () => {
  const { log, io } = fakeIo({
    run: (command, args) => {
      log.push(`run ${command} ${args.join(" ")}`)
      throw new Error("build failed")
    },
  })
  assert.throws(() => executePlan([BUILD, DEPLOY], io), /build failed/)
  assert.deepEqual(log, ["run npm run build"])
})

test("the output last deployed is not deployed again, unless forced", () => {
  const skipped = fakeIo({ builtHash: () => "h1", deployedHash: () => "h1" })
  assert.equal(executePlan([BUILD, DEPLOY], skipped.io), 0)
  assert.deepEqual(skipped.log.filter((line) => line.startsWith("run ")), ["run npm run build"])
  assert.match(skipped.log.at(-1) ?? "", new RegExp(UNCHANGED_MARK))

  const forced = fakeIo({ builtHash: () => "h1", deployedHash: () => "h1", force: true })
  executePlan([DEPLOY], forced.io)
  assert.deepEqual(forced.log, ["run npx wrangler deploy"])
})

test("changed output is deployed and its hash recorded only after wrangler succeeded", () => {
  const recorded: string[] = []
  const ok = fakeIo({ builtHash: () => "h2", deployedHash: () => "h1", recordDeployed: (hash) => void recorded.push(hash) })
  executePlan([DEPLOY], ok.io)
  assert.deepEqual(recorded, ["h2"])

  const failing: string[] = []
  const bad = fakeIo({
    builtHash: () => "h2",
    deployedHash: () => "h1",
    recordDeployed: (hash) => void failing.push(hash),
    run: () => {
      throw new Error("wrangler failed")
    },
  })
  assert.throws(() => executePlan([DEPLOY], bad.io), /wrangler failed/)
  assert.deepEqual(failing, [])
})
