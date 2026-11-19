import assert from "node:assert/strict"
import { test } from "node:test"

import { removeLine, settleLog } from "./log-settle-plan.ts"

const fix = { day: "2025-07-08", title: "F1 ® The Movie", year: 2025, tmdbId: 911430 }

test("a line gets its year and TMDB's number, short lines padded to the log's columns", () => {
  const settled = settleLog("# log\n2025-07-08,F1 ® The Movie\n", [fix])
  assert.equal(settled.text, "# log\n2025-07-08,F1 ® The Movie,2025,,,,911430,\n")
  assert.deepEqual(settled.changed, ["2025-07-08 F1 ® The Movie"])
})

test("settling twice changes nothing the second time", () => {
  const once = settleLog("2025-07-08,F1 ® The Movie,,,,,,\n", [fix])
  const twice = settleLog(once.text, [fix])
  assert.equal(twice.text, once.text)
  assert.deepEqual(twice.already, ["2025-07-08 F1 ® The Movie"])
})

test("another number is never overwritten, and a missing or quoted line is refused", () => {
  assert.equal(settleLog("2025-07-08,F1 ® The Movie,2025,,,,5,\n", [fix]).refused.length, 1)
  assert.equal(settleLog("2025-07-09,Other,,,,,,\n", [fix]).refused.length, 1)
  assert.equal(settleLog('2025-07-08,"F1 ® The Movie",,,,,,\n', [fix]).refused.length, 1)
})

test("one undated line is removed and the dated one of the same film stays; none or several are refused", () => {
  const log = "# log\n,The Ring,2002,,,,565,\n2026-10-31,The Ring,,,,,,\n"
  const removed = removeLine(log, "", "The Ring")
  assert.equal(removed.text, "# log\n2026-10-31,The Ring,,,,,,\n")
  assert.deepEqual(removed.outcome, { removed: ",The Ring,2002,,,,565," })
  assert.ok("refused" in removeLine(log, "", "Heat").outcome)
  assert.ok("refused" in removeLine(`${log},The Ring,,,,,,\n`, "", "The Ring").outcome)
})
