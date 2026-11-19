import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import * as v from "valibot"

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"

import { PODCAST_PLAYS_SQL, PodcastPlay, podcastPlaysWithListeningSql } from "./podcast-tables.ts"

test("a play is a Spotify play of a minute or more, or a scrobble of either kind that Spotify does not have", () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(readFileSync(join(import.meta.dirname, "..", "..", "..", "db", "podcasts.sql"), "utf8"))
  sqlite.exec(`
    INSERT INTO podcast_shows (artist_name) VALUES ('Debatten');
    INSERT INTO podcast_plays (started_at, show_name, episode_name, episode_uri, ms_played) VALUES
      (1000, 'Vergecast', 'Episode A', 'spotify:episode:a', 1800000),
      (2000, 'Vergecast', 'A skip', 'spotify:episode:b', 5000);
    INSERT INTO podcast_listens (listened_at, track_name, artist_name) VALUES
      (3000, 'Episode A', 'Vergecast'),
      (4000, 'An episode, as ListenBrainz has it', 'Debatten'),
      (5000, 'Debatten', 'An episode, as Last.fm has it'),
      (6000, 'A headline', 'Some clip');
  `)
  const plays = v.parse(v.array(PodcastPlay), sqlite.prepare(PODCAST_PLAYS_SQL).all())
  assert.deepEqual(
    plays.map(({ at, show, episode }) => [at, show, episode]),
    [
      [1000, "Vergecast", "Episode A"],
      [4000, "Debatten", "An episode, as ListenBrainz has it"],
      [5000, "Debatten", "An episode, as Last.fm has it"],
      [6000, "Andre klipp", "Some clip"],
    ],
  )
})

test("what the player recorded is a play from a minute in, unless it is a bulk mark or a listening the scrobbles already have", () => {
  const schema = (domain: string) => readFileSync(join(import.meta.dirname, "..", "..", "..", "db", `${domain}.sql`), "utf8")
  const directory = mkdtempSync(join(tmpdir(), "plays-"))
  const history = new DatabaseSync(join(directory, "history.db"))
  history.exec(schema("podcast_history"))
  const action = (id: number, at: number, series: string, episode: string, position: number) =>
    history.prepare("INSERT INTO episode_actions (id, episode_key, series_key, action, position, timestamp_epoch, completed, series_title, episode_title, imported_at) VALUES (?, ?, ?, 'PLAY', ?, ?, 0, ?, ?, '')").run(id, episode, series, position, at, series, episode)
  action(1, 10_000, "Dagsnytt 18", "Opptøyer", 1421)
  action(2, 20_000, "Dagsnytt 18", "Too short", 30)
  action(3, 30_000, "Scrobbled", "Episode S", 900)
  for (let index = 0; index < 12; index += 1) action(100 + index, 40_000, "Desken brenner", `Old ${index}`, 2000)
  history.close()
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(schema("podcasts"))
  sqlite.exec(`ATTACH DATABASE '${join(directory, "history.db")}' AS podcast_history`)
  sqlite.exec("INSERT INTO podcast_shows (artist_name) VALUES ('Scrobbled'); INSERT INTO podcast_listens (listened_at, track_name, artist_name) VALUES (30500, 'Episode S', 'Scrobbled')")
  const plays = v.parse(v.array(PodcastPlay), sqlite.prepare(podcastPlaysWithListeningSql()).all())
  assert.deepEqual(
    plays.map(({ at, show, episode, ms }) => [at, show, episode, ms]),
    [
      [10_000, "Dagsnytt 18", "Opptøyer", 1_421_000],
      [30_500, "Scrobbled", "Episode S", 0],
    ],
  )
})

test("names whose shows have the same feed are counted as one show, under the feed's title", () => {
  const schema = (domain: string) => readFileSync(join(import.meta.dirname, "..", "..", "..", "db", `${domain}.sql`), "utf8")
  const directory = mkdtempSync(join(tmpdir(), "plays-"))
  new DatabaseSync(join(directory, "history.db")).exec(schema("podcast_history"))
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(schema("podcasts"))
  sqlite.exec(`ATTACH DATABASE '${join(directory, "history.db")}' AS podcast_history`)
  sqlite.exec(`
    INSERT INTO podcast_shows (artist_name) VALUES ('TrueAnon'), ('TRUE ANON TRUTH FEED'), ('Vergecast');
    INSERT INTO podcast_listens (listened_at, track_name, artist_name) VALUES
      (1000, 'Episode 1', 'TrueAnon'), (2000, 'Episode 2', 'TRUE ANON TRUTH FEED'), (3000, 'Episode 3', 'Vergecast');
    INSERT INTO podcast_show_info (show_name, feed_url, title, fetched_at) VALUES
      ('TrueAnon', 'https://example.org/trueanon', 'TRUE ANON TRUTH FEED', 0),
      ('TRUE ANON TRUTH FEED', 'https://example.org/trueanon', 'TRUE ANON TRUTH FEED', 0),
      ('Vergecast', '', 'The Vergecast', 0);
  `)
  const plays = v.parse(v.array(PodcastPlay), sqlite.prepare(podcastPlaysWithListeningSql()).all())
  assert.deepEqual(plays.map(({ show }) => show), ["TRUE ANON TRUTH FEED", "TRUE ANON TRUTH FEED", "Vergecast"])
})

test("the plays query looks listenings up by index instead of scanning a table per play", () => {
  const schema = (domain: string) => readFileSync(join(import.meta.dirname, "..", "..", "..", "db", `${domain}.sql`), "utf8")
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(schema("podcasts"))
  sqlite.exec("ATTACH DATABASE ':memory:' AS podcast_history")
  sqlite.exec(schema("podcast_history").replace("CREATE TABLE IF NOT EXISTS episode_actions", "CREATE TABLE IF NOT EXISTS podcast_history.episode_actions").replace(/CREATE INDEX IF NOT EXISTS (\w+) ON/g, "CREATE INDEX IF NOT EXISTS podcast_history.$1 ON"))
  const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${podcastPlaysWithListeningSql()}`).all().map((row) => String(row["detail"]))
  assert.ok(plan.some((step) => step.includes("idx_podcast_plays_episode")), "Spotify lookups by episode use the index")
  assert.equal(plan.some((step) => /^SCAN (spotify|podcast_plays AS spotify)\b/.test(step)), false)
})
