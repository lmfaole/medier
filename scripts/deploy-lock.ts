/**
 * One deploy per app at a time. A deploy builds into `web/dist`, and an Astro build empties it first, so a second
 * deploy of the same app (the publish timer while `npm run ship` runs by hand) deletes the first one's
 * `web/dist/server/wrangler.json` between its build and its `wrangler deploy`. The second deploy waits for the lock
 * instead. A lock whose holder is gone (crash, reboot) is taken over, so it never needs a person to clear it.
 */

import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"

export type LockAction = "take" | "wait" | "takeOver"

/** What to do about a lock file: `holder` is its pid text (null when there is no file), `alive` says whether that process runs. */
export function lockAction(holder: string | null, alive: (pid: number) => boolean): LockAction {
  if (holder === null) return "take"
  const pid = Number(holder.trim())
  if (!Number.isInteger(pid) || pid <= 0) return "takeOver"
  return alive(pid) ? "wait" : "takeOver"
}

export interface LockIo {
  read: (file: string) => string | null
  /** Creates the file with this text; false when it already exists. */
  create: (file: string, text: string) => boolean
  remove: (file: string) => void
  alive: (pid: number) => boolean
  sleep: (ms: number) => void
  now: () => number
  report: (message: string) => void
}

/** Takes the lock, waiting up to `maxWaitMs` for a running deploy; throws when it is still held. Returns the release. */
export function acquireLock(file: string, pid: number, io: LockIo, maxWaitMs = 30 * 60_000, pollMs = 5_000): () => void {
  const started = io.now()
  let said = false
  for (;;) {
    const action = lockAction(io.read(file), io.alive)
    if (action === "takeOver") io.remove(file)
    if (action !== "wait" && io.create(file, `${pid}\n`)) return () => io.remove(file)
    if (action === "wait") {
      if (io.now() - started > maxWaitMs) throw new Error(`another deploy still holds ${file} after ${Math.round(maxWaitMs / 60_000)} minutes`)
      if (!said) io.report(`another deploy of this app is running, waiting for it (${file})`)
      said = true
      io.sleep(pollMs)
    }
  }
}

export const fileLockIo: Omit<LockIo, "report"> = {
  read: (file) => {
    try {
      return readFileSync(file, "utf8")
    } catch {
      return null
    }
  },
  create: (file, text) => {
    try {
      const fd = openSync(file, "wx")
      writeFileSync(fd, text)
      closeSync(fd)
      return true
    } catch {
      return false
    }
  },
  remove: (file) => {
    try {
      unlinkSync(file)
    } catch {
      /* already gone */
    }
  },
  alive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      // EPERM: the process exists but is another user's. ESRCH: it is gone.
      return typeof error === "object" && error !== null && "code" in error && error.code === "EPERM"
    }
  },
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  now: () => Date.now(),
}
