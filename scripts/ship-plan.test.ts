import { strict as assert } from "node:assert"
import { test } from "node:test"

import { type AppResult, formatSummary, jobsFrom, mediaRefusal, type Run, runShip, splitTargets } from "./ship-plan.ts"

const ORDER = ["music", "podkast", "film", "tv", "forside"]
const ok = (seconds = 1, unchanged = false): Run => ({ ok: true, unchanged, seconds })

test("the slowest app starts first and forside is held for last", () => {
  assert.deepEqual(splitTargets(["forside", "tv", "music", "film", "tv"], ORDER), { pool: ["music", "film", "tv"], last: ["forside"] })
  assert.deepEqual(splitTargets(["zzz", "music"], ORDER).pool, ["music", "zzz"])
})

test("--jobs overrides the default, nonsense does not", () => {
  assert.equal(jobsFrom([]), 3)
  assert.equal(jobsFrom(["--jobs", "5"]), 5)
  assert.equal(jobsFrom(["--jobs=2"]), 2)
  assert.equal(jobsFrom(["--jobs", "0"]), 3)
  assert.equal(jobsFrom(["--jobs", "x"]), 3)
})

test("at most `jobs` deploys run at once, and every app runs", async () => {
  let running = 0
  let peak = 0
  const results = await runShip({
    pool: ["a", "b", "c", "d", "e"],
    last: [],
    jobs: 2,
    run: async () => {
      peak = Math.max(peak, ++running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return ok()
    },
  })
  assert.equal(peak, 2)
  assert.deepEqual(results.map((result) => result.app), ["a", "b", "c", "d", "e"])
})

test("apps start in the order given, and a free slot takes the next at once", async () => {
  const log: string[] = []
  const gates = new Map<string, () => void>()
  const done = runShip({
    pool: ["slow", "quick", "next"],
    last: [],
    jobs: 2,
    started: (app) => void log.push(`start ${app}`),
    finished: (result) => void log.push(`end ${result.app}`),
    run: (app) => new Promise((resolve) => gates.set(app, () => resolve(ok()))),
  })
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.deepEqual(log, ["start slow", "start quick"])
  gates.get("quick")?.()
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.deepEqual(log, ["start slow", "start quick", "end quick", "start next"])
  gates.get("slow")?.()
  gates.get("next")?.()
  await done
})

test("a failure (a result or a throw) lets the others finish, is listed, and holds forside back", async () => {
  const started: string[] = []
  const results = await runShip({
    pool: ["a", "b", "c"],
    last: ["forside"],
    jobs: 1,
    started: (app) => void started.push(app),
    run: async (app) => {
      if (app === "a") return { ok: false, unchanged: false, seconds: 3, detail: "exit 1" }
      if (app === "b") throw new Error("spawn failed")
      return ok(2)
    },
  })
  assert.deepEqual(started, ["a", "b", "c"])
  assert.deepEqual(results.map((result) => [result.app, result.outcome]), [["a", "failed"], ["b", "failed"], ["c", "deployed"], ["forside", "held back"]])
  assert.equal(results[1]?.detail, "spawn failed")
})

test("forside runs after every other app has finished, when none failed", async () => {
  const log: string[] = []
  const results = await runShip({
    pool: ["music", "film"],
    last: ["forside"],
    jobs: 2,
    started: (app) => void log.push(`start ${app}`),
    finished: (result) => void log.push(`end ${result.app}`),
    run: async (app) => {
      await new Promise((resolve) => setTimeout(resolve, app === "music" ? 10 : 1))
      return ok(1, app === "film")
    },
  })
  assert.deepEqual(log, ["start music", "start film", "end film", "end music", "start forside", "end forside"])
  assert.deepEqual(results.map((result) => result.outcome), ["deployed", "unchanged", "deployed"])
})

test("the summary has a line per app and the wall clock against the sum", () => {
  const results: AppResult[] = [
    { app: "music", outcome: "deployed", seconds: 244 },
    { app: "tv", outcome: "unchanged", seconds: 52 },
    { app: "forside", outcome: "held back", seconds: 0, detail: "tv failed, and forside redirects to the apps" },
  ]
  const text = formatSummary(results, 250)
  assert.match(text, /^music {4}deployed {4}4m04s$/m)
  assert.match(text, /^tv {7}unchanged {2} {3}52s$/m)
  assert.match(text, /forside {2}held back/)
  assert.match(text, /total 4m10s \(the apps one after another: 4m56s\), 1 not deployed/)
})

test("an app of the media server is refused with the way to put it live, and says so in the singular and the plural", () => {
  assert.match(mediaRefusal(["film"]), /^film is served by the media server: it no longer deploy.*npm run media:build.*restart/)
  assert.match(mediaRefusal(["film", "tv"]), /^film, tv are served by the media server: they no longer deploy/)
})
