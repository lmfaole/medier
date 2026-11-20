import { DetailHeader } from "@lmfaole/designsystem/components/detail-header"
import { TextLink, Text } from "@lmfaole/designsystem/components/text"
import { TiltButton } from "@lmfaole/designsystem/components/tilt-button"
import type { PictureSource } from "@lmfaole/designsystem/lib/picture-sources"

import { SHAPES } from "../lib/shapes.ts"
import { FromSpotify } from "./credits.tsx"

/**
 * The head of the page of a thing: its picture and its name together, on a backdrop of the picture's colours drawn in WebGL that moves with the light (the design system's `DetailHeader`, `Light and shadow`). It is the page's `<h1>`.
 * An island, mounted by the page (`<Head client:idle … />`), since the detail components are not hydrated and the backdrop and the light need to be. Its picture is lit on its frame and nothing is painted over it (Spotify's artist
 * pictures may not be altered); the backdrop takes four colours from it and never the picture. The one button that asks to let the light follow an iPhone is under it, once.
 */
export function Head({ kind, title, sources, shape, by, lines = [], fromSpotify = false }: { kind: string; title: string; sources: PictureSource[]; shape: keyof typeof SHAPES; /** Lines of plain text under the name: a stretch of time, what is the most played. */ lines?: string[]; /** The artist, for an album and a song: «av …», linking to the artist's page. */ by?: { name: string; href: string }; /** Spotify's picture: attributed, and linking back is the page's. */ fromSpotify?: boolean }) {
  return (
    <>
      <DetailHeader kind={kind} title={title} sources={sources} {...SHAPES[shape]}>
        {by === undefined ? null : (
          <Text size="sm">
            av <TextLink href={by.href}>{by.name}</TextLink>
          </Text>
        )}
        {lines.map((line) => (
          <Text key={line} size="sm">
            {line}
          </Text>
        ))}
        {fromSpotify ? <FromSpotify tone="default" /> : null}
      </DetailHeader>
      <TiltButton />
    </>
  )
}
