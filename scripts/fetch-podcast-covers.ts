/**
 * `npm run snapshot` in `apps/podkast`, after the snapshot: lands every show picture `covers.json` names (`images.ts`),
 * so the app serves them itself. The file lists each path with the address it comes from; only a host the feeds use is asked for.
 */

import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { SHOW_COVER_PATH, showCoverSourceOf } from "@designsystem/intl/podcast-covers"
import * as v from "valibot"

import { httpFetcher, landImages } from "./images.ts"

const appDirectory = process.cwd()
const file = join(appDirectory, "web", "public", "api", "covers.json")
const Covers = v.array(v.object({ cover: v.string(), coverSource: v.string() }))
const covers = existsSync(file) ? v.parse(Covers, JSON.parse(readFileSync(file, "utf8"))) : []
const sources = new Map(covers.flatMap((entry) => {
  const url = SHOW_COVER_PATH.test(entry.cover) ? showCoverSourceOf(entry.coverSource) : null
  return url === null ? [] : [[entry.cover, url] as const]
}))
const named = [...sources.keys()].toSorted()
const result = await landImages({
  named,
  prefix: "/covers/",
  store: join(resolve(appDirectory, "..", ".."), ".data", "raw", "podcast-covers"),
  target: join(appDirectory, "web", "public", "covers"),
  upstream: (path) => {
    const url = sources.get(path)
    return url === undefined ? null : { url, headers: { "User-Agent": "podkast-covers/0.1 (+https://sky.lmfaole.party/apps/medier/podkast)" } }
  },
  fetcher: httpFetcher,
})
console.log(`covers: ${named.length} named, ${result.kept} already here, ${result.landed} landed, ${result.missing.length} the host did not give (tried again next time)`)
