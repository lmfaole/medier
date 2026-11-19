/**
 * Number and currency formatting shared by `cv`, `budget` and `music`.
 * `Intl.NumberFormat` is cheap to call but not free to construct, so
 * instances are cached per locale/options pair.
 */

const numberFormats = new Map<string, Intl.NumberFormat>()

function numberFormat(locale: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}:${JSON.stringify(options ?? {})}`
  let format = numberFormats.get(key)
  if (!format) {
    format = new Intl.NumberFormat(locale, options)
    numberFormats.set(key, format)
  }
  return format
}

/** Formats a plain number for `locale`, e.g. thousands separators. */
export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions): string {
  return numberFormat(locale, options).format(value)
}

/** Formats `value` as a whole amount of `currency` for `locale`. */
export function formatCurrency(
  value: number,
  locale: string,
  currency: string,
  options?: Intl.NumberFormatOptions,
): string {
  return numberFormat(locale, { style: "currency", currency, ...options }).format(value)
}

/** 4.5 → «4,5»: a rating in half steps, without a trailing «,0». */
export function formatRating(rating: number): string {
  return formatNumber(rating, "nb-NO", { minimumFractionDigits: rating % 1 === 0 ? 0 : 1, maximumFractionDigits: 1 })
}

/** 4.5 → «4,5 av 5»: how every app writes the owner's own rating. */
export function formatRatingOfFive(rating: number): string {
  return `${formatRating(rating)} av 5`
}

/**
 * A sum of money as a page writes it: «199 kr» for NOK (the way a Norwegian says it, not «NOK 199»), the currency code after the number for any other («9,99 USD»),
 * up to two decimals and none that are zero. A currency that is not known is left off, so a number is never shown as something it is not.
 */
export function formatAmount(value: number, currency?: string, locale = "nb-NO"): string {
  const unit = currency === "NOK" ? "kr" : (currency ?? "")
  return `${formatNumber(value, locale, { maximumFractionDigits: 2 })} ${unit}`.trim().replace(" ", " ")
}
