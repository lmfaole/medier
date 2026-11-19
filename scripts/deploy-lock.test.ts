import assert from "node:assert/strict"
import { test } from "node:test"

import { acquireLock, type LockIo, lockAction } from "./deploy-lock.ts"

test("lockAction takes a free lock, waits for a live holder and takes over a dead or unreadable one", () => {
  assert.equal(lockAction(null, () => true), "take")
  assert.equal(lockAction("42\n", () => true), "wait")
  assert.equal(lockAction("42\n", () => false), "takeOver")
  assert.equal(lockAction("garbage", () => true), "takeOver")
})

function fakeIo(files: Map<string, string>, aliveUntil: number): LockIo & { clock: { t: number } } {
  const clock = { t: 0 }
  return {
    clock,
    read: (file) => files.get(file) ?? null,
    create: (file, text) => (files.has(file) ? false : (files.set(file, text), true)),
    remove: (file) => void files.delete(file),
    alive: () => clock.t < aliveUntil,
    sleep: (ms) => void (clock.t += ms),
    now: () => clock.t,
    report: () => {},
  }
}

test("acquireLock waits for a running deploy, then holds the lock until released", () => {
  const files = new Map([["l", "7\n"]])
  const release = acquireLock("l", 9, fakeIo(files, 20_000), 60_000, 5_000)
  assert.equal(files.get("l"), "9\n")
  release()
  assert.equal(files.has("l"), false)
})

test("acquireLock gives up when the holder never finishes", () => {
  const files = new Map([["l", "7\n"]])
  assert.throws(() => acquireLock("l", 9, fakeIo(files, Infinity), 20_000, 5_000), /still holds/)
})
