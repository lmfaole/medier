/**
 * Hand-written ambient types for the slice of the Cloudflare Workers
 * runtime these apps' `src/worker.ts` files actually call: D1, the
 * `ASSETS` binding, the platform's cache and its streams.
 * `Request`/`Response`/`fetch`/`caches`/`Cache` themselves come from
 * TypeScript's own "webworker" lib, which the Workers runtime closely
 * follows for this subset.
 *
 * None of these apps add `@cloudflare/workers-types` as a dependency (see
 * "Do not add dependencies" in the repository's custom instructions), so
 * this file is the stand-in — typed against actual call sites, not a full
 * reproduction of the runtime.
 */

interface D1Result<T = unknown> {
  results?: T[]
  success: boolean
  meta: Record<string, unknown>
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  all<T = unknown>(): Promise<D1Result<T> | T[]>
  run(): Promise<D1Result>
  first<T = unknown>(column?: string): Promise<T | null>
}

interface D1Database {
  prepare(query: string): D1PreparedStatement
  /** Runs the statements in one transaction: all of them apply, or none. */
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
}

/** The shape of an `assets` binding (`env.ASSETS`), which only ever needs `fetch`. */
interface Fetcher {
  fetch(request: Request): Promise<Response>
}

/** The third argument to a Worker's `fetch`: work that may outlive the response. */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

/** The pair `IdentityTransformStream` gives, which is also what `TransformStream` gives. */
interface WritableStreamPair {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
}

/**
 * workerd's `IdentityTransformStream`: a stream that copies nothing, so a
 * body can be written into a response without JavaScript touching its bytes.
 * Optional, because the standard `TransformStream` is the fallback off
 * workerd, and TypeScript's DOM lib knows neither. Read it off `globalThis`,
 * not as a bare identifier, so a runtime without it falls back rather than
 * throwing.
 */
declare var IdentityTransformStream: (new () => WritableStreamPair) | undefined

/**
 * The Worker's bindings, which an Astro endpoint reads from here (`cloudflare-env.ts`
 * gives them a shape) because it gets no `env` argument.
 */
declare module 'cloudflare:workers' {
  export const env: unknown
}

/**
 * The Workers runtime's `caches.default`, a Cloudflare-specific extension
 * over the standard `CacheStorage` interface (which only has `.open()`).
 */
interface CacheStorage {
  readonly default: Cache
}
