/**
 * The shape language of the pictures: what KIND of thing a picture is of is told by its shape, so a reader tells a person from a record from a film before reading a word. One shape for each kind, the same in a
 * row and on the thing's own page, and a shape never means two kinds (`shapes.test.ts`). A circle is a person or a band; a sharp square a record's cover; a tile with soft corners a single song; a tall frame a film.
 */

import type { PictureCorners } from "@lmfaole/designsystem/components/picture"

export type Kind = "film" | "album" | "artist" | "track" | "person"

export interface Shape {
  ratio: "poster" | "square"
  corners: PictureCorners
}

export const SHAPES: Readonly<Record<Kind, Shape>> = {
  film: { ratio: "poster", corners: "normal" },
  album: { ratio: "square", corners: "sharp" },
  artist: { ratio: "square", corners: "round" },
  track: { ratio: "square", corners: "soft" },
  person: { ratio: "square", corners: "round" },
}

/** Spotify's own covers keep the small corners its guidelines ask of cover art, whatever kind of row they are in. */
export const SPOTIFY_COVER: Shape = { ratio: "square", corners: "sharp" }
