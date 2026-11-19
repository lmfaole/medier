/**
 * When a timer may publish an app: its latest sync must have finished well and the snapshot must differ from what
 * the last publication shipped. A pure decision, so it can be read and tested without Cloudflare, systemd or a database.
 */

import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type PublishDecision = { publish: true } | { publish: false; reason: string }

/** Whether to publish: nothing after a failed or unfinished sync, and nothing when the snapshot is the one already shipped. */
export function shouldPublish({ syncsOk, hash, publishedHash }: { syncsOk: boolean; hash: string; publishedHash: string | null }): PublishDecision {
  if (!syncsOk) return { publish: false, reason: "the latest sync did not finish well" }
  if (hash === publishedHash) return { publish: false, reason: "the snapshot is the one already published" }
  return { publish: true }
}

/**
 * The runs that decide whether an app may publish: its sources' latest runs, and of a source with a list of jobs only those.
 * A job named in `ignoring` (by its name, without the arguments the log keeps with it) never holds a publication back.
 */
export function gatingRuns<Run extends { source: string; job: string }>(
  runs: readonly Run[],
  publishing: { sources: string[]; jobs?: Record<string, string[]>; ignoring?: Record<string, string[]> },
): Run[] {
  return runs.filter(
    (run) =>
      publishing.sources.includes(run.source) &&
      (publishing.jobs?.[run.source]?.includes(run.job) ?? true) &&
      !publishing.ignoring?.[run.source]?.includes(run.job.split(" ")[0] ?? run.job),
  )
}

/**
 * Whether a publication can have anything new to read since its last attempt, so the snapshot (minutes of CPU and
 * gigabytes of memory) is built only then: yes when there was no finished, successful attempt, or when one of `runs` (the
 * gating runs and the inbox imports) finished after that attempt started. A run that finished during the attempt counts.
 */
export function newSinceLastPublish(
  lastPublish: { startedAt: string; finishedAt: string | null; ok: boolean } | undefined,
  runs: readonly { finishedAt: string | null }[],
): boolean {
  if (lastPublish === undefined || lastPublish.finishedAt === null || !lastPublish.ok) return true
  const since = Date.parse(lastPublish.startedAt)
  return runs.some((run) => run.finishedAt !== null && Date.parse(run.finishedAt) > since)
}

/** One hash for every file under a directory: names and contents, in a fixed order. */
export function hashTree(directory: string): string {
  const hash = createHash("sha256")
  for (const file of readdirSync(directory, { recursive: true, encoding: "utf8" }).toSorted()) {
    let content: Buffer
    try {
      content = readFileSync(join(directory, file))
    } catch {
      continue
    }
    hash.update(file).update("\0").update(content).update("\0")
  }
  return hash.digest("hex")
}
