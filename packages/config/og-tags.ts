// Injects Open Graph and Twitter Card meta tags into every app's
// `index.html`, centralized because the tag set and `lmfaole.party` site
// identity are identical across apps — only title, description and URL
// differ.
//
// These tags are about link-unfurling (the preview card a messaging app
// shows for a pasted link), which is a separate concern from search-engine
// indexing. An app can carry `noindex` and still want a good link preview
// when its owner shares it privately — the two must not be conflated.


export interface OgTagsOptions {
  /** Shown as the link preview's headline. */
  title: string
  /** One sentence, shown under the title. */
  description: string
  /** The app's canonical origin, e.g. `https://cv.lmfaole.party`. */
  url: string
  /** Path to the preview image, resolved against `url`. Defaults to the shared `/og-image.jpg`. */
  image?: string
  /** Defaults to 460, the shared image's actual size. */
  imageWidth?: number
  /** Defaults to 460, the shared image's actual size. */
  imageHeight?: number
  /** Defaults to `lmfaole.party`. */
  siteName?: string
  /** Defaults to `en_US`. */
  locale?: string
}

/** One tag as attributes, keyed by `property` (Open Graph) or `name` (Twitter). */
export type OgMetaTag = { property: string; content: string } | { name: string; content: string }

/**
 * The tags as plain attribute objects, `{ property | name, content }`, for
 * the Vite plugin below and for the `<meta>` tags of `Document.astro`.
 */
export function ogMetaTags(options: OgTagsOptions): OgMetaTag[] {
  const {
    title,
    description,
    url,
    image = '/og-image.jpg',
    imageWidth = 460,
    imageHeight = 460,
    siteName = 'lmfaole.party',
    locale = 'en_US',
  } = options
  const imageUrl = new URL(image, url).toString()

  return [
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: siteName },
    { property: 'og:locale', content: locale },
    { property: 'og:url', content: url },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:image', content: imageUrl },
    { property: 'og:image:width', content: String(imageWidth) },
    { property: 'og:image:height', content: String(imageHeight) },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: imageUrl },
  ]
}
