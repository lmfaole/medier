/**
 * The Worker's bindings for a server route, which get no `env` argument. The
 * one place the untyped `cloudflare:workers` export is given a shape, so each
 * app does not repeat the cast:
 *
 * ```ts
 * const { DB, ASSETS } = cloudflareEnv<LifeEnv>()
 * ```
 *
 * The type argument is the app's own `Env`; nothing here checks it.
 *
 * Never imported by a test: `cloudflare:workers` resolves only inside a Worker,
 * so this module is the one in this package a unit test cannot load.
 */

import { env } from 'cloudflare:workers'

export function cloudflareEnv<Env>(): Env {
  // The runtime gives the bindings no type, and only the app knows its own.
  return env as Env
}