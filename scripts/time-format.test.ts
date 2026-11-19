/**
 * A time is written one way: Norwegian, in Oslo, by `formatTime` of `packages/intl/src/time.ts` (or the `Time` component of
 * `packages/ui`, which wraps it). No page formats one itself, so none shows a raw ISO string, a US date or a server's time zone.
 *
 * What formats a time or reads a part of one to write it (`Intl.DateTimeFormat`, `toLocale…String`, `toISOString`, `getHours` …) is
 * only allowed in `packages/intl/src`. `ALLOWED` is what was left when the rule came: the files that still do and how
 * many times, mostly day keys and timestamps that are data and not text. It may only shrink: a call that is text moves to
 * `formatTime`, a key to `osloDay`, and its line goes. Nothing is ever added.
 */

import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { test } from "node:test"

import { sourceFiles } from "./source-files.ts"

const root = join(import.meta.dirname, "..")
/** `packages/intl/src`: the formatting itself, and the day keys and ranges its helpers compute. */
const HOME = /^packages\/intl\/src\//

const TIME_FORMATTING = /\bIntl\.(?:DateTimeFormat|RelativeTimeFormat)\b|\.toLocale(?:Date|Time)String\b|\.toUTCString\b|\.toDateString\b|\.toTimeString\b|\.toISOString\b|\.get(?:UTC)?(?:Hours|Minutes|Seconds|Date|Day|Month|FullYear)\b|\bformatDate\(/g

const ALLOWED: Readonly<Record<string, number>> = {
  "apps/forside/web/src/lib/next-sync.ts": 5,
  "apps/music/web/src/server/api.ts": 1,
  "apps/music/web/src/server/entities.ts": 1,
  "apps/podkast/web/src/server/podcast-stats.ts": 4,
  "packages/timeline/src/timeline.ts": 4,
  "packages/ui/src/lib/log-series.ts": 1,
  "packages/watch/src/api.ts": 1,
  "packages/watch/src/film-log-entry.ts": 1,
  "packages/watch/src/viewing.ts": 1,
}

const sources = (): string[] =>
  ["apps", "packages"].flatMap((top) => sourceFiles(join(root, top), /\.(?:tsx?|astro)$/)).filter((file) => {
    const path = relative(root, file).replaceAll("\\", "/")
    return !/\.test\.tsx?$/.test(path) && !HOME.test(path) && /^(?:apps\/[^/]+\/web\/src|packages\/[^/]+\/src)\//.test(path)
  })

test("a time is formatted by packages/intl/src/time.ts alone: the files that still do it themselves are the ones listed, no more times than listed", () => {
  const found: Record<string, number> = {}
  for (const file of sources()) {
    const count = readFileSync(file, "utf8").match(TIME_FORMATTING)?.length ?? 0
    if (count > 0) found[relative(root, file)] = count
  }
  assert.deepEqual(found, ALLOWED, "a file formats a time itself (use formatTime, Time or osloDay), or ALLOWED lists more than is left (lower it)")
})

test("the rule catches what it is for", () => {
  for (const line of ["new Intl.DateTimeFormat('nb-NO')", "date.toLocaleDateString()", "new Date().toISOString()", "d.getHours()", "formatDate(x, 'en-US')"]) {
    assert.ok(line.match(TIME_FORMATTING), line)
  }
  for (const line of ["formatTime(x, 'clock')", "osloDay(x)", "<Time value={x} />"]) assert.equal(line.match(TIME_FORMATTING), null, line)
})
