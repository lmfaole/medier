// TV's links: a series, a person and a network each have a page of their own.

import { watchLinks } from '@designsystem/watch/links'

export const tvLinks = () => watchLinks({ itemKind: 'serie', placeKind: 'network' })
