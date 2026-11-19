/** One answer per database: a snapshot asks for hundreds of files, and each of them says the same. */
export function readOnce<Answer>(load: (db: D1Database) => Promise<Answer>): (db: D1Database) => Promise<Answer> {
  const read = new WeakMap<D1Database, Promise<Answer>>()
  return (db: D1Database) => {
    const cached = read.get(db)
    if (cached !== undefined) return cached
    const answer = load(db)
    read.set(db, answer)
    return answer
  }
}
