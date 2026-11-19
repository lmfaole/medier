import { strict as assert } from "node:assert"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import * as v from "valibot"

import { DayRow, FilmDayRow, ShelfDayRow, TIMELINE_FILM_SQL, TIMELINE_MUSIC_SQL, TIMELINE_PODCASTS_SQL, TIMELINE_TV_SQL, TimedRow, shelfTimelineSql } from "./media-timeline.ts"

const schema = (domain: string) => readFileSync(join(import.meta.dirname, "..", "..", "..", "db", `${domain}.sql`), "utf8")

/** `music` as the main database and the others attached, as the snapshot opens them. */
function opened(): DatabaseSync {
  const directory = mkdtempSync(join(tmpdir(), "timeline-"))
  for (const domain of ["podcasts", "podcast_history", "film", "tv", "games", "books", "boardgames"]) {
    const file = new DatabaseSync(join(directory, `${domain}.db`))
    file.exec(schema(domain))
    file.close()
  }
  const sqlite = new DatabaseSync(join(directory, "music.db"))
  sqlite.exec(schema("music"))
  for (const domain of ["podcasts", "podcast_history", "film", "tv", "games", "books", "boardgames"]) sqlite.exec(`ATTACH DATABASE '${join(directory, `${domain}.db`)}' AS ${domain}`)
  return sqlite
}

test("each service gives its newest first, a series once a day, and a film with the title the register has", () => {
  const sqlite = opened()
  sqlite.exec(`
    INSERT INTO listens (listened_at, track_name, artist_name, release_name, duration_ms) VALUES
      (100, 'Old', 'Band', 'Album', 200000), (200, 'New', 'Band', 'Album', 200000), (300, 'Clip', 'Host', NULL, 900000);
    INSERT INTO podcast_plays (started_at, show_name, episode_name, episode_uri, ms_played) VALUES (150, 'Show', 'Ep 1', 'u1', 600000), (160, 'Show', 'Skipped', 'u2', 1000);
    INSERT INTO film_watch (id, watched_on, title, year, rewatch, tmdb_id) VALUES (1, '2026-01-01', 'Heat', 1995, 0, 949), (2, NULL, 'No day', NULL, 0, NULL), (3, '2026-02-01', 'Sult', 2008, 0, NULL);
    INSERT INTO film_title (tmdb_id, title, original_title, release_date, fetched_at) VALUES (949, 'Heat (norsk)', 'Heat', '1995-12-15', 0);
    INSERT INTO tv_watch (id, watched_on, series, year, season, episode, rewatch, tmdb_id) VALUES
      (1, '2026-03-01', 'Dark', 2017, 1, 1, 0, 70523), (2, '2026-03-01', 'Dark', 2017, 1, 2, 0, 70523), (3, '2026-02-01', 'Dark', 2017, 1, 3, 0, 70523);
  `)
  const music = v.parse(v.array(TimedRow), sqlite.prepare(TIMELINE_MUSIC_SQL).all())
  assert.deepEqual(music.map((row) => row.title), ["New", "Old"])
  const podcasts = v.parse(v.array(TimedRow), sqlite.prepare(TIMELINE_PODCASTS_SQL).all())
  assert.deepEqual(podcasts.map((row) => [row.title, row.subtitle]), [["Ep 1", "Show"]])
  const film = v.parse(v.array(FilmDayRow), sqlite.prepare(TIMELINE_FILM_SQL).all())
  assert.deepEqual(film.map((row) => [row.day, row.title, row.subtitle]), [["2026-02-01", "Sult", "2008"], ["2026-01-01", "Heat (norsk)", "1995"]])
  const tv = v.parse(v.array(DayRow), sqlite.prepare(TIMELINE_TV_SQL).all())
  assert.deepEqual(tv.map((row) => [row.day, row.title, row.subtitle]), [["2026-03-01", "Dark", "2 episoder"], ["2026-02-01", "Dark", "Sesong 1, episode 3"]])
})

test("a shelf app gives its newest dated lines, with the work the register matched and its maker", () => {
  const sqlite = opened()
  sqlite.exec(`
    INSERT INTO game_item (ext_id, title, creator, year, fetched_at) VALUES ('1', 'Hades', 'Supergiant', 2020, 0);
    INSERT INTO game_match (title, year, ext_id, tried_at) VALUES ('hades', 2020, '1', 0);
    INSERT INTO game_entry (id, on_date, title, year, status) VALUES (1, '2026-01-01', 'Celeste', 2018, 'done'), (2, NULL, 'No day', NULL, 'owned'), (3, '2026-02-01', 'hades', 2020, 'done');
    INSERT INTO book_entry (id, on_date, at, title, status) VALUES (1, '2026-03-01', 1772366400, 'Dune', 'done');
    INSERT INTO boardgame_entry (id, on_date, title, status) VALUES (1, '2026-03-02', 'Catan', 'played');
  `)
  const games = v.parse(v.array(ShelfDayRow), sqlite.prepare(shelfTimelineSql("game", "games")).all())
  assert.deepEqual(games.map((row) => [row.day, row.title, row.subtitle]), [["2026-02-01", "Hades", "Supergiant"], ["2026-01-01", "Celeste", null]])
  assert.deepEqual(v.parse(v.array(ShelfDayRow), sqlite.prepare(shelfTimelineSql("book", "books")).all()).map((row) => [row.title, row.at]), [["Dune", 1772366400]])
  assert.deepEqual(v.parse(v.array(ShelfDayRow), sqlite.prepare(shelfTimelineSql("boardgame", "boardgames")).all()).map((row) => row.title), ["Catan"])
})

test("a visit is one film line with its time and cinema, whether the log has it ahead of its day or only the calendar does", () => {
  const sqlite = opened()
  sqlite.exec(`
    INSERT INTO film.film_watch (id, watched_on, title, year, rewatch) VALUES (1, '2999-01-01', 'The Ring', 2002, 0), (2, '2000-01-01', 'Old', 1999, 0);
    INSERT INTO film.film_planned (uid, on_date, at_time, title, cinema) VALUES
      ('a', '2999-01-01', '21:00', 'the ring', 'Ringen kino'),
      ('b', '2999-01-02', NULL, 'Later', NULL)`)
  const rows = v.parse(v.array(FilmDayRow), sqlite.prepare(TIMELINE_FILM_SQL).all())
  assert.deepEqual(rows.map((row) => [row.day, row.time, row.title, row.subtitle]), [["2999-01-02", null, "Later", null], ["2999-01-01", "21:00", "The Ring", "Ringen kino"], ["2000-01-01", null, "Old", "1999"]])
})
