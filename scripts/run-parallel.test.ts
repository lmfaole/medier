import { strict as assert } from "node:assert"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { runParallel } from "./run-parallel.ts"

const node = (code: string) => `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`

test("every command runs and the result is the exit codes in the order given", async () => {
  const results = await runParallel([node("process.exit(0)"), node("process.exit(3)"), node("process.exit(0)")])
  assert.deepEqual(results.map((result) => result.code), [0, 3, 0])
})

test("commands overlap: the first waits for a file the second writes, which only works if both are running", async () => {
  const directory = mkdtempSync(join(tmpdir(), "run-parallel-"))
  const flag = join(directory, "flag")
  // Run one after the other, the first would wait out its five seconds and give up with exit 9.
  const waiter = node(`const fs = require('fs'); const end = Date.now() + 5000; while (!fs.existsSync(${JSON.stringify(flag)})) { if (Date.now() > end) process.exit(9) }`)
  const writer = node(`require('fs').writeFileSync(${JSON.stringify(flag)}, 'x')`)
  const results = await runParallel([waiter, writer])
  rmSync(directory, { recursive: true })
  assert.deepEqual(results.map((result) => result.code), [0, 0])
})

test("each command's output is kept apart, so one run's lines do not weave into another's", async () => {
  const results = await runParallel([node("console.log('a1'); setTimeout(() => console.log('a2'), 100)"), node("console.log('b1'); console.log('b2')")])
  assert.equal(results[0]?.output.trim(), "a1\na2")
  assert.equal(results[1]?.output.trim(), "b1\nb2")
})
