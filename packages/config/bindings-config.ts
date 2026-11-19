/**
 * Whether a Worker's config binds a data store.
 *
 * An app's Worker holds code and the static snapshot built from the local databases, and nothing
 * else: no database, bucket, key-value store or VPC service. Every app is public, so a binding is
 * the one way data outside the snapshot could be reached, and a deploy that carries one is refused
 * (`scripts/deploy-app.ts`). Only the top level counts: a named `env` (the local development one)
 * is never what is deployed.
 */

const DATA_STORES = ['d1_databases', 'hyperdrive', 'kv_namespaces', 'r2_buckets', 'vectorize', 'vpc_services']

/**
 * Drops `//` and block comments, so a var that is only commented out does not
 * read as set. Walks the text rather than replacing with a regex, because a
 * value in these files is a `https://` URL and the `//` in it is not a comment.
 */
function withoutComments(text: string): string {
  let out = ''
  let quote: string | null = null

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (quote !== null) {
      out += char
      if (char === '\\') {
        out += next ?? ''
        index += 1
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      out += char
    } else if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
      out += '\n'
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 1
    } else {
      out += char
    }
  }

  return out
}

/**
 * The data-store bindings a `wrangler.jsonc` or a built `wrangler.json` has at its top level, by key,
 * sorted; `[]` when it has none. A config that cannot be read is reported rather than passed.
 */
export function forbiddenBindings(configText: string): string[] {
  let config: unknown
  try {
    config = JSON.parse(withoutComments(configText))
  } catch {
    return ['unreadable config']
  }
  if (typeof config !== 'object' || config === null) return ['unreadable config']
  return DATA_STORES.filter((key) => {
    const value: unknown = Reflect.get(config, key)
    return Array.isArray(value) ? value.length > 0 : value !== undefined
  })
}
