/**
 * Test doubles for a Worker: the asset store, the edge cache
 * and a request through the whole pipeline. Shared by this package's tests and
 * every app's wiring test, which used to carry their own untyped copies of the
 * same stubs. Test code only; no Worker imports it.
 */

import { strict as assert } from 'node:assert'

import type { WorkerEnv, WorkerHandler } from './worker-app.ts'

export interface AssetsStub extends Fetcher {
  /** How many times the store was asked. */
  calls: number
  /** The path of each request it was asked for. */
  paths: string[]
}

/** An asset store answering every request with `body`. */
export function assetsServing(body: BodyInit | null, init: ResponseInit = {}): AssetsStub {
  const stub: AssetsStub = {
    calls: 0,
    paths: [],
    async fetch(request) {
      stub.calls += 1
      stub.paths.push(new URL(request instanceof Request ? request.url : String(request)).pathname)
      return new Response(body, init)
    },
  }
  return stub
}

/** An asset store a test expects never to be read. */
export const unreachableAssets: Fetcher = {
  fetch: async () => assert.fail('assets must not be fetched'),
}

/** Anything a test adds to the Worker's env: `ACCESS_*`, `ASSETS`, a D1 stub. */
export type TestEnv = Partial<WorkerEnv> & Record<string, unknown>

/**
 * `path` through `worker`, with `unreachableAssets` unless `env` names an
 * `ASSETS` of its own. The env is a test double, so it holds only what the
 * test needs, not every binding the app's own `Env` declares.
 */
export function fetchPath(
  worker: WorkerHandler<WorkerEnv>,
  path: string,
  { env = {}, init }: { env?: TestEnv; init?: RequestInit } = {},
): Promise<Response> {
  const ctx: ExecutionContext = { waitUntil() {}, passThroughOnException() {} }
  return worker.fetch(new Request(`https://app.test${path}`, init), { ASSETS: unreachableAssets, ...env }, ctx)
}

/**
 * Replaces `caches.default` with an in-memory one and returns what it holds,
 * keyed by URL. Call it per test for a cache that starts empty.
 */
export function installEdgeCache(): Map<string, Response> {
  const stored = new Map<string, Response>()
  const urlOf = (request: RequestInfo | URL) => (request instanceof Request ? request.url : String(request))
  const cache: Cache = {
    async match(request) {
      return stored.get(urlOf(request))?.clone()
    },
    async matchAll() {
      return [...stored.values()].map((response) => response.clone())
    },
    async put(request, response) {
      stored.set(urlOf(request), response)
    },
    async delete(request) {
      return stored.delete(urlOf(request))
    },
    async keys() {
      return [...stored.keys()].map((url) => new Request(url))
    },
    async add() {
      throw new Error('the test edge cache does not fetch')
    },
    async addAll() {
      throw new Error('the test edge cache does not fetch')
    },
  }
  // `defineProperty` rather than assignment: Node has no `caches`, and the
  // stub is only the slice of `CacheStorage` the Worker code reads.
  Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true, writable: true })
  return stored
}

/** `run`, with `console.error` silenced: for a test of a failure the code logs on purpose. */
export async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  try {
    return await run()
  } finally {
    console.error = original
  }
}

/** A `GET` of `path` through a server route's handler, the way an endpoint is called. */
export function getRoute(handler: (args: { request: Request }) => Promise<Response>, path: string): Promise<Response> {
  return handler({ request: new Request(`https://app.test${path}`) })
}

/** A D1 database answering every query with `rowsFor(sql, parameters)`. Writes succeed and change nothing. */
export function fakeD1(rowsFor: (sql: string, parameters: unknown[]) => unknown[]): D1Database {
  const statement = (sql: string, parameters: unknown[]): D1PreparedStatement => ({
    bind: (...values) => statement(sql, values),
    // D1 hands back rows typed by the caller and checks nothing; so does this double.
    all: async <T>() => ({ results: rowsFor(sql, parameters) as T[], success: true, meta: {} }),
    first: async <T>() => (rowsFor(sql, parameters)[0] ?? null) as T | null,
    run: async () => ({ success: true, meta: {} }),
  })
  return { prepare: (sql) => statement(sql, []), batch: async () => [] }
}
