import { strict as assert } from "node:assert"
import { test } from "node:test"

import { enough, runningTotal, yearsOf } from "./media-blocks.ts"

test("a chart needs two buckets with something in them", () => {
  assert.equal(enough([]), false)
  assert.equal(enough([{ value: 5 }]), false)
  assert.equal(enough([{ value: 5 }, { value: 0 }]), false)
  assert.equal(enough([{ value: 5 }, { value: 1 }, { value: 0 }]), true)
})

test("the running total adds each month to the ones before it", () => {
  assert.deepEqual(runningTotal([{ label: "2026-01", value: 2 }, { label: "2026-02", value: 3 }]), [{ label: "2026-01", value: 2 }, { label: "2026-02", value: 5 }])
})

test("months are summed into their years, oldest first", () => {
  assert.deepEqual(yearsOf([{ label: "2025-12", value: 1 }, { label: "2026-01", value: 2 }, { label: "2026-02", value: 3 }]), [{ label: "2025", value: 1 }, { label: "2026", value: 5 }])
})
