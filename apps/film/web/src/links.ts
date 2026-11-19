// Film's links: a film, a person and a cinema each have a page of their own.

import { watchLinks } from '@designsystem/watch/links'

export const filmLinks = () => watchLinks({ itemKind: 'film', placeKind: 'cinema' })
