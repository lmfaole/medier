import { appApiHandler } from '@designsystem/config/app-shell/api'
import type { APIRoute } from 'astro'

// The server answers `<base>/api/*` itself, from the database (`scripts/media-server.ts`); this route is what Astro itself
// would serve, through the same in-process fetcher (`packages/config/api-fetchers.ts`).
const handler = appApiHandler()

export const GET: APIRoute = ({ request }) => handler({ request })
