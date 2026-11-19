/**
 * The first place an API answer built from the database differs from the
 * checked-in JSON file, as a path, or `null` when they are the same. Key order
 * is not compared: JSON means the same whatever the order, and Rust writes
 * fields in declaration order while `json!` sorts. The order of rows and
 * arrays is compared, because that is what a visitor sees.
 */
export function jsonDifference(expected: unknown, actual: unknown, path = ''): string | null {
  if (expected === actual) return null

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      const kind = (value: unknown) => (Array.isArray(value) ? 'array' : 'something else')
      return `${path || '(root)'}: expected ${kind(expected)}, found ${kind(actual)}`
    }
    if (expected.length !== actual.length) return `${path}: ${expected.length} entries in the file, ${actual.length} in D1`
    for (const [index, item] of expected.entries()) {
      const found = jsonDifference(item, actual[index], `${path}[${index}]`)
      if (found) return found
    }
    return null
  }

  if (typeof expected === 'object' && typeof actual === 'object' && expected !== null && actual !== null) {
    const fromFile = new Map(Object.entries(expected))
    const fromD1 = new Map(Object.entries(actual))
    for (const key of [...new Set([...fromFile.keys(), ...fromD1.keys()])].toSorted()) {
      if (!fromFile.has(key)) return `${path}.${key}: in D1, missing from the file`
      if (!fromD1.has(key)) return `${path}.${key}: in the file, missing from D1`
      const found = jsonDifference(fromFile.get(key), fromD1.get(key), `${path}.${key}`)
      if (found) return found
    }
    return null
  }

  return `${path}: the file has ${JSON.stringify(expected)}, D1 has ${JSON.stringify(actual)}`
}
