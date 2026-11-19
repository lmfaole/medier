// The islands of the games pages, made from games's own words. A page imports the view it wants and names the directive
// (`client:visible` for the log chart, `client:idle` for the library, none for plain HTML).

import { shelfViews } from '@designsystem/shelf/views'

import { words } from '@/words'

const views = shelfViews(words, 'game')

export const Overview = views.Overview
export const History = views.History
export const Library = views.Library
export const Entity = views.Entity
