import { appApiHandler } from '@designsystem/config/app-shell/api'
import type { WorkerEnv } from '@designsystem/config/worker-app'
import type { APIRoute } from 'astro'

// One file, `cv.json`: `server/api.ts` lists it.
const handler = appApiHandler<WorkerEnv>()

export const GET: APIRoute = ({ request }) => handler({ request })
