/**
 * An app's local SQLite database as SQL for D1. D1 is SQLite, so there is
 * nothing to convert, only INSERT statements; dumping the database rather than
 * reading `data/*.json` gives D1 exactly the rows the local database has.
 */

/** One SQL literal. Apostrophes are doubled; everything else is taken as written. */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`not a finite number: ${value}`)
    return String(value)
  }
  if (typeof value === 'bigint') return String(value)
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`
  return `'${String(value).replaceAll("'", "''")}'`
}

/**
 * The tables in `tables` order (parents first, so foreign keys hold on insert),
 * each emptied first in the reverse order (children first), so a push replaces
 * the rows instead of adding to them. Column names come from the rows, so the
 * dump and the schema cannot drift apart unnoticed.
 */
export function sqlDump(
  tables: string[],
  rowsOf: (table: string) => Record<string, unknown>[],
  source: string,
): { sql: string; counts: Record<string, number> } {
  const lines = [
    `-- Generated from ${source} by packages/config/cli/dump-sql.ts. Do not edit by hand.`,
    '-- Emptied first, so a push replaces the rows instead of adding to them.',
    ...tables.toReversed().map((table) => `DELETE FROM ${table};`),
    '',
  ]
  const counts: Record<string, number> = {}
  for (const table of tables) {
    const rows = rowsOf(table)
    counts[table] = rows.length
    const [first] = rows
    if (first === undefined) continue
    const columns = Object.keys(first).map((column) => `"${column}"`).join(', ')
    lines.push(`-- ${table}: ${rows.length} rows`, `INSERT INTO ${table} (${columns}) VALUES`)
    lines.push(`${rows.map((row) => `  (${Object.values(row).map(sqlLiteral).join(', ')})`).join(',\n')};`, '')
  }
  return { sql: lines.join('\n'), counts }
}
