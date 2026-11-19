// Astro: plain HTML, no directive.

/**
 * The pictures of an article or a story, side by side as many as fit, each as high as it is wide in a frame that is there whether the picture loads
 * or not (so the page does not move when one fails, and a failed one is just not drawn). Decorative: the title beside it says what it is. The
 * addresses are paths of the host (the picture proxy of another app), not under this app's base.
 */
export function ArticlePictures({ pictures }: { pictures: readonly string[] }) {
  if (pictures.length === 0) return null
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-3">
      {pictures.map((picture) => (
        <li key={picture} aria-hidden="true" className="aspect-[3/2] overflow-hidden rounded-md bg-muted">
          <img src={picture} alt="" loading="lazy" decoding="async" width={600} height={400} className="size-full object-cover" />
        </li>
      ))}
    </ul>
  )
}
