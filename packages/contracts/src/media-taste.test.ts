import { strict as assert } from "node:assert"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import * as v from "valibot"

import { CountRow, MUSIC_TASTE_SQL, WatchTotalsRow, watchTasteSql } from "./media-taste.ts"

const schema = (domain: string) => readFileSync(join(import.meta.dirname, "..", "..", "..", "db", `${domain}.sql`), "utf8")
const counts = (sqlite: DatabaseSync, sql: string) => v.parse(v.array(CountRow), sqlite.prepare(sql).all()).map((row) => [row.label, row.n])

test("a log is counted by the films it has, a viewing of the same one twice is one, and the same queries read it attached or alone", () => {
  const directory = mkdtempSync(join(tmpdir(), "taste-"))
  const film = new DatabaseSync(join(directory, "film.db"))
  film.exec(schema("film"))
  film.exec(`
    INSERT INTO film_watch (id, watched_on, title, year, rewatch, tmdb_id, rating) VALUES (1, '2026-01-01', 'Heat', 1995, 0, 949, 4), (2, '2026-02-01', 'Heat', 1995, 1, 949, NULL), (3, NULL, 'Ronin', 1998, 0, NULL, NULL);
    INSERT INTO film_match (title, year, tmdb_id, tried_at) VALUES ('Ronin', 1998, 1, 0);
    INSERT INTO film_title (tmdb_id, title, release_date, fetched_at) VALUES (949, 'Heat', '1995-12-15', 0), (1, 'Ronin', '1998-09-25', 0);
    INSERT INTO film_genre (tmdb_id, genre) VALUES (949, 'Crime'), (949, 'Drama'), (1, 'Crime');
    INSERT INTO film_credit (tmdb_id, person_id, name, job, position) VALUES (949, 7, 'Michael Mann', 'Director', 0), (1, 8, 'John Frankenheimer', 'Director', 0), (949, 9, 'Al Pacino', 'Cast', 1);
    INSERT INTO film_country (tmdb_id, code, country) VALUES (949, 'US', 'USA');
  `)
  film.close()
  const alone = new DatabaseSync(join(directory, "film.db"), { readOnly: true })
  const sql = watchTasteSql("film")
  assert.deepEqual(v.parse(v.array(WatchTotalsRow), alone.prepare(sql.totals).all()), [{ items: 2, viewings: 3, rating: 4 }])
  assert.deepEqual(counts(alone, sql.genres), [["Crime", 2], ["Drama", 1]])
  assert.deepEqual(counts(alone, sql.decades), [["1990-tallet", 2]])
  assert.deepEqual(counts(alone, sql.lead), [["John Frankenheimer", 1], ["Michael Mann", 1]])
  assert.deepEqual(counts(alone, sql.cast), [["Al Pacino", 1]])
  assert.deepEqual(counts(alone, sql.countries), [["USA", 1]])
  const main = new DatabaseSync(join(directory, "music.db"))
  main.exec(schema("music"))
  main.exec(`ATTACH DATABASE '${join(directory, "film.db")}' AS film`)
  assert.deepEqual(counts(main, watchTasteSql("film", "film.").genres), [["Crime", 2], ["Drama", 1]])
})

test("the music is counted by artist and genre, music only, and what was heard with no scrobble by kind and genre", () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(schema("music"))
  sqlite.exec(`
    INSERT INTO listens (listened_at, track_name, artist_name, release_name, recording_mbid, duration_ms) VALUES
      (1, 'a', 'Band', 'Album', 'r1', 200000), (2, 'b', 'Band', 'Album', 'r2', 200000), (3, 'c', 'Other', 'Album', 'r3', 200000), (4, 'clip', 'Host', NULL, NULL, 900000);
    INSERT INTO recording_genres (recording_mbid, genre) VALUES ('r1', 'rock'), ('r2', 'rock'), ('r3', 'pop');
    INSERT INTO music_heard (kind, artist, title, genres) VALUES ('album', 'Radiohead', 'OK Computer', '["rock","art rock"]'), ('artist', 'Björk', '', '[]');
  `)
  assert.deepEqual(counts(sqlite, MUSIC_TASTE_SQL.artists), [["Band", 2], ["Other", 1]])
  assert.deepEqual(counts(sqlite, MUSIC_TASTE_SQL.genres), [["rock", 2], ["pop", 1]])
  assert.deepEqual(counts(sqlite, MUSIC_TASTE_SQL.heard), [["album", 1], ["artist", 1]])
  assert.deepEqual(counts(sqlite, MUSIC_TASTE_SQL.heardGenres), [["art rock", 1], ["rock", 1]])
})
