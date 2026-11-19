import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"

import * as v from "valibot"

import { PODCAST_HISTORY_SQL, PodcastHistoryAction } from "./podcast-history-tables.ts"

test("an action's show and episode are their titles, or its keys when the import found none", () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(readFileSync(join(import.meta.dirname, "..", "..", "..", "db", "podcast_history.sql"), "utf8"))
  sqlite.exec(`
    INSERT INTO episode_actions (id, episode_key, series_key, episode_url, action, position, total, timestamp_epoch, completed, series_title, episode_title, imported_at) VALUES
      (1, 'guid-1', 'Show', 'https://example.com/1.mp3', 'FINISH', 100, 100, 1000, 1, 'A Show', 'An Episode', 'now'),
      (2, 'guid-2', 'https://example.com/feed.xml', 'https://example.com/2.mp3', 'PLAY', 5, 100, 2000, 0, NULL, NULL, 'now'),
      (3, 'guid-3', 'Show', 'https://example.com/3.mp3', NULL, NULL, NULL, NULL, 0, 'A Show', 'Another Episode', 'now')
  `)
  // The contract's SQL names the attached `podcast_history` schema (the real snapshot opens two
  // databases); this test has the one table in its only schema, so the prefix is dropped.
  const actions = v.parse(v.array(PodcastHistoryAction), sqlite.prepare(PODCAST_HISTORY_SQL.replaceAll("podcast_history.", "")).all())
  assert.deepEqual(
    actions.map(({ at, series, episode, action, completed }) => [at, series, episode, action, completed]),
    [
      [2000, "https://example.com/feed.xml", "guid-2", "PLAY", 0],
      [1000, "A Show", "An Episode", "FINISH", 1],
      [null, "A Show", "Another Episode", "PLAY", 0],
    ],
  )
})
