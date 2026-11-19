import { strict as assert } from "node:assert"
import { test } from "node:test"

import { digestOf } from "./digest.ts"
import type { SpanSummary } from "./types.ts"

const span = (start: string, plays: number, artists: [string, number][] = []): SpanSummary => ({
  start,
  plays,
  change: null,
  ongoing: true,
  topArtists: artists.map(([artist, count]) => ({ artist, plays: count })),
})

test("a week's notification names the week, the plays, the change from the week before and who led", () => {
  const digest = digestOf("week", [span("2026-11-09", 125, [["Rebecca Black", 17], ["Jae Stephens", 16]]), span("2026-11-02", 100)])
  assert.deepEqual(digest, {
    title: "Uke fra 9. nov.: 125 avspillinger",
    body: "Opp 25 % fra uken før. Mest Rebecca Black (17), Jae Stephens (16).",
    path: "/tilbakeblikk/uke",
  })
})

test("a month's notification is the month and what changed from the month before, and leads to the months", () => {
  const digest = digestOf("month", [span("2026-10-01", 900, [["Troye Sivan", 80]]), span("2026-09-01", 1000)])
  assert.equal(digest?.title, "Oktober 2026: 900 avspillinger")
  assert.equal(digest?.body, "Ned 10 % fra måneden før. Mest Troye Sivan (80).")
  assert.equal(digest?.path, "/tilbakeblikk/maaned")
})

test("no change is said when there is nothing to compare with, and nothing is sent for nothing heard", () => {
  assert.equal(digestOf("week", [span("2026-11-09", 5, [["A", 5]]), span("2026-11-02", 0)])?.body, "Mest A (5).")
  assert.equal(digestOf("week", [span("2026-11-09", 5)])?.body, "")
  assert.equal(digestOf("week", [span("2026-11-09", 0), span("2026-11-02", 7)]), null)
  assert.equal(digestOf("month", []), null)
})
