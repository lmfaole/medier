import { formatNumber } from "./number.ts"

/**
 * Word forms keyed by CLDR plural category. `other` is mandatory — it is
 * the fallback for every locale, including ones that only ever select it
 * (e.g. Japanese). English and Norwegian only ever select "one" or "other",
 * but the type allows "few"/"many"/"two" for locales that need them.
 */
type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }

const pluralRuleSets = new Map<string, Intl.PluralRules>()

function pluralRules(locale: string, options?: Intl.PluralRulesOptions): Intl.PluralRules {
  const key = `${locale}:${JSON.stringify(options ?? {})}`
  let rules = pluralRuleSets.get(key)
  if (!rules) {
    rules = new Intl.PluralRules(locale, options)
    pluralRuleSets.set(key, rules)
  }
  return rules
}

/**
 * Picks the word form matching `count` via `Intl.PluralRules`, and replaces
 * `{count}` in it with a locale-formatted number. Replaces hand-written
 * `count === 1 ? ... : ...` checks, which only happen to work for English
 * and break silently for a locale with more plural categories.
 */
export function pluralize(
  count: number,
  forms: PluralForms,
  locale: string,
  options?: Intl.PluralRulesOptions,
): string {
  const category = pluralRules(locale, options).select(count)
  const form = forms[category] ?? forms.other
  return form.replace("{count}", formatNumber(count, locale))
}
