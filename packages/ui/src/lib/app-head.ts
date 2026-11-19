/**
 * One of the three not-indexed layers, with `X-Robots-Tag` and
 * `robots.txt`; they only work together. `Document.astro` writes it.
 */
export const ROBOTS_META = "noindex, nofollow, noarchive, nosnippet, noimageindex"

/** `--background` of `theme.css` as hex, since `theme-color` takes no `oklch()`; keep the two in step. */
export const THEME_COLOR = { light: "#ffffff", dark: "#0a0a0a" } as const
