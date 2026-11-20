import { Button } from "@lmfaole/designsystem/components/button"
import { CheckboxList } from "@lmfaole/designsystem/components/checkbox-list"
import { ChoiceCards } from "@lmfaole/designsystem/components/choice-cards"
import { FirstRun } from "@lmfaole/designsystem/components/first-run"
import { Stack } from "@lmfaole/designsystem/components/layout"
import { SettingsSection } from "@lmfaole/designsystem/components/settings-section"
import { TextField } from "@lmfaole/designsystem/components/text-field"
import { ThemeSample } from "@lmfaole/designsystem/components/theme-sample"
import type { Prefs } from "@lmfaole/designsystem/lib/preferences"
import type { ReactNode } from "react"

import { FROM_FIRST_RUN, FRONT_SECTIONS, shownSections, SOURCE_FIELD, type Step } from "../lib/settings-form"
import type { UsernameField } from "../lib/users"

/*
 * The fields of a visitor's settings, the same in the first-run wizard (`MedierFirstRun`) and on «Innstillinger» (`SettingsForm`): native, so both work without JavaScript, and posted to
 * `/api/innstillinger/`. The previews of the effects and the tilt are islands, so they come in from the Astro page as slots (`effectsPreview`, `tiltPreview`), as does the offer to install.
 */

function UsernameInput({ field }: { field: UsernameField }) {
  return <TextField name={field.name} label={field.label} optional verbatim autoComplete="off" {...(field.hint === undefined ? {} : { hint: field.hint })} {...(field.value === undefined ? {} : { defaultValue: field.value })} {...(field.error === undefined ? {} : { error: field.error })} />
}

function SectionsField({ prefs }: { prefs: Prefs }) {
  const shown = shownSections(prefs)
  return (
    <>
      {/* Says the field was there, so none ticked is none shown (`formPrefs`). */}
      <input type="hidden" name="sections" value="" />
      <CheckboxList name="sections" legend="Seksjoner på forsiden" hint="Det du ikke krysser av, blir borte fra forsiden. Sidene Musikk, Film og TV og Historikk er der uansett." values={[...shown]} options={FRONT_SECTIONS.map((section) => ({ ...section }))} />
    </>
  )
}

function ThemeField({ prefs }: { prefs: Prefs }) {
  return (
    <ChoiceCards
      name="theme"
      legend="Tema"
      value={prefs.theme}
      options={[
        { value: "system", label: "Som enheten", description: "Lyst eller mørkt etter hva enheten er satt til.", preview: <ThemeSample theme="system" /> },
        { value: "light", label: "Lyst", preview: <ThemeSample theme="light" /> },
        { value: "dark", label: "Mørkt", preview: <ThemeSample theme="dark" /> },
      ]}
    />
  )
}

function EffectsField({ prefs }: { prefs: Prefs }) {
  return (
    <ChoiceCards
      name="effects"
      legend="Effekter"
      value={prefs.effects}
      options={[
        { value: "on", label: "På", description: "Platen som snurrer, coverne i 3D og bakgrunner som følger lyset." },
        { value: "off", label: "Av", description: "Flatt og stille. Bruker mindre strøm og passer om bevegelse er ubehagelig." },
      ]}
    />
  )
}

function TiltField({ prefs }: { prefs: Prefs }) {
  return (
    <ChoiceCards
      name="tilt"
      legend="Lys som følger telefonen"
      value={prefs.tilt}
      hint="På en telefon kan lyset på siden følge hvordan du holder den. Telefonen spør om lov først."
      options={[
        { value: "off", label: "Av", description: "Lyset følger pekeren, eller står stille." },
        { value: "on", label: "På", description: "Lyset følger hvordan du holder telefonen." },
      ]}
    />
  )
}

interface FieldsProps {
  /** The two username fields (`usernameFields`), with what the visitor has and the error of one that was not found. */
  lastfm: UsernameField
  trakt: UsernameField
  prefs: Prefs
  effectsPreview?: ReactNode
  tiltPreview?: ReactNode
}

/** The wizard of the first visit: what the site is, the two usernames, the front page, the theme, the effects and the offer to install, in one form. */
export function MedierFirstRun({ open, action, back, validateUrl, initialStep, install, ...fields }: FieldsProps & { open: boolean; action: string; back: string; validateUrl: string; initialStep?: Step | undefined; install?: ReactNode }) {
  const steps: { id: Step; title: string; body?: string; icon?: "music" | "listen" | "film" | "home" | "moon" | "bolt" | "download"; content?: ReactNode }[] = [
    {
      id: "velkommen",
      title: "Velkommen til Medier",
      body: "Medier viser hva du hører på og ser, hentet fra Last.fm og Trakt: det som spilles nå, det du har sett, og en oppsummering av hver uke og måned. Noen få valg, så er du i gang. Alt kan endres senere under Innstillinger.",
      icon: "music",
      content: <input type="hidden" name={SOURCE_FIELD} value={FROM_FIRST_RUN} />,
    },
    { id: "lastfm", title: "Hvem er du på Last.fm?", body: "Vi henter avspillingene dine fra den offentlige profilen. La feltet stå tomt om du ikke bruker Last.fm.", icon: "listen", content: <UsernameInput field={fields.lastfm} /> },
    { id: "trakt", title: "Hvem er du på Trakt?", body: "Vi henter filmene og episodene du har sett. Profilen må være offentlig. La feltet stå tomt om du ikke bruker Trakt.", icon: "film", content: <UsernameInput field={fields.trakt} /> },
    { id: "forsiden", title: "Hva vil du se på forsiden?", icon: "home", content: <SectionsField prefs={fields.prefs} /> },
    { id: "tema", title: "Lyst eller mørkt?", icon: "moon", content: <ThemeField prefs={fields.prefs} /> },
    {
      id: "effekter",
      title: "Effekter",
      body: "Medier tegner plater og bakgrunner i 3D. Slå det av om du vil ha det roligere eller spare strøm.",
      icon: "bolt",
      content: (
        <>
          <EffectsField prefs={fields.prefs} />
          {fields.effectsPreview}
          <TiltField prefs={fields.prefs} />
          {fields.tiltPreview}
        </>
      ),
    },
    {
      id: "installer",
      title: "Ha Medier på hjem-skjermen",
      body: "Medier kan installeres som en app og åpnes i et eget vindu, også uten nett. I Chrome og Edge finner du det i adressefeltet, på iPhone under Del og Legg til på Hjem-skjerm.",
      icon: "download",
      ...(install === undefined ? {} : { content: install }),
    },
  ]
  return <FirstRun open={open} title="Kom i gang med Medier" action={action} back={back} validateUrl={validateUrl} steps={steps} {...(initialStep === undefined ? {} : { initialStep })} />
}

/** «Innstillinger»: the same fields in sections on one page, and one «Lagre». */
export function SettingsForm({ action, back, ...fields }: FieldsProps & { action: string; back: string }) {
  return (
    <form method="post" action={action}>
      <input type="hidden" name="back" value={back} />
      <Stack gap="xl">
        <SettingsSection id="brukernavn" title="Brukernavn" body="Hvem siden henter data for. Vi viser bare det som er offentlig på profilen. La et felt stå tomt for å glemme brukernavnet.">
          <UsernameInput field={fields.lastfm} />
          <UsernameInput field={fields.trakt} />
        </SettingsSection>
        <SettingsSection id="forsiden" title="Forsiden">
          <SectionsField prefs={fields.prefs} />
        </SettingsSection>
        <SettingsSection id="tema" title="Tema">
          <ThemeField prefs={fields.prefs} />
        </SettingsSection>
        <SettingsSection id="effekter" title="Effekter" body="Plater og bakgrunner i 3D, og lys som følger telefonen.">
          <EffectsField prefs={fields.prefs} />
          {fields.effectsPreview}
          <TiltField prefs={fields.prefs} />
          {fields.tiltPreview}
        </SettingsSection>
        <div>
          <Button type="submit" size="lg">
            Lagre
          </Button>
        </div>
      </Stack>
    </form>
  )
}

