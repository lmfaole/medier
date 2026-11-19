/**
 * What a page of an Astro app reads besides its own data, on top of `readApi`: a file the snapshot may not have (a page of one
 * thing the owner has no record of), and the sentence about when the data last arrived.
 */
import { Freshness } from '@designsystem/ui/lib/freshness'
import type * as v from 'valibot'

import { readApi, readPage } from './astro-api.ts'

/** The text `assetJson` puts in the error of a file the store has not got; any other error (a file that does not match its schema) is a fault, not a 404. */
const MISSING = /the asset store answered 404/

/** `readPage`, or `null` when the snapshot has no file for the request: the page answers 404 itself. */
export async function readPageIfPresent<TSchema extends v.GenericSchema>(url: URL, request: { file: string; params: Record<string, string> }, schema: TSchema): Promise<v.InferOutput<TSchema> | null> {
  try {
    return await readPage(url, request, schema)
  } catch (error) {
    if (error instanceof Error && MISSING.test(error.message)) return null
    throw error
  }
}

/** `/api/oppdatert.json` for the page's foot sentence, or `null` for an app with no sync or a file that is not this shape. */
export function readFreshness(url: URL): Promise<Freshness | null> {
  return readApi(url, 'oppdatert', Freshness).catch(() => null)
}
