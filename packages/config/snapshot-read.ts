/**
 * One API file of the snapshot read from the asset store and parsed by its schema, for a page that renders on the
 * server. Kept apart from `astro-api.ts` because that one reaches `cloudflare:workers` and a unit test cannot load it.
 */
import type * as v from 'valibot'

import { assetJson } from './asset-json.ts'
import { staticJsonFiles } from './static-json-files.ts'

export interface SnapshotRead {
  /** The asset store that holds the snapshot, read lazily. */
  assets: () => Fetcher
  /** The prefix the store keeps its files under: Vite's dev server keeps the app's base, a built `dist/client` does not. */
  assetBase?: string
}

/** `/api/<file>.json` (with `params` as the file's variant) parsed by `schema`; throws, naming the file, when there is none or it does not match. */
export async function readSnapshot<TSchema extends v.GenericSchema>(
  { assets, assetBase = '' }: SnapshotRead,
  origin: string,
  file: string,
  schema: TSchema,
  params: Record<string, string> = {},
): Promise<v.InferOutput<TSchema>> {
  const target = new URL(`/api/${file}.json`, origin)
  for (const [name, value] of Object.entries(params)) target.searchParams.set(name, value)
  const response = await staticJsonFiles({ assets, assetBase })({ request: new Request(target) })
  return assetJson(response, schema, file)
}
