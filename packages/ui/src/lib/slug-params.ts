// The path of a page of one thing: `/artist/[slug]`, `/show/[slug]`. A slug that is not one is the shared 404, so a hand-edited URL cannot break a page.

import * as v from 'valibot'

export const SlugParams = v.object({ slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)) })
