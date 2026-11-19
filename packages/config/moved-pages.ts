/**
 * The pages whose address changed when the baseline pages got Norwegian names, mapped to where they went, for a Worker
 * to answer with a redirect so an old link and a bookmark still land. The key is a path under the app's base, the
 * value the new one; what follows `?` is kept.
 */

/** The apps with a history by month: music, podkast, film and tv. Their on-this-day page is gone, and its old addresses land on the front page. */
export const MOVED_WATCH_PAGES: Readonly<Record<string, string>> = { '/history': '/historikk', '/memories': '/', '/minner': '/' }

/** Film's removed library and franchise pages (the franchise of a film is a card on its own page now), and its history and memories under their old names, land on its front page. */
export const MOVED_FILM_PAGES: Readonly<Record<string, string>> = { ...MOVED_WATCH_PAGES, '/bibliotek': '/', '/franchiser': '/' }

/** Music's retrospective pages sit under `/tilbakeblikk` and its venues under `/konserter`; the old addresses, the removed on-this-day page included, land there. */
export const MOVED_MUSIC_PAGES: Readonly<Record<string, string>> = {
  ...MOVED_WATCH_PAGES,
  '/memories': '/tilbakeblikk',
  '/minner': '/tilbakeblikk',
  '/uke': '/tilbakeblikk/uke',
  '/maaned': '/tilbakeblikk/maaned',
  '/aar': '/tilbakeblikk/aar',
  '/venuer': '/konserter/venuer',
}

/** The shelf apps, whose `/history` was the list of every work, which `/bibliotek` is now; their on-this-day page is gone. */
export const MOVED_SHELF_PAGES: Readonly<Record<string, string>> = { '/history': '/bibliotek', '/minner': '/' }
