// The islands of the books pages, made from books's own words. A page imports the view it wants and names the directive
// (`client:visible` for the log chart, `client:idle` for the library, none for plain HTML).

import { shelfViews } from '@designsystem/shelf/views'

import { words } from '@/words'

export const { Overview, History, Library, Entity } = shelfViews(words, 'book')
