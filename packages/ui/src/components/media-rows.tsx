import type { ReactNode } from "react"

import { PictureRows, type PictureRow } from "@lmfaole/designsystem/components/picture-rows"

import { appUrl } from "../lib/base-url"


/** One row of what the owner played, watched or read, as the apps give it: the picture as a path of the app, what it was, who or what it was by, and when. */
export interface MediaRow {
  key: string
  /** The picture's path under the app's base; `null` where there is none. */
  cover: string | null
  title: ReactNode
  /** Under the title: the artist, the show, the maker, and whatever else is worth a line. */
  subtitle: ReactNode
  /** The day or the time, as text. */
  when: string
}

/** The design system's `PictureRows` for the apps' rows: the cover resolved under the app's base, the names of the design system for the rest. */
export function MediaRows({ rows, coverRatio }: { rows: readonly MediaRow[]; coverRatio: "poster" | "square" }) {
  const pictureRows: PictureRow[] = rows.map((row) => ({ key: row.key, picture: row.cover === null ? null : appUrl(row.cover), title: row.title, detail: row.subtitle, aside: row.when }))
  return <PictureRows rows={pictureRows} ratio={coverRatio} />
}
