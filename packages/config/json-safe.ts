/**
 * Whether a value survives `JSON.stringify` as what its type says, for the snapshot: the page reads the file as the type of
 * the loader's answer (`ApiResponses`), so a `number` that was `NaN` and became `null`, or a `Date` that became text, is a
 * lie the compiler cannot see. A field that is `undefined` in an object is not one: it is absent, which reads as `undefined`.
 */

const MAX_PROBLEMS = 5

/** What would change on the way through JSON, one line each with the path to it, at most five; none means the value is the same. */
export function jsonProblems(value: unknown, path = '$', seen: Set<object> = new Set()): string[] {
  const found: string[] = []
  const add = (reason: string): void => {
    if (found.length < MAX_PROBLEMS) found.push(`${path}: ${reason}`)
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || value === undefined) return found
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) add(`${value} becomes null`)
    return found
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    add(`a ${typeof value} is not JSON`)
    return found
  }
  if (seen.has(value)) {
    add('refers to itself')
    return found
  }
  seen.add(value)
  const plain = Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null
  if (!plain) {
    add(`${value.constructor.name} becomes something else (a Date becomes text, a Map or Set becomes {})`)
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (item === undefined) add(`[${index}] is undefined and becomes null`)
      else for (const problem of jsonProblems(item, `${path}[${index}]`, seen)) if (found.length < MAX_PROBLEMS) found.push(problem)
    })
  } else {
    for (const [key, item] of Object.entries(value)) for (const problem of jsonProblems(item, `${path}.${key}`, seen)) if (found.length < MAX_PROBLEMS) found.push(problem)
  }
  seen.delete(value)
  return found
}
