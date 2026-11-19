import type { ReactNode } from "react"

import { PictureCard } from "@lmfaole/designsystem/components/picture-card"

import { appUrl } from "../lib/base-url"
import { CardLink } from "@lmfaole/designsystem/components/card-link"
import { FactList } from "@lmfaole/designsystem/components/fact-list"
import { Grid } from "@lmfaole/designsystem/components/layout"

/** One place the owner has been to (a cinema, a venue): its name linking to its page, a picture when there is one, and the facts about it. */
export interface Place {
  name: string
  href: string
  image?: string | null
  facts: readonly (readonly [string, ReactNode])[]
}

/** The places of a list, one card each (comparable with each other), in a grid that fits as many as there is room for. */
export function PlaceGrid({ places }: { places: readonly Place[] }) {
  return (
    <Grid gap="lg" columns="cards">
      {places.map((place) => (
        <PictureCard key={place.href} title={<CardLink href={place.href}>{place.name}</CardLink>} picture={place.image === undefined || place.image === null ? null : appUrl(place.image)}>
          <FactList facts={place.facts} />
        </PictureCard>
      ))}
    </Grid>
  )
}
