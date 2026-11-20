import { strict as assert } from "node:assert"
import { test } from "node:test"

import { type Env, type Get } from "./sources.ts"
import { loadWeek, MAX_FIRSTS_LOOKUPS, MAX_LENGTH_LOOKUPS, MAX_PLAY_PAGES } from "./week-source.ts"
import { parseWeek, type Week } from "./weeks.ts"

const found = parseWeek("2026-47")
if (found === null) throw new Error("the week")
const WEEK: Week = found
const ENV: Env = { LASTFM_API_KEY: "k", LASTFM_USER: "me", TRAKT_CLIENT_ID: "c", TRAKT_USER: "me" }
const AFTER = Date.parse("2026-11-23T08:00:00+01:00")
const DURING = Date.parse("2026-11-19T08:00:00+01:00")

const scrobble = (track: string, artist: string, at: number) => ({ name: track, artist: { "#text": artist }, album: { "#text": "LP" }, url: `https://last.fm/${artist}/${track}`, image: [], date: { uts: String(at) } })

interface Options {
  /** The plays of each page, by number. */
  pages?: unknown[][]
  totalPages?: number
  /** The plays an artist had before the week, by name; an artist not here fails. */
  before?: Record<string, number>
  hits?: boolean
  down?: ("lastfm" | "trakt")[]
}

function fake(options: Options = {}): { get: Get; asked: { url: string; ttl: number }[] } {
  const asked: { url: string; ttl: number }[] = []
  const pages = options.pages ?? [[scrobble("A1", "Alpha", WEEK.start + 100), scrobble("B1", "Beta", WEEK.start + 200)]]
  const get: Get = async (url, request) => {
    asked.push({ url, ttl: request.ttl })
    const hit = options.hits === true
    if (url.startsWith("https://ws.audioscrobbler.com/")) {
      if (options.down?.includes("lastfm")) throw new Error("lastfm down")
      const method = new URL(url).searchParams.get("method")
      if (method === "user.getrecenttracks") {
        const page = Number(new URL(url).searchParams.get("page"))
        return { data: { recenttracks: { "@attr": { page: String(page), totalPages: String(options.totalPages ?? pages.length), total: "99" }, track: pages[page - 1] ?? [] } }, hit }
      }
      if (method === "user.getweeklyartistchart") return { data: { weeklyartistchart: { artist: [{ name: "Alpha", playcount: "7", "@attr": { rank: "2" } }, { name: "Gamma", playcount: "3", "@attr": { rank: "5" } }] } }, hit }
      if (method === "track.getinfo") return { data: { track: { duration: "200000" } }, hit }
      if (method === "user.getartisttracks") {
        const artist = new URL(url).searchParams.get("artist") ?? ""
        const before = options.before?.[artist]
        if (before === undefined) throw new Error("no answer")
        return { data: { artisttracks: { "@attr": { total: String(before) } } }, hit }
      }
    }
    if (url.startsWith("https://api.trakt.tv/")) {
      if (options.down?.includes("trakt")) throw new Error("trakt down")
      return { data: url.includes("/history/movies") ? [{ id: 1, watched_at: "2026-11-18T20:00:00.000Z", type: "movie", movie: { title: "Heat", year: 1995, ids: { slug: "heat", tmdb: 949 } } }] : [], hit }
    }
    return { data: {}, hit }
  }
  return { get, asked }
}

test("every page of the week's plays is read, and the stats are made from all of them, with the week before's chart for the change", async () => {
  const pages = [[scrobble("A1", "Alpha", WEEK.start + 100), scrobble("A2", "Alpha", WEEK.start + 200)], [scrobble("B1", "Beta", WEEK.start + 300)], [scrobble("A3", "Alpha", WEEK.start + 400)]]
  const { get, asked } = fake({ pages, before: { Alpha: 5, Beta: 0 } })
  const data = await loadWeek(ENV, get, WEEK, AFTER)
  assert.equal(data.music?.stats.total, 4)
  assert.equal(data.music?.truncated, false)
  assert.equal(data.music?.stats.topArtists[0]?.name, "Alpha")
  assert.deepEqual(data.music?.stats.topArtists[0]?.change, { kind: "up", by: 1 })
  assert.equal(data.music?.previousTotal, 10)
  assert.equal(asked.filter((one) => one.url.includes("getrecenttracks")).length, 3)
  assert.ok(asked.find((one) => one.url.includes("getrecenttracks"))?.url.includes(`from=${WEEK.start}&to=${WEEK.end - 1}`))
})

test("a week of more plays than the pages that are read is cut, and says so", async () => {
  const { get, asked } = fake({ totalPages: MAX_PLAY_PAGES + 4 })
  const data = await loadWeek(ENV, get, WEEK, AFTER)
  assert.equal(data.music?.truncated, true)
  assert.equal(asked.filter((one) => one.url.includes("getrecenttracks")).length, MAX_PLAY_PAGES)
})

test("an artist is new when it had no plays before the week, and what could not be asked is not told: no answers at all is not known", async () => {
  const pages = [[scrobble("A1", "Alpha", WEEK.start + 1), scrobble("B1", "Beta", WEEK.start + 2), scrobble("C1", "Gamma", WEEK.start + 3)]]
  const some = await loadWeek(ENV, fake({ pages, before: { Alpha: 12, Beta: 0 } }).get, WEEK, AFTER)
  assert.deepEqual(some.music?.newArtists?.map((artist) => artist.name), ["Beta"])
  const none = await loadWeek(ENV, fake({ pages, before: {} }).get, WEEK, AFTER)
  assert.equal(none.music?.newArtists, null)
})

test("a page asks about no more songs and artists than the limits that were not kept; what is kept is free, so all are had", async () => {
  const many = Array.from({ length: 30 }, (_, index) => scrobble(`T${index}`, `Artist ${index}`, WEEK.start + index))
  const cold = fake({ pages: [many], before: Object.fromEntries(many.map((_, index) => [`Artist ${index}`, 0])) })
  await loadWeek(ENV, cold.get, WEEK, AFTER)
  const lookups = (name: string) => cold.asked.filter((one) => one.url.includes(name)).length
  assert.ok(lookups("track.getinfo") >= MAX_LENGTH_LOOKUPS && lookups("track.getinfo") < MAX_LENGTH_LOOKUPS + 6, `lengths ${lookups("track.getinfo")}`)
  assert.ok(lookups("getartisttracks") >= MAX_FIRSTS_LOOKUPS && lookups("getartisttracks") < MAX_FIRSTS_LOOKUPS + 6, `firsts ${lookups("getartisttracks")}`)
  const warm = fake({ pages: [many], before: Object.fromEntries(many.map((_, index) => [`Artist ${index}`, 0])), hits: true })
  await loadWeek(ENV, warm.get, WEEK, AFTER)
  assert.equal(warm.asked.filter((one) => one.url.includes("track.getinfo")).length, 30)
  assert.equal(warm.asked.filter((one) => one.url.includes("getartisttracks")).length, 10)
})

test("a week that is over is kept for a day and the one going on for minutes", async () => {
  const done = fake()
  await loadWeek(ENV, done.get, WEEK, AFTER)
  const live = fake()
  await loadWeek(ENV, live.get, WEEK, DURING)
  const ttl = (run: ReturnType<typeof fake>) => run.asked.find((one) => one.url.includes("getrecenttracks"))?.ttl
  assert.equal(ttl(done), 24 * 3600)
  assert.equal(ttl(live), 300)
  assert.equal((await loadWeek(ENV, fake().get, WEEK, AFTER)).complete, true)
  assert.equal((await loadWeek(ENV, fake().get, WEEK, DURING)).complete, false)
})

test("the films and episodes are asked for by the week's own range, and counted", async () => {
  const { get, asked } = fake()
  const data = await loadWeek(ENV, get, WEEK, AFTER)
  assert.equal(data.watched?.stats.films, 1)
  const trakt = asked.find((one) => one.url.includes("/history/movies"))?.url ?? ""
  assert.ok(trakt.includes("start_at=2026-11-15T23%3A00%3A00.000Z") && trakt.includes("end_at=2026-11-22T22%3A59%3A59.000Z"), trakt)
})

test("a source that is not set up or is down leaves out only its own part", async () => {
  const noLastfm = await loadWeek({ TRAKT_CLIENT_ID: "c", TRAKT_USER: "me" }, fake().get, WEEK, AFTER)
  assert.equal(noLastfm.music, null)
  assert.equal(noLastfm.watched?.stats.films, 1)
  const traktDown = await loadWeek(ENV, fake({ down: ["trakt"] }).get, WEEK, AFTER)
  assert.equal(traktDown.watched, null)
  assert.equal(traktDown.music?.stats.total, 2)
  const lastfmDown = await loadWeek(ENV, fake({ down: ["lastfm"] }).get, WEEK, AFTER)
  assert.equal(lastfmDown.music, null)
  assert.equal(lastfmDown.watched?.stats.films, 1)
  assert.deepEqual(await loadWeek({}, fake().get, WEEK, AFTER), { week: WEEK, complete: true, music: null, watched: null })
})
