/**
 * A local SQLite database behind D1's API, so a Worker's own query code runs
 * against it unchanged: `check-d1` runs each app's D1 queries against the
 * database the Rust tool built, and tests run against an in-memory one.
 */

import type { DatabaseSync, SQLInputValue } from 'node:sqlite'

/** A value `node:sqlite` binds; D1 takes the same. */
function sqliteValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value
  if (value instanceof Uint8Array) return value
  throw new TypeError(`not a SQLite value: ${String(value)}`)
}

export function sqliteAsD1(sqlite: DatabaseSync): D1Database {
  const statement = (sql: string, parameters: SQLInputValue[]): D1PreparedStatement => ({
    bind: (...values) => statement(sql, values.map(sqliteValue)),
    // D1 hands back rows typed by the caller and checks nothing; so does this.
    all: async <T>() => sqlite.prepare(sql).all(...parameters) as T[],
    first: async <T>() => (sqlite.prepare(sql).get(...parameters) ?? null) as T | null,
    run: async () => {
      sqlite.prepare(sql).run(...parameters)
      return { success: true, meta: {} }
    },
  })
  return {
    prepare: (sql) => statement(sql, []),
    // One transaction, as D1's batch is: a failing statement rolls back the ones before it.
    batch: async <T>(statements: D1PreparedStatement[]) => {
      sqlite.exec('BEGIN')
      try {
        const results: D1Result<T>[] = []
        for (const prepared of statements) {
          const { success, meta } = await prepared.run()
          results.push({ success, meta })
        }
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
}
