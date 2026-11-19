/**
 * Reads the two other descriptions of a collection's row, so the spec
 * can be checked against them: the type ts-rs generated from the Rust struct,
 * and the table in the app's `db/schema.sql`. Pure parsing of text; the test
 * (`contracts.test.ts`) does the comparing.
 */

export interface GeneratedField {
  nullable: boolean
  optional: boolean
}

/** The `{ … }` body of the exported type, without comments. */
function typeBody(source: string): string {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  const start = text.indexOf("{", text.indexOf("export type"))
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1
    if (text[index] === "}") depth -= 1
    if (depth === 0) return text.slice(start + 1, index)
  }
  throw new Error("the generated type has no closing brace")
}

/** Whether `null` is one of the type's own alternatives, not one inside a generic. */
function allowsNull(type: string): boolean {
  let depth = 0
  let alternative = ""
  const alternatives: string[] = []
  for (const character of type) {
    if ("{[(<".includes(character)) depth += 1
    if ("}])>".includes(character)) depth -= 1
    if (character === "|" && depth === 0) {
      alternatives.push(alternative.trim())
      alternative = ""
    } else alternative += character
  }
  return [...alternatives, alternative.trim()].includes("null")
}

/** The fields of a ts-rs generated type, with whether each may be `null` or absent. */
export function generatedFields(source: string): Map<string, GeneratedField> {
  const fields = new Map<string, GeneratedField>()
  const body = typeBody(source)
  let depth = 0
  let part = ""
  const take = () => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)(\?)?\s*:\s*([\s\S]*)$/.exec(part)
    if (match?.[1] !== undefined) fields.set(match[1], { optional: match[2] === "?", nullable: allowsNull(match[3] ?? "") })
    part = ""
  }
  for (const character of body) {
    if ("{[(<".includes(character)) depth += 1
    if ("}])>".includes(character)) depth -= 1
    if (character === "," && depth === 0) take()
    else part += character
  }
  take()
  return fields
}
