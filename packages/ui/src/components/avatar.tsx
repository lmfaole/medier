// Astro: plain HTML, no directive.

import { appUrl } from "../lib/base-url"

/** `sm` is the avatar of a name in a line of text, `md` the one in front of a row of a list. */
type Size = "sm" | "md"

const FRAMES: Record<Size, string> = { sm: "size-5", md: "size-8" }

/**
 * The picture of a person or an artist as a small round avatar. Made of a span and an img, never a block: it may sit in a text, which is a `<p>`,
 * and a block there makes the browser close the paragraph and break the line apart. Decorative: the name beside it says who it is. With no picture
 * it is a quiet round placeholder, so a list stays level.
 */
export function Avatar({ image, size = "md", rooted = false }: { image: string | null | undefined; size?: Size; /** The address is a path of the host (another app's picture, such as a feed's icon from the Miniflux proxy), not one under this app's base. */ rooted?: boolean }) {
  return (
    <span aria-hidden="true" className={`inline-block shrink-0 overflow-hidden rounded-full bg-muted ${FRAMES[size]}`}>
      {image ? <img src={rooted ? image : appUrl(image)} alt="" loading="lazy" decoding="async" width={64} height={64} className="size-full object-cover" /> : null}
    </span>
  )
}
