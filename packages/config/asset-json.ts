/**
 * JSON from the asset store, checked before anything reads it. A Worker falls
 * back to the static copy of an API file when D1 fails, and if that file is
 * missing the store answers with the SPA shell's HTML: parsing that as JSON
 * was a bare SyntaxError deep in a request (LMFAOLE-9). Now it is an error
 * that says which file and what came back instead.
 */

import * as v from 'valibot'

/** `response`'s JSON parsed by `schema`; throws, naming `file`, when it is not that. */
export async function assetJson<TSchema extends v.GenericSchema>(
  response: Response,
  schema: TSchema,
  file: string,
): Promise<v.InferOutput<TSchema>> {
  if (!response.ok) throw new Error(`${file}: the asset store answered ${response.status}`)
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(`${file}: the asset store answered ${contentType || 'no content type'}, not JSON`)
  }
  const result = v.safeParse(schema, await response.json())
  if (!result.success) throw new Error(`${file} does not match its schema: ${v.summarize(result.issues)}`)
  return result.output
}
