import { strict as assert } from "node:assert"
import { test } from "node:test"

import { lineOf, parseSubmissions, planInbox, readSeen, withLines, type Submission } from "./film-inbox-plan.ts"

const LOG = `# comment\nwatched_on,title,year,rating,rewatch,note,tmdb_id,cinema\n2026-10-19,Rose,2026,,,Med Sandra Hüller,,Vega kino\n`
const submission = (id: number, answers: Record<string, string>): Submission => ({ id, answers: { Dag: "2026-11-05", Tittel: "Aftersun", ...answers } })

test("a submission is the line the log reads: comma rating, quoted note, empty settled columns", () => {
  assert.equal(lineOf(submission(1, { År: "2022", Vurdering: "4,5", Notat: "Slow, sad", Kino: "Vega kino" })), '2026-11-05,Aftersun,2022,4.5,,"Slow, sad",,Vega kino')
  assert.equal(lineOf(submission(1, {})), "2026-11-05,Aftersun,,,,,,")
})

test("a viewing the log has (any case) is only marked done, a new one goes to the log", () => {
  const plan = planInbox([submission(1, { Dag: "2026-10-19", Tittel: "rose" }), submission(2, { År: "2022" })], LOG, new Set())
  assert.deepEqual(plan.toLog, ["2026-11-05,Aftersun,2022,,,,,"])
  assert.deepEqual(plan.processed, [1, 2])
  assert.deepEqual(plan.refused, [])
})

test("the same viewing twice is logged once; a submission already seen is skipped", () => {
  const plan = planInbox([submission(1, {}), submission(2, {}), submission(3, { Tittel: "Other" })], LOG, new Set([3]))
  assert.deepEqual(plan.toLog, ["2026-11-05,Aftersun,,,,,,"])
  assert.deepEqual(plan.processed, [1, 2])
})

test("what the log's rules refuse is refused and not marked done", () => {
  const bad: Record<string, string>[] = [{ Dag: "2026-13-01" }, { Dag: "" }, { Tittel: "  " }, { År: "abc" }, { Vurdering: "6" }, { Vurdering: "3,3" }, { År: "1500" }]
  const plan = planInbox(bad.map((answers, index) => submission(index + 1, answers)), LOG, new Set())
  assert.deepEqual(plan.refused, [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(plan.processed, [])
  assert.deepEqual(plan.toLog, [])
})

test("the query's lines are read, a stray shape is an error", () => {
  assert.deepEqual(parseSubmissions('{"id":4,"answers":{"Dag":"2026-11-05","x":null}}\n\n'), [{ id: 4, answers: { Dag: "2026-11-05" } }])
  assert.throws(() => parseSubmissions('{"id":"4"}'))
})

test("lines are added after a repaired final newline; the seen file ignores noise", () => {
  assert.equal(withLines("x", ["a", "b"]), "x\na\nb\n")
  assert.equal(withLines("x\n", ["a"]), "x\na\n")
  assert.equal(withLines("x", []), "x")
  assert.deepEqual([...readSeen("3\n\nfoo\n5\n-1\n")], [3, 5])
})
