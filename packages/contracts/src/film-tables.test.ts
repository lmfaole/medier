import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import * as v from "valibot"

import { FILM_VIEWINGS_SQL, Viewing } from "./film-tables.ts"

test("a viewing has the film its log names, else the one the register matched for its title and year", () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(readFileSync(join(import.meta.dirname, "..", "..", "..", "db", "film.sql"), "utf8"))
  sqlite.exec(`
    INSERT INTO film_watch (id, watched_on, title, year, rating, rewatch, tmdb_id) VALUES
      (1, '2026-01-02', 'Heat', 1995, 4.5, 0, NULL),
      (2, '2026-01-01', 'Named', NULL, NULL, 1, 7),
      (3, '2026-01-03', 'Unknown', 2001, NULL, 0, NULL),
      (4, '2026-01-04', 'No year', NULL, 3, 0, NULL),
      (5, NULL, 'No day', NULL, NULL, 0, NULL);
    INSERT INTO film_match (title, year, tmdb_id, tried_at) VALUES ('Heat', 1995, 949, 0), ('Unknown', 2001, NULL, 0), ('No year', 0, 11, 0);
  `)
  const viewings = v.parse(v.array(Viewing), sqlite.prepare(FILM_VIEWINGS_SQL).all())
  assert.deepEqual(viewings.map(({ on, title, tmdb_id }) => [on, title, tmdb_id]), [
    ["2026-01-01", "Named", 7],
    ["2026-01-02", "Heat", 949],
    ["2026-01-03", "Unknown", null],
    ["2026-01-04", "No year", 11],
    [null, "No day", null],
  ])
})
