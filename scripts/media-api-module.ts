/**
 * What an app's `web/src/server/api.ts` must export, for the server (`media-server.ts`) and for the app's worker thread (`media-worker.ts`):
 * `API` and `DOMAINS`. A media app has at least one SQLite domain; a home app has `DOMAINS = []` and file loaders (`@designsystem/config/apper-files`).
 */

import * as v from "valibot"

import type { ApiLoader } from "@designsystem/config/api-files"
import type { FileLoader } from "@designsystem/config/apper-files"

const isFunction = (value: unknown): boolean => typeof value === "function"

export const SqliteApiModule = v.object({
  API: v.record(v.string(), v.custom<ApiLoader>(isFunction, "an API entry is not a loader function")),
  DOMAINS: v.pipe(v.array(v.string()), v.minLength(1)),
})

export const FilesApiModule = v.object({
  API: v.record(v.string(), v.custom<FileLoader>(isFunction, "an API entry is not a loader function")),
  DOMAINS: v.strictTuple([]),
})

export type SqliteModule = v.InferOutput<typeof SqliteApiModule>
export type FilesModule = v.InferOutput<typeof FilesApiModule>

/** The app's API module, checked: the one with domains is SQLite-backed, the one with none is file-backed. */
export function parseApiModule(loaded: unknown): { kind: "sqlite"; module: SqliteModule } | { kind: "files"; module: FilesModule } {
  // `DOMAINS: []` decides, so a broken file-backed module is reported as one and not as a SQLite one with no domain.
  if (v.is(v.object({ DOMAINS: v.strictTuple([]) }), loaded)) return { kind: "files", module: v.parse(FilesApiModule, loaded) }
  return { kind: "sqlite", module: v.parse(SqliteApiModule, loaded) }
}
