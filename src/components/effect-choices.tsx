"use client"

import { ChoiceCards } from "@lmfaole/designsystem/components/choice-cards"
import { EffectsPreview } from "@lmfaole/designsystem/components/effects-preview"
import { TiltPreview } from "@lmfaole/designsystem/components/tilt-preview"
import type { Prefs } from "@lmfaole/designsystem/lib/preferences"

/*
 * The effects and the tilt, each a choice whose cards are the examples themselves (live WebGL and a lit surface). The previews are client components, so each field is one island of its own
 * (`client:load` from the Astro page) with only serialisable props; the radios are native, so the form works before it is hydrated.
 */

export function EffectsChoice({ value }: { value: Prefs["effects"] }) {
  return (
    <ChoiceCards
      name="effects"
      legend="Effekter"
      value={value}
      options={[
        { value: "on", label: "Med effekter", description: "Platen som snurrer, coverne i 3D og bakgrunner som følger lyset.", preview: <EffectsPreview mode="on" /> },
        { value: "off", label: "Uten effekter", description: "Flatt og stille. Bruker mindre strøm og passer om bevegelse er ubehagelig.", preview: <EffectsPreview mode="off" /> },
      ]}
    />
  )
}

export function TiltChoice({ value }: { value: Prefs["tilt"] }) {
  return (
    <ChoiceCards
      name="tilt"
      legend="Lyset på siden"
      value={value}
      hint="På en telefon kan lyset følge hvordan du holder den. Telefonen spør om lov først."
      options={[
        { value: "on", label: "Følg telefonen", description: "Lyset og skyggene flytter seg når du vipper telefonen.", preview: <TiltPreview mode="follow" /> },
        { value: "off", label: "Fast lys", description: "Lyset følger pekeren, eller står stille.", preview: <TiltPreview mode="still" /> },
      ]}
    />
  )
}
