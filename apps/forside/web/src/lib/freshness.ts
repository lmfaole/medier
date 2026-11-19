/** How long ago the log's newest line was, in words: the reader's clock is the request's, so only a server island, never a cached page, can say it. */

import { formatSince } from '@designsystem/intl/time'

/** «for 3 timer siden»; a moment ago, or an instant ahead of `now`, is «nå». */
export const sinceLabel = (at: string, now: Date): string => formatSince(at, now)
