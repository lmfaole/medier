import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import * as v from "valibot"

import { TV_VIEWINGS_SQL, Viewing } from "./tv-tables.ts"

test("a viewing has the series its log names, else the one the register matched for its title and year", () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(readFileSync(join(import.meta.dirname, "..", "..", "..", "db", "tv.sql"), "utf8"))
  sqlite.exec(`
    INSERT INTO tv_watch (id, watched_on, series, year, season, episode, rating, rewatch, tmdb_id) VALUES
      (1, '2026-01-02', 'Dark', 2017, 1, 2, 4.5, 0, NULL),
      (2, '2026-01-01', 'Named', NULL, NULL, NULL, NULL, 1, 7),
      (3, '2026-01-03', 'Unknown', 2001, 2, 1, NULL, 0, NULL),
      (4, NULL, 'No day', NULL, NULL, NULL, NULL, 0, NULL);
    INSERT INTO tv_match (title, year, tmdb_id, tried_at) VALUES ('Dark', 2017, 70523, 0), ('Unknown', 2001, NULL, 0);
  `)
  const viewings = v.parse(v.array(Viewing), sqlite.prepare(TV_VIEWINGS_SQL).all())
  assert.deepEqual(viewings.map(({ on, title, tmdb_id, season, episode }) => [on, title, tmdb_id, season, episode]), [
    ["2026-01-01", "Named", 7, null, null],
    ["2026-01-02", "Dark", 70523, 1, 2],
    ["2026-01-03", "Unknown", null, 2, 1],
    [null, "No day", null, null, null],
  ])
})
