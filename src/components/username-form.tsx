import { Button } from "@lmfaole/designsystem/components/button"
import { Icon } from "@lmfaole/designsystem/components/icon"
import type { IconName } from "@lmfaole/designsystem/lib/icons"
import { Inline, Stack } from "@lmfaole/designsystem/components/layout"
import { Heading, Text, TextLink } from "@lmfaole/designsystem/components/text"
import { TextField } from "@lmfaole/designsystem/components/text-field"

import { type Service, SERVICE_NAME, type Users } from "../lib/users.ts"

/*
 * TEMPORARY: stand-ins for the design system's `UsernameForm` and `UserChip` (8.48.0), with the same props, until it is released; the wiring step swaps these imports for
 * `@lmfaole/designsystem/components/username-form` and `…/user-chip` and deletes this file. Server-rendered, no client JS: a plain form that posts to `/api/brukernavn`.
 */

export interface UsernameField {
  name: string
  label: string
  value?: string
  hint?: string
  error?: string
  autoComplete?: string
  placeholder?: string
}

export interface UsernameFormProps {
  title: string
  body?: string
  action: string
  back: string
  fields: UsernameField[]
  submitLabel?: string
  icon?: IconName
  headingLevel?: 2 | 3
}

export function UsernameForm({ title, body, action, back, fields, submitLabel = "Hent data", icon, headingLevel = 2 }: UsernameFormProps) {
  const headingId = `brukernavn-${fields.map((field) => field.name).join("-")}`
  return (
    <Stack as="section" gap="md" aria-labelledby={headingId}>
      <Inline gap="sm">
        {icon === undefined ? null : <Icon name={icon} />}
        <Heading level={headingLevel} id={headingId}>
          {title}
        </Heading>
      </Inline>
      {body === undefined ? null : <Text tone="muted">{body}</Text>}
      <form method="post" action={action}>
        <Stack gap="md">
          <input type="hidden" name="back" value={back} />
          {fields.map((field) => (
            <TextField key={field.name} label={field.label} name={field.name} {...(field.value === undefined ? {} : { defaultValue: field.value })} {...(field.hint === undefined ? {} : { hint: field.hint })} {...(field.error === undefined ? {} : { error: field.error })} autoComplete={field.autoComplete ?? "username"} />
          ))}
          <Inline>
            <Button type="submit">{submitLabel}</Button>
          </Inline>
        </Stack>
      </form>
    </Stack>
  )
}

export function UserChip({ label = "Viser data for", user, href, changeLabel = "Bytt" }: { label?: string; user: string; href: string; changeLabel?: string }) {
  return (
    <Text size="sm" tone="muted">
      {label} {user} · <TextLink href={href}>{changeLabel}</TextLink>
    </Text>
  )
}

const HINT: Record<Service, string> = {
  lastfm: "Brukernavnet ditt på last.fm, der avspillingene dine blir registrert.",
  trakt: "Brukernavnet ditt på trakt.tv. Profilen må være offentlig.",
}

const NOT_FOUND: Record<Service, (value: string) => string> = {
  lastfm: (value) => `Fant ingen bruker som heter «${value}» på Last.fm. Sjekk stavingen.`,
  trakt: (value) => `Fant ingen offentlig profil som heter «${value}» på Trakt. Sjekk stavingen, og at profilen ikke er privat.`,
}

/** The fields for the services a page needs, filled in with what the visitor has (or typed, when it was not found), with the error of one that was not found. */
export function usernameFields(services: readonly Service[], users: Users, error: { service: Service; value: string } | null): UsernameField[] {
  return services.map((service) => {
    const failed = error?.service === service
    const value = failed ? error.value : (users[service] ?? undefined)
    return { name: service, label: `Brukernavn på ${SERVICE_NAME[service]}`, hint: HINT[service], ...(value === undefined ? {} : { value }), ...(failed ? { error: NOT_FOUND[service](error.value) } : {}) }
  })
}

/** The usernames the visitor has given, in words for the chip: one name where both are the same, else each with its service. */
export function usersText(users: Users): string | null {
  if (users.lastfm !== null && users.trakt !== null) return users.lastfm.toLowerCase() === users.trakt.toLowerCase() ? users.lastfm : `${users.lastfm} (Last.fm) og ${users.trakt} (Trakt)`
  if (users.lastfm !== null) return `${users.lastfm} (Last.fm)`
  if (users.trakt !== null) return `${users.trakt} (Trakt)`
  return null
}

export const FORM_BODY = "Vi viser bare det som er offentlig på profilen. Brukernavnet lagres i en informasjonskapsel i denne nettleseren."
