import { BrandIcon } from "@lmfaole/designsystem/components/brand-icon"
import { ExternalLink } from "@lmfaole/designsystem/components/external-link"
import { Inline } from "@lmfaole/designsystem/components/layout"
import { Text } from "@lmfaole/designsystem/components/text"

/**
 * Where Spotify's content comes from: their mark in the text colour (one colour, never over artwork), 28 px, above Spotify's 21 px minimum. Content from Spotify is
 * attributed to Spotify and links back to it (their developer policy), so every part that shows it has this and an «Åpne i Spotify» link or a title that is one.
 */
export function FromSpotify() {
  return (
    <Inline gap="sm">
      <BrandIcon name="spotify" size="xl" decorative />
      <Text size="sm" tone="muted">
        Fra Spotify
      </Text>
    </Inline>
  )
}

/** The foot of every page: who the data is from, and what TMDB asks to be said where its data is used. */
export function Credits() {
  return (
    <Text size="sm" tone="muted">
      Data fra Last.fm, Trakt, Spotify og <ExternalLink href="https://www.themoviedb.org">TMDB</ExternalLink>. Denne siden bruker TMDB API, men er ikke støttet eller sertifisert av TMDB.
    </Text>
  )
}
