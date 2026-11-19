/**
 * The inspector port for an app's dev Worker, when `npm run dev:all` set one: left out, the Cloudflare plugin scans
 * for a free port, and dev servers started together all pick the same port before any of them has bound it.
 */
export function inspectorPortFrom(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const port = Number(env.WORKER_INSPECTOR_PORT)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined
}
