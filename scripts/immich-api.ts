/**
 * The owner's Immich, as the concert scripts call it: its address and key from `~/.config/immich-sync.env` (as `event-albums` reads them) or the
 * environment, and one request that fails loudly with the method and path.
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { parseEnv } from "./sync-schedule.ts"

const settings = join(homedir(), ".config", "immich-sync.env")

/** The settings file under the process's own environment, which wins. */
export const immichEnv: Record<string, string | undefined> = { ...(existsSync(settings) ? parseEnv(readFileSync(settings, "utf8")) : {}), ...process.env }

const url = (immichEnv["IMMICH_URL"] ?? "").replace(/\/$/, "")
const headers = { "x-api-key": immichEnv["IMMICH_API_KEY"] ?? "", "content-type": "application/json" }

export async function immichSend(method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(`${url}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!response.ok) throw new Error(`Immich ${method} ${path} failed: ${response.status}`)
  return response
}
