import type { ReactNode } from 'react'

import { appUrl } from '../lib/base-url'
import { formatCount } from '@designsystem/intl/listening'
import { Star } from '@lmfaole/designsystem/lib/icons'
import { CountUp } from '@lmfaole/designsystem/components/count-up'
import { ExternalLink } from '@lmfaole/designsystem/components/external-link'
import { Reveal } from '@lmfaole/designsystem/components/reveal'
import { TextLink } from '@lmfaole/designsystem/components/text'

/**
 * The head of the page of one thing, in the page's column like everything under it, with the same edges: its picture (`banner`:
 * a backdrop, a screenshot, a photo of the artist, or else its cover) in a rounded box and its name under it, nothing more. The
 * picture is rarely as wide as the box: a square photo stretched over a wide one is a blown-up piece of a face. So it stands whole
 * at its own shape, at the left edge of the column, over a blurred copy of itself that fills the box; no gradient, no bleeding
 * out of the column. What else there is to say of it (what kind of thing, the line under its name, its rating, its links, its
 * summary) is `EntityAbout`. A thing with no picture (a person) is only the name.
 */
export function EntityHero({ name, cover, banner }: { name: string; cover?: string | null | undefined; banner?: string | null | undefined }) {
  const picture = banner || cover
  return (
    <header className="grid gap-4">
      {picture ? (
        <div className="relative isolate h-64 overflow-clip rounded-xl bg-muted sm:h-80 2xl:h-96">
          <img className="pointer-events-none absolute -inset-[10%] -z-10 size-[120%] max-w-none object-cover opacity-60 blur-2xl saturate-150" src={appUrl(picture)} alt="" aria-hidden="true" />
          <img className="pointer-events-none absolute inset-0 size-full object-contain object-center sm:object-left" src={appUrl(picture)} alt="" aria-hidden="true" />
        </div>
      ) : null}
      <Reveal>
        <h1 className="text-3xl leading-tight font-bold [overflow-wrap:anywhere] sm:text-4xl">{name}</h1>
      </Reveal>
    </header>
  )
}

/**
 * The about of the page of one thing (the rail beside the sections, or under the head where it has none): what its head no longer says. What kind of thing it is, the line that stood under its
 * name, its rating, its links out as pills, the maker's logo and what is said of it at more length (`info`, from `aboutOf`).
 * Nothing when there is nothing to say beyond the kind.
 */
export function EntityAbout({ name, kicker, subtitle, info, rating, ratingLabel, mark, links, inRail = false }: { inRail?: boolean; ratingLabel?: string; name: string; kicker?: string | undefined; subtitle?: ReactNode; info?: ReactNode; rating?: number | null | undefined; mark?: ReactNode; links?: readonly (readonly [string, string | null])[] }) {
  const shownLinks = (links ?? []).filter((link): link is readonly [string, string] => link[1] !== null && link[1] !== '')
  const hasRating = rating !== null && rating !== undefined
  // What kind of thing it is alone is no section: its head already says what it is.
  if (!subtitle && !info && !hasRating && !mark && shownLinks.length === 0) return null
  return (
    <section aria-label={`Om ${name}`} className={`grid gap-3 text-sm ${inRail ? "" : "mt-6 border-t pt-6"}`}>
      <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">{kicker ?? 'Om'}</p>
      {subtitle ? <p className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{subtitle}</p> : null}
      {hasRating ? <Stars rating={rating} label={ratingLabel} /> : null}
      {info}
      {shownLinks.length === 0 ? null : (
        <p className="flex flex-wrap gap-2">
          {shownLinks.map(([label, href]) => (
            <ExternalLink key={label} href={href} look="pill">
              {label}
            </ExternalLink>
          ))}
        </p>
      )}
      {mark ? <div>{mark}</div> : null}
    </section>
  )
}

/** A rating of five as five stars, a half star where the rating has a half; the number is for a screen reader. */
function Stars({ rating, label }: { rating: number; label?: string | undefined }) {
  return (
    <p role="img" aria-label={label ?? `Vurdering ${rating.toLocaleString('nb-NO')} av 5`} className="grid grid-flow-col justify-start gap-0.5 text-foreground">
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} className="relative size-5">
          <Star aria-hidden="true" className="absolute inset-0 size-5 text-foreground/25" />
          <span className="absolute inset-0 overflow-hidden" style={{ width: rating >= star ? '100%' : rating >= star - 0.5 ? '50%' : '0%' }}>
            <Star aria-hidden="true" className="size-5 fill-current" />
          </span>
        </span>
      ))}
    </p>
  )
}

/** A figure with its caption, as one line of the list of figures: the caption on the left, the figure at the end of the same line. A number counts up; text (a date, a place) is shown as it is. */
export function Stat({ label, value, note, href }: { label: string; value: number | string; note?: string | undefined; href?: string | undefined }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-base font-semibold tabular-nums">
        {typeof value === 'number' ? <CountUp value={value} format={formatCount} /> : href === undefined ? value : <TextLink href={href}>{value}</TextLink>}
        {note ? <span className="block text-xs font-normal text-muted-foreground">{note}</span> : null}
      </dd>
    </div>
  )
}

/** The figures of a page's thing, one under the other (the list is read down, never in tiles side by side). */
export function StatTiles({ children }: { children: ReactNode }) {
  return <dl className="grid gap-3">{children}</dl>
}
