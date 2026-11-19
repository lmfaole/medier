/**
 * The main thread's side of one media app: a `Fetcher` (what `readApi` and the Astro pages call) that sends each request to the app's
 * worker (`media-worker.ts`) and builds the answer from its reply. A worker that dies answers 503 for what it had and is started again.
 */

import { Worker } from "node:worker_threads"

import type { WorkerAsk, WorkerReply, WorkerSetup } from "./media-worker.ts"

export interface AppHostOptions extends Omit<WorkerSetup, "apiModule"> {
  apiModule: string
  log?: (message: string) => void
}

export interface AppHost {
  fetcher: { fetch(request: Request): Promise<Response> }
  ready: Promise<void>
  close(): Promise<void>
}

const RESTART_MS = 1000
/**
 * A worker's own heap ceiling. Without it a worker that outgrew the default (~500 MB in the container) took the whole process down
 * (V8 "heap out of memory", SIGSEGV), so every app was gone until the unit restarted. With it, only this worker is stopped with
 * ERR_WORKER_OUT_OF_MEMORY, `lost` starts it again and the other apps keep answering. Sized under the container's `Memory=`.
 */
export const WORKER_HEAP_MB = 1024

export function createAppHost(options: AppHostOptions): AppHost {
  const { log = console.error, ...setup } = options
  const pending = new Map<number, { resolve(reply: WorkerReply): void; reject(error: Error): void }>()
  let counter = 0
  let worker: Worker | undefined
  let closing = false
  let markReady: () => void = () => {}
  let markFailed: (error: Error) => void = () => {}
  let ready = new Promise<void>((resolve, reject) => {
    markReady = resolve
    markFailed = reject
  })
  // Nobody awaits the first start until a request needs it, so a failed start must not be an unhandled rejection.
  ready.catch(() => {})

  function start(): void {
    const next = new Worker(new URL("./media-worker.ts", import.meta.url), { workerData: { setup }, resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } })
    worker = next
    next.on("message", (message: WorkerReply | { ready: true } | { log: string }) => {
      if ("log" in message) log(message.log)
      else if ("ready" in message) markReady()
      else pending.get(message.id)?.resolve(message)
    })
    const lost = (reason: string) => {
      if (worker !== next) return
      worker = undefined
      for (const [id, waiting] of pending) {
        pending.delete(id)
        waiting.reject(new Error(reason))
      }
      if (!closing) {
        log(`${setup.name}: worker stopped (${reason}); starting it again`)
        setTimeout(start, RESTART_MS).unref()
      }
    }
    next.on("error", (error) => {
      markFailed(error)
      lost(error.message)
    })
    next.on("exit", (code) => lost(`exit ${code}`))
  }

  start()

  return {
    ready,
    fetcher: {
      async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)
        const ask: WorkerAsk = { id: ++counter, path: `${url.pathname}${url.search}`, ifNoneMatch: request.headers.get("If-None-Match") }
        await ready
        if (worker === undefined) return new Response("the data is not available right now", { status: 503 })
        const reply = await new Promise<WorkerReply>((resolve, reject) => {
          pending.set(ask.id, { resolve, reject })
          // A worker thread has no origin to target; the rule is about window.postMessage.
          // oxlint-disable-next-line unicorn/require-post-message-target-origin
          worker?.postMessage(ask)
        }).catch(() => undefined)
        if (reply === undefined) return new Response("the data is not available right now", { status: 503 })
        return new Response(reply.body, { status: reply.status, headers: reply.headers })
      },
    },
    async close() {
      closing = true
      await worker?.terminate()
      worker = undefined
    },
  }
}
