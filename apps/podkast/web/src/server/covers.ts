/** The pictures of the shows, from `podcast_show_info.image_url`: the path each is served at, and the address the script that lands them asks. */

import { queryRows } from '@designsystem/config/d1-query'
import * as v from 'valibot'

import { showCoverPathOf, showCoverSourceOf } from '@designsystem/intl/podcast-covers'

const SQL = 'SELECT show_name, image_url FROM podcast_show_info WHERE image_url IS NOT NULL'
const PictureRow = v.object({ show_name: v.string(), image_url: v.string() })

/** Each show that has a picture on a host the feeds use: its path, and where it comes from. */
export async function showPictures(db: D1Database): Promise<{ paths: Map<string, string>; files: { cover: string; coverSource: string }[] }> {
  const paths = new Map<string, string>()
  const files = new Map<string, string>()
  for (const row of await queryRows(db, SQL, PictureRow)) {
    const cover = showCoverPathOf(row.image_url)
    const coverSource = showCoverSourceOf(row.image_url)
    if (cover === null || coverSource === null) continue
    paths.set(row.show_name, cover)
    files.set(cover, coverSource)
  }
  return { paths, files: [...files].map(([cover, coverSource]) => ({ cover, coverSource })).toSorted((a, b) => a.cover.localeCompare(b.cover)) }
}
