// What the pages say: the owner, and the head content of each page.
export const NAME = 'Ole Jørgen Bakken'
/** What the front page says about the work, in one sentence; the description under the link previews too. */
export const BIO = 'Jeg er senior frontend-utvikler hos Fremtind og bygger komponenter og webløsninger i designsystemet Jøkul, med universell utforming og webstandarder som utgangspunkt.'
export const DESCRIPTION = BIO
/** The line under the name on the front page. */
export const ROLE = 'Senior frontend-utvikler hos Fremtind'

export const PROFILE = {
  url: 'https://lmfaole.party/',
  /** The CV: a page of this host, served by the `work` Worker. */
  cv: '/cv',
  email: 'hei@lmfaole.party',
  github: 'https://github.com/lmfaole',
  linkedin: 'https://www.linkedin.com/in/olejorgenbakken/',
} as const

/**
 * Each page's own `<title>` and link-preview text, by route path. `/medier` and `/kilder` are no longer linked from anywhere (not from `/`,
 * not from `sitemap.xml`): the front page links to nothing behind a login. The pages and their rows here are what is left of them.
 */
const PAGES = [
  { path: '/', title: NAME, description: DESCRIPTION },
  { path: '/medier', title: 'Medier', description: 'Film, TV, musikk, podkast, spill, bøker og brettspill – det jeg ser, hører på, spiller og leser.' },
  { path: '/kilder', title: 'Kilder', description: 'Hvor dataene om det jeg ser, hører på, spiller og leser kommer fra, og hvordan løsningen og tjenestene fungerer.' },
] as const

/** The page at `path`, else the front page: what the root route's head shows. */
export function pageHead(path: string) {
  return PAGES.find((page) => page.path === path) ?? PAGES[0]
}

/** The link preview of the page at `path`, for the document's Open Graph tags. */
export function pageOg(path: string) {
  const page = pageHead(path)
  return {
    title: page.title,
    description: page.description,
    url: new URL(path.replace(/^\//, ''), PROFILE.url).href,
    image: '/profilbilde.jpg',
    imageWidth: 460,
    imageHeight: 460,
    locale: 'nb_NO',
  }
}
