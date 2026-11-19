import { Picture } from '@lmfaole/designsystem/components/picture'
import { appUrl } from '../lib/base-url'
import { ExternalLink } from '@lmfaole/designsystem/components/external-link'

export interface PhotoGridItem {
  url: string
  /** A video: its still gets a play mark. */
  video: boolean
}

/**
 * Photos and videos as a grid of squares, three across on every width, each a link to `href` (the album they are from). A video's
 * still carries a play mark in the corner. The same grid wherever an app shows an album's pictures.
 */
export function PhotoGrid({ photos, href }: { photos: readonly PhotoGridItem[]; href: string }) {
  return (
    <ul className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,8rem),1fr))] gap-2">
      {photos.map((photo) => (
        <li key={photo.url} className="relative">
          <ExternalLink href={href}>
            <Picture src={appUrl(photo.url)} ratio="square" size="fill" />
          </ExternalLink>
          {photo.video ? (
            <span aria-label="Video" role="img" className="pointer-events-none absolute bottom-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-black/60 text-xs text-white">
              ▶
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
