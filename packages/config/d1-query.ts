/**
 * Rows from D1, checked against a schema before anything reads them. D1 hands
 * back whatever the table holds, typed as whatever the caller asks for, so a
 * renamed column or a schema drift used to reach the page as `undefined`.
 * Now it is an error here, which `d1JsonFiles` answers with the static file or
 * a 503, the same as when D1 is down.
 */

import * as v from 'valibot'

/** The rows `sql` reads, each parsed by `schema`, which also gives them their type. */
export async function queryRows<TSchema extends v.GenericSchema>(
  db: D1Database,
  sql: string,
  schema: TSchema,
  ...parameters: unknown[]
): Promise<v.InferOutput<TSchema>[]> {
  const prepared = db.prepare(sql)
  const answer = await (parameters.length > 0 ? prepared.bind(...parameters) : prepared).all()
  const rows = Array.isArray(answer) ? answer : (answer.results ?? [])
  const result = v.safeParse(v.array(schema), rows)
  if (!result.success) {
    throw new Error(`rows from "${sql.replace(/\s+/g, ' ').slice(0, 80)}" do not match their schema: ${v.summarize(result.issues)}`)
  }
  return result.output
}
