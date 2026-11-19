import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import * as v from "valibot"
import { DatabaseSync } from "node:sqlite"

import { sqliteAsD1 } from "@designsystem/config/sqlite-d1"
import { fakeD1 } from "@designsystem/config/worker-test-kit"
import { entities, entity, library, recent } from "./api.ts"
import { unplayedSheets } from "./entities.ts"

/** A D1 stand-in that answers each query by the table it reads from. */
const databaseWith = (rowsByTable: Record<string, unknown[]>) =>
  fakeD1((sql) => {
    const rows = rowsByTable[/FROM (\w+)/.exec(sql)?.[1] ?? ""] ?? []
    if (!sql.startsWith("SELECT name, json_extract")) return rows
    return rows.flatMap((row) => {
      const { kind, name, detail } = v.parse(v.object({ kind: v.string(), name: v.string(), detail: v.string() }), row)
      const { image_mbid } = v.parse(v.object({ image_mbid: v.optional(v.nullable(v.string())) }), JSON.parse(detail))
      return kind === "artist" && image_mbid ? [{ name, image_mbid }] : []
    })
  })

/** The answer, which these tests expect to exist. */
async function present<T>(answer: Promise<T | null>): Promise<T> {
  const value = await answer
  assert.ok(value !== null, "expected an answer, got null")
  return value
}

test("recent lists the newest listens with their cover URL, and the limit is one of 5, 10 or 15", async () => {
  const data = await recent(
    databaseWith({
      listens: [
        { listened_at: 1767598980, track_name: "Odessa", artist_name: "Caribou", release_name: "Our Love", cover: "f1418001-7f1e-46af-bfdb-95faeded8841/42" },
        { listened_at: 1767598000, track_name: "Sun", artist_name: "Caribou", release_name: null, cover: null },
      ],
    }),
    5,
  )
  assert.deepEqual(data.map((listen) => [listen.track, listen.cover]), [["Odessa", "/covers/f1418001-7f1e-46af-bfdb-95faeded8841/42-250.jpg"], ["Sun", null]])
})

test("recent leaves out a long clip with no album and no recording, which stays in listens", async () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(readFileSync(new URL("../../../../../db/music.sql", import.meta.url), "utf8"))
  sqlite.exec("INSERT INTO listens (listened_at, track_name, artist_name) VALUES (3, 'Song', 'Band'), (2, 'Headline', 'Rentekutt'); UPDATE listens SET duration_ms = 3540000 WHERE track_name = 'Headline'")
  assert.deepEqual((await recent(sqliteAsD1(sqlite), 5)).map((listen) => listen.track), ["Song"])
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM listens").get()?.["n"], 2)
})

const entityRow = {
  kind: "song",
  slug: "odessa-1",
  name: "Odessa",
  artist_name: "Caribou",
  cover: "e24b8995-129d-4174-b3b5-a95297bd79fc/42",
  play_count: 12,
  detail: JSON.stringify({
    minutes: 40,
    first_at: 1,
    last_at: 2,
    years: [{ year: 2021, plays: 12 }],
    release_year: 2010,
    album: "Swim",
    hours: Array.from({ length: 24 }, (_, hour) => (hour === 3 ? 12 : 0)),
    busiest_day: { day: "2021-03-01", plays: 4 },
    genres: [{ genre: "electronic", plays: 12 }],
    siblings: [{ track: "Sun", plays: 8 }],
  }),
}

test("entities lists what has a sheet, with its cover and artist", async () => {
  const list = await entities(databaseWith({ entity_pages: [entityRow] }))
  assert.deepEqual(list, [
    { kind: "song", slug: "odessa-1", name: "Odessa", artist: "Caribou", cover: "/covers/e24b8995-129d-4174-b3b5-a95297bd79fc/42-250.jpg", plays: 12 },
  ])
})

test("entity reads a song's page, and says null for a kind, a slug or a page that is not there", async () => {
  const database = databaseWith({ entity_pages: [entityRow] })
  const page = await present(entity(database, "song", "odessa-1"))
  assert.equal(page.kind, "song")
  if (page.kind === "song") {
    assert.equal(page.album, "Swim")
    assert.equal(page.hours[3], 12)
    assert.deepEqual(page.busiestDay, { day: "2021-03-01", plays: 4 })
  }
  assert.equal(page.ownership, null)
  assert.equal(await entity(database, "podcast", "odessa-1"), null)
  assert.equal(await entity(database, "song", null), null)
  assert.equal(await entity(databaseWith({ entity_pages: [] }), "song", "nope"), null)
})

test("an old address of a page whose spellings were joined answers with that page, under its own address", async () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(readFileSync(new URL("../../../../../db/music.sql", import.meta.url), "utf8"))
  sqlite.prepare("INSERT INTO entity_pages (kind, slug, name, artist_name, cover, play_count, detail) VALUES (?, ?, ?, ?, ?, ?, ?)").run("song", "odessa-1", "Odessa", "Caribou", null, 12, entityRow.detail)
  sqlite.exec("INSERT INTO entity_alias (kind, old_slug, slug) VALUES ('song', 'odessa-0', 'odessa-1')")
  const database = sqliteAsD1(sqlite)
  assert.equal((await present(entity(database, "song", "odessa-0"))).slug, "odessa-1")
  assert.equal(await entity(database, "album", "odessa-0"), null)
})

test("entity refuses a page whose detail is not the shape of its kind", async () => {
  const broken = { ...entityRow, detail: JSON.stringify({ minutes: 1 }) }
  await assert.rejects(entity(databaseWith({ entity_pages: [broken] }), "song", "odessa-1"))
})

test("the library is what was played, and the collection adds what is owned or wanted: a played album that is owned stays heard and is owned", async () => {
  const played = { ...entityRow, kind: "album", name: "Swim", artist_name: "Caribou", first_at: Date.UTC(2021, 2, 1) / 1000, last_at: Date.UTC(2021, 3, 1) / 1000 }
  const collection = (kind: string, artist: string, title: string, status: string, format: string | null = null) => ({ id: 1, added_on: null, kind, artist, title, year: 2010, status, rating: null, note: null, mbid: null, format })
  const { works } = await library(databaseWith({ entity_pages: [played], music_collection: [collection("album", "CARIBOU", "swim", "owned", "cd"), collection("album", "Robyn", "Honey", "want"), collection("artist", "Robyn", "", "owned")] }))
  const by = (title: string) => works.find((work) => work.title === title)
  assert.deepEqual([by("Swim")?.status, by("Swim")?.owned, by("Swim")?.firstOn, by("Swim")?.lastOn], ["done", true, "2021-03-01", "2021-04-01"])
  assert.equal(by("Swim")?.format, "cd")
  assert.deepEqual([by("Honey")?.status, by("Honey")?.slug === null, by("Honey")?.creator, by("Honey")?.plays], ["want", false, "Robyn", 0])
  assert.deepEqual([by("Robyn")?.kind, by("Robyn")?.status, by("Robyn")?.owned], ["artist", "owned", true])
  assert.equal(works.length, 3)
  // Punctuation and a curly apostrophe do not keep a line from its played album.
  const janet = { ...played, name: "Janet", artist_name: "Janet Jackson" }
  const matched = await library(databaseWith({ entity_pages: [janet], music_collection: [collection("album", "Janet Jackson", "Janet.", "owned", "cd")] }))
  assert.deepEqual(matched.works.map((work) => [work.title, work.owned]), [["Janet", true]])
})

test("an entity page tells what the collection says the owner has of it, whatever the case of the names", async () => {
  const line = { id: 1, added_on: null, kind: "song", artist: "CARIBOU", title: "odessa", year: null, status: "owned", rating: null, note: null, mbid: null, format: "vinyl" }
  const page = await present(entity(databaseWith({ entity_pages: [entityRow], music_collection: [line] }), "song", "odessa-1"))
  assert.deepEqual(page.ownership, { status: "owned", format: "vinyl", lines: [{ status: "owned", format: "vinyl", addedOn: null, rating: null }] })
})

test("a work of the collection that was never played has a page of its own, in the snapshot too, and the owner's note is not published", async () => {
  const lines = [
    { id: 1, added_on: "2026-02-03", kind: "album", artist: "Robyn", title: "Honey", year: 2018, status: "want", rating: 4, note: "private", mbid: null, format: null },
    { id: 2, added_on: null, kind: "song", artist: "CARIBOU", title: "odessa", year: null, status: "owned", rating: null, note: null, mbid: null, format: "vinyl" },
  ]
  const database = databaseWith({ entity_pages: [], music_collection: lines, album_track: [{ disc: 1, position: 1, title: "Honey", length_ms: 200000, artist_credit: "Robyn" }, { disc: 1, position: 2, title: "Missing", length_ms: null, artist_credit: "Robyn feat. Guest" }] })
  const sheets = await unplayedSheets(database)
  const sheet = sheets.find((candidate) => candidate.kind === "album")
  assert.equal(sheets.length, 2)
  const page = await present(entity(database, "album", sheet?.slug ?? ""))
  assert.deepEqual([page.kind, page.name, page.ownership?.status], ["collection", "Honey", "want"])
  assert.ok(!JSON.stringify(page).includes("private"), "the owner's note is not published")
  // An album never played still lists its tracks, with the credit only where it is not the album's artist.
  assert.deepEqual(page.kind === "collection" ? page.tracks.map((track) => [track.track, track.plays, track.credit]) : null, [["Honey", 0, undefined], ["Missing", 0, "Robyn feat. Guest"]])
  assert.equal(await entity(database, "song", sheet?.slug ?? ""), null)
})

test("an artist is shown with their own picture, not an album's, where they have one", async () => {
  const mbid = "87c5dedd-371d-4a53-9f7f-80522fb7f3cb"
  const artist = (name: string, imageMbid: string | null) => ({ kind: "artist", slug: name, name, artist_name: "", cover: "e24b8995-129d-4174-b3b5-a95297bd79fc/42", play_count: 1, detail: JSON.stringify({ image_mbid: imageMbid }) })
  const list = await entities(databaseWith({ entity_pages: [artist("Björk", mbid), artist("Caribou", null)] }))
  assert.deepEqual(list.map((entry) => entry.cover), [`/artists/${mbid}.jpg`, "/covers/e24b8995-129d-4174-b3b5-a95297bd79fc/42-250.jpg"])
})

