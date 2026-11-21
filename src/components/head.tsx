import { Badge } from "@lmfaole/designsystem/components/badge"
import { type DetailFigure, DetailHeader } from "@lmfaole/designsystem/components/detail-header"
import { Inline } from "@lmfaole/designsystem/components/layout"
import { TextLink, Text } from "@lmfaole/designsystem/components/text"
import { TiltButton } from "@lmfaole/designsystem/components/tilt-button"
import type { PictureSource } from "@lmfaole/designsystem/lib/picture-sources"

import { SHAPES } from "../lib/shapes.ts"

/**
 * The head of the page of a thing: its picture and its name together, on a backdrop of the picture's colours drawn in WebGL that moves with the light (the design system's `DetailHeader`, `Light and shadow`). It is the page's `<h1>`.
 * An island, mounted by the page (`<Head client:idle … />`), since the detail components are not hydrated and the backdrop and the light need to be. Its picture is lit on its frame and nothing is painted over it (Spotify's artist
 * pictures may not be altered); the backdrop takes four colours from it and never the picture. The one button that asks to let the light follow an iPhone is under it, once.
 * An artist's page is `large`: its portrait is the page's face, and its `figures` (the plays, the share of all) are said there and nowhere else on the page.
 */
export function Head({ kind, title, sources, shape, by, lines = [], tags = [], sleeve = false, large = false, figures = [] }: { kind: string; title: string; sources: PictureSource[]; shape: keyof typeof SHAPES; /** The picture is the page's face (an artist's portrait): as large as the head allows. */ large?: boolean; /** The two or three numbers that say most, large under the name. */ figures?: DetailFigure[]; /** An album with Last.fm's cover: the cover as a sleeve in 3D with a record half out (never for Spotify's covers, which may not be altered). */ sleeve?: boolean; /** Lines of plain text under the name: a stretch of time, what is the most played. */ lines?: string[]; /** What it is tagged as (an artist's genres), each a badge under the lines. */ tags?: string[]; /** The artist, for an album and a song: «av …», linking to the artist's page. */ by?: { name: string; href: string } }) {
  return (
    <>
      <DetailHeader kind={kind} title={title} sources={sources} sleeve={sleeve} size={large ? "large" : "normal"} figures={figures} {...SHAPES[shape]}>
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
        {tags.length === 0 ? null : (
          <Inline as="ul" gap="xs" aria-label="Sjangere">
            {tags.map((tag) => (
              <li key={tag}>
                <Badge>{tag}</Badge>
              </li>
            ))}
          </Inline>
        )}
      </DetailHeader>
      <TiltButton />
    </>
  )
}
