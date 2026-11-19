/**
 * The API of a home app (innboks, hjem, penger, rss): files the exporters of the Nextcloud repository write (`Apper/*.json`, also as a
 * host copy that the media server reads read-only, `scripts/media-files.ts`), not a database. An app's `server/api.ts` exports
 * `API` (one `FileLoader` per `/api/<name>.json` it serves) and `DOMAINS = []`, which is how the server knows there is no SQLite behind it.
 *
 * The loaders are as thin as the SQL ones are: each reads one named file and parses it with the app's own valibot schema (`jsonFile`),
 * so a file that does not match is an error at the read, and the page's `RESPONSES` schema `satisfies` `FileApiResponsesOf<typeof API>`.
 * Nothing here writes: the data is the owner's, written by the exporters, and an owner's input goes from the browser to Nextcloud.
 */
import * as v from 'valibot'

/** A file name below the folder: lowercase and digit segments, `logg/2026-10.json`; never `..`, a leading slash or an extension but `.json`. */
export const APPER_FILE_NAME = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/

/** Where a loader reads from: the text of a named file, or `null` when it is not there. */
export interface ApperSource {
  read(name: string): Promise<string | null>
}

/** One API file, made from the files and the request. `null` is a 404; a throw is the server's log and a 502 or 503. */
export type FileLoader = (source: ApperSource, url: URL) => Promise<unknown>

/** An app's `API` map when it is file-backed. */
export type FileApi = Record<string, FileLoader>

/** Each API file mapped to what its loader returns, the file-backed `ApiResponsesOf`. */
export type FileApiResponsesOf<Api extends FileApi> = {
  [File in keyof Api]: Awaited<ReturnType<Api[File]>>
}

/** A file that is there but is not JSON, or not the shape its schema says: the exporter and the app disagree, which is a 502 and not a missing page. */
export class ApperFileInvalid extends Error {
  readonly file: string
  constructor(file: string, reason: string) {
    super(`${file}: ${reason}`)
    this.name = 'ApperFileInvalid'
    this.file = file
  }
}

/** The loader of one file: its text parsed as JSON and checked by `schema`; `null` when the file is not there. */
export function jsonFile<TSchema extends v.GenericSchema>(name: string, schema: TSchema): (source: ApperSource) => Promise<v.InferOutput<TSchema> | null> {
  if (!APPER_FILE_NAME.test(name)) throw new Error(`jsonFile: "${name}" is not a plain relative .json name`)
  return async (source) => {
    const text = await source.read(name)
    if (text === null) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new ApperFileInvalid(name, 'not JSON')
    }
    const result = v.safeParse(schema, parsed)
    if (!result.success) {
      const [issue] = result.issues
      const at = issue?.path?.map((part) => String(part.key)).join('.') ?? ''
      throw new ApperFileInvalid(name, `${issue?.message ?? 'does not match its schema'} at ${at === '' ? '(root)' : at}`)
    }
    return result.output
  }
}
