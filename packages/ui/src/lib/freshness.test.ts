import { strict as assert } from "node:assert"
import { test } from "node:test"

import { freshnessSentence } from "./freshness.ts"

const film = { one: "visning", many: "visninger" }

test("the sentence says when, in Oslo time, and how many rows came in", () => {
  assert.equal(freshnessSentence({ ...film, finishedAt: "2026-10-22T02:03:00.000Z", added: 3 }), "Sist oppdatert 22. oktober 2026 kl. 04:03, 3 nye visninger.")
})

test("one row is singular and none says so", () => {
  assert.match(freshnessSentence({ ...film, finishedAt: "2026-10-22T02:03:00.000Z", added: 1 }), /, 1 ny visning\.$/)
  assert.match(freshnessSentence({ ...film, finishedAt: "2026-10-22T02:03:00.000Z", added: 0 }), /, ingen nye visninger\.$/)
})

test("a time after midnight in Oslo is the next day there", () => {
  assert.match(freshnessSentence({ ...film, finishedAt: "2026-10-22T22:30:00.000Z", added: 0 }), /^Sist oppdatert 23\. oktober 2026 kl\. 00:30,/)
})
