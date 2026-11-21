import { strict as assert } from "node:assert"
import { test } from "node:test"

import { artistKind, artistLines, firstWith, monthRanges, mostPlayedOf, placeAmong, playsIn, shareText, similarHeard, tracksBy, yearAgoToday, yearRanges } from "./artist-listening.ts"
import type { Play } from "./lastfm.ts"
import { osloMidnight } from "./weeks.ts"

test("the years run from the one the user started in to this one, in Oslo time, and a month's ranges meet end to start", () => {
  const years = yearRanges(osloMidnight(2019, 6, 1), Date.UTC(2021, 2, 1))
  assert.deepEqual(years.map((one) => one.year), [2019, 2020, 2021])
  assert.equal(years[1]?.start, osloMidnight(2020, 1, 1))
  assert.equal(years[1]?.end, osloMidnight(2021, 1, 1))
  const months = monthRanges(2020)
  assert.equal(months.length, 12)
  assert.ok(months.every((one, index) => index === 0 || one.start === months[index - 1]?.end))
  assert.equal(months[11]?.end, osloMidnight(2021, 1, 1))
})

test("an artist's plays in a chart are found whatever the case, and are 0 where it is not in it", () => {
  const chart = [{ name: "AURORA", plays: 12, rank: 1 }]
  assert.equal(playsIn(chart, "Aurora"), 12)
  assert.equal(playsIn(chart, "Sigrid"), 0)
})

test("the first item with something is found by halving: a dozen months in four questions, and none where nothing is or a question fails", async () => {
  const months = [0, 0, 0, 0, 0, 0, 0, 3, 0, 5, 0, 0]
  let asked = 0
  const has = async (from: number, to: number) => {
    asked += 1
    return months.slice(from, to + 1).some((one) => one > 0)
  }
  assert.equal(await firstWith(12, has), 7)
  assert.ok(asked <= 5)
  assert.equal(await firstWith(12, async () => false), null)
  assert.equal(await firstWith(12, async (_from, to) => (to === 11 ? true : null)), null)
})

test("the place among all the user has heard, and its share, written in Norwegian", () => {
  const top = [{ name: "a-ha", plays: 900, url: "" }, { name: "Sigrid", plays: 310, url: "" }]
  assert.deepEqual(placeAmong(top, "sigrid", 10000), { rank: 2, plays: 310, share: 0.031 })
  assert.equal(placeAmong(top, "Sigrid", null)?.share, null)
  assert.equal(placeAmong(top, "Aurora", 10000), null)
  assert.equal(shareText(0.031), "3,1 %")
  assert.equal(shareText(0.256), "26 %")
  assert.equal(shareText(0.0004), "under 0,1 %")
})

test("the user's songs by the artist, and the artists like it that they play too, the most alike first", () => {
  const tracks = [{ title: "Take On Me", artist: "a-ha", plays: 40, url: "" }, { title: "Strangers", artist: "Sigrid", plays: 30, url: "" }, { title: "The Sun Always Shines on T.V.", artist: "A-ha", plays: 20, url: "" }]
  assert.deepEqual(tracksBy(tracks, "a-ha").map((one) => one.title), ["Take On Me", "The Sun Always Shines on T.V."])
  const similar = [{ name: "Unheard", match: 1, url: "" }, { name: "sigrid", match: 0.8, url: "u" }, { name: "a-ha", match: 0.7, url: "" }, { name: "Aurora", match: 0.5, url: "" }]
  const top = [{ name: "a-ha", plays: 1, url: "" }, { name: "Aurora", plays: 5, url: "" }, { name: "Sigrid", plays: 9, url: "s" }]
  assert.deepEqual(similarHeard(similar, top, "a-ha"), [{ name: "Sigrid", plays: 9, url: "s" }, { name: "Aurora", plays: 5, url: "" }])
  assert.equal(similarHeard(similar, top, "a-ha", 1).length, 1)
})

test("a year ago today is that day in Oslo, and 29 February is the 28th a year on", () => {
  assert.deepEqual(yearAgoToday(Date.UTC(2026, 10, 21, 12)), { start: osloMidnight(2025, 11, 21), end: osloMidnight(2025, 11, 22) })
  assert.deepEqual(yearAgoToday(Date.UTC(2028, 1, 29, 12)), { start: osloMidnight(2027, 2, 28), end: osloMidnight(2027, 3, 1) })
})

test("the song played most that day, the one played first of two as many, and nothing where the artist was not played", () => {
  const play = (track: string, artist = "a-ha"): Play => ({ track, artist, album: "", image: null, url: "", playedAt: "2025-11-21T12:00:00.000Z" })
  // Newest first, as Last.fm gives them.
  const plays = [play("Hunting High and Low"), play("Take On Me"), play("Hunting High and Low"), play("Take On Me"), play("Strangers", "Sigrid")]
  assert.deepEqual(mostPlayedOf(plays, "A-ha"), { track: "Take On Me", plays: 2 })
  assert.equal(mostPlayedOf(plays, "Aurora"), null)
})

test("the head says the artist's place in words, how much and since when", () => {
  assert.equal(artistKind(null), "Artist")
  assert.equal(artistKind(1), "Din mest spilte artist")
  assert.equal(artistKind(4), "Din fjerde mest spilte artist")
  assert.equal(artistKind(1042), `Nr. ${(1042).toLocaleString("nb-NO")} av artistene dine`)
  assert.deepEqual(artistLines(1234, 0.031, { year: 2011, month: 3 }), [`${(1234).toLocaleString("nb-NO")} avspillinger · 3,1 % av alt du har hørt`, "Først hørt i mars 2011"])
  assert.deepEqual(artistLines(null, null, { year: 2011, month: null }), ["Først hørt i 2011"])
  assert.deepEqual(artistLines(null, null, null), [])
})
