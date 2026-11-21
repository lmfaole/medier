import { strict as assert } from "node:assert"
import { test } from "node:test"

import { aboutText, albumChartUrl, albumPlaysIn, albumSeconds, durationText, listenedSeconds, parseAlbumChart, trackPlays } from "./album-listening.ts"

test("the weekly album chart is read, and an album's plays count every edition of it by the artist whatever its case", () => {
  assert.equal(albumChartUrl("B", 10, 20), "B&method=user.getweeklyalbumchart&from=10&to=20")
  const chart = parseAlbumChart({
    weeklyalbumchart: {
      album: [
        { name: "Junior", artist: { "#text": "Röyksopp" }, playcount: "12" },
        { name: "Junior (Deluxe Edition)", artist: { "#text": "RÖYKSOPP" }, playcount: "3" },
        { name: "Junior", artist: { "#text": "Someone Else" }, playcount: "40" },
        { name: "", artist: { "#text": "Röyksopp" }, playcount: "9" },
      ],
    },
  })
  assert.equal(chart.length, 3)
  assert.equal(albumPlaysIn(chart, "Röyksopp", "Junior"), 15)
  assert.equal(albumPlaysIn(chart, "Röyksopp", "Melody A.M."), 0)
  assert.deepEqual(parseAlbumChart({ error: 6 }), [])
})

test("a track's plays come from the top songs by the artist, matched by title whatever its edition; one not among them is left out", () => {
  const top = [
    { title: "Eple", artist: "Röyksopp", plays: 30, url: "" },
    { title: "Eple - Remastered", artist: "Röyksopp", plays: 2, url: "" },
    { title: "So Easy", artist: "Röyksopp", plays: 12, url: "" },
    { title: "Eple", artist: "Other", plays: 99, url: "" },
  ]
  const plays = trackPlays(top, "röyksopp", ["So Easy", "Eple", "Sparks"])
  assert.deepEqual([...plays], [["So Easy", 12], ["Eple", 32]])
})

test("the length is only told where every track's is known", () => {
  assert.equal(albumSeconds([{ seconds: 200 }, { seconds: 100 }]), 300)
  assert.equal(albumSeconds([{ seconds: 200 }, { seconds: null }]), null)
  assert.equal(albumSeconds([]), null)
})

test("the time listened is the plays times a play's length, weighted by the tracks played most, and not guessed from too little", () => {
  const tracks = [{ title: "A", seconds: 100 }, { title: "B", seconds: 300 }, { title: "C", seconds: null }]
  assert.equal(listenedSeconds(tracks, 10, new Map()), 10 * 200)
  assert.equal(listenedSeconds(tracks, 10, new Map([["A", 3], ["B", 1]])), 10 * 150)
  assert.equal(listenedSeconds(tracks, 2, new Map()), null)
  assert.equal(listenedSeconds(tracks, null, new Map()), null)
  assert.equal(listenedSeconds([{ title: "A", seconds: 100 }, { title: "B", seconds: null }, { title: "C", seconds: null }], 10, new Map()), null)
})

test("lengths and about-times are said as a person would", () => {
  assert.equal(durationText(47 * 60 + 10), "47 min")
  assert.equal(durationText(72 * 60), "1 t 12 min")
  assert.equal(durationText(120 * 60), "2 t")
  assert.equal(aboutText(41 * 60), "omtrent 40 min")
  assert.equal(aboutText(60), "omtrent 5 min")
  assert.equal(aboutText(6.2 * 3600), "omtrent 6 t")
  assert.equal(aboutText(6.3 * 3600), "omtrent 6,5 t")
  assert.equal(aboutText(123.4 * 3600), "omtrent 123 t")
})
