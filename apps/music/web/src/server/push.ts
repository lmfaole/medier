/**
 * Who has asked to be told at the end of a week or a month (`/push/*`, the media server's one write). A browser's push
 * subscription is an address at its push service and two keys; the sender (`scripts/music-digest.ts`) cannot reach the
 * browser without them, so they are kept in `.data/push/subscriptions.json`, a plain file in the data folder. Whether a
 * switch is on is the browser's own (the page reads its push subscription and its own storage), not something asked of this file.
 *
 * Only the owner reaches this (the login gate) and only from the app's own pages: a request must say `Sec-Fetch-Site: same-origin`,
 * which a page of another site cannot make a browser say. What is kept is checked, small and limited to a few devices.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SECURITY_HEADERS } from '@designsystem/config/security-headers'
import * as v from 'valibot'

import { TOPICS } from '../lib/digest.ts'

export const PUSH_PATH = /^\/push\/(key|subscribe|unsubscribe)$/

/** How many devices can be told at once: the owner's own phone, tablet and computers. */
const MAX_DEVICES = 10
/** The largest body read: a subscription is under a kilobyte. */
export const MAX_BODY = 4096

const Key = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{8,256}$/))
const Endpoint = v.pipe(v.string(), v.maxLength(1024), v.url(), v.startsWith('https://'))

export const Device = v.object({ endpoint: Endpoint, keys: v.object({ p256dh: Key, auth: Key }), topics: v.pipe(v.array(v.picklist(TOPICS)), v.minLength(1), v.maxLength(TOPICS.length)) })
export type Device = v.InferOutput<typeof Device>

const Unsubscribe = v.object({ endpoint: Endpoint })

const file = (directory: string) => join(directory, 'subscriptions.json')

/** Every device that asked, `[]` for no file or one that cannot be read; one that fails its check is left out. */
export function readDevices(directory: string): Device[] {
  if (!existsSync(file(directory))) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(file(directory), 'utf8'))
    return Array.isArray(parsed) ? parsed.flatMap((entry: unknown) => { const device = v.safeParse(Device, entry); return device.success ? [device.output] : [] }) : []
  } catch {
    return []
  }
}

/** Replaces the file whole, through a temporary one, so a reader never sees half of it. */
export function writeDevices(directory: string, devices: readonly Device[]): void {
  mkdirSync(directory, { recursive: true })
  const temporary = `${file(directory)}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(devices, null, 2), { mode: 0o600 })
  renameSync(temporary, file(directory))
}

function answer(status: number, body: string, type = 'text/plain; charset=utf-8'): Response {
  const headers = new Headers(SECURITY_HEADERS)
  headers.set('Content-Type', type)
  headers.set('Cache-Control', 'no-store')
  return new Response(status === 204 ? null : body, { status, headers })
}

/** The public key of the sender (`scripts/music-digest.ts keys` writes it), which a browser needs to subscribe. */
function publicKey(directory: string): Response {
  const path = join(directory, 'vapid-public-key.txt')
  return existsSync(path) ? answer(200, readFileSync(path, 'utf8').trim()) : answer(404, 'Varsler er ikke satt opp.\n')
}

/**
 * Answers `GET /push/key`, `POST /push/subscribe` (a device and the topics it wants) and `POST /push/unsubscribe` (its address), or
 * `undefined` for any other path. A device is kept once, by its address; a new request for it replaces the topics.
 */
export async function handlePush(request: Request, path: URL, directory: string): Promise<Response | undefined> {
  const action = PUSH_PATH.exec(path.pathname)?.[1]
  if (action === undefined) return undefined
  if (action === 'key') return request.method === 'GET' ? publicKey(directory) : answer(405, 'Method not allowed\n')
  if (request.method !== 'POST') return answer(405, 'Method not allowed\n')
  if (request.headers.get('sec-fetch-site') !== 'same-origin') return answer(403, 'Forbidden\n')
  const text = await request.text()
  if (text.length > MAX_BODY) return answer(413, 'For stor.\n')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return answer(400, 'Ikke JSON.\n')
  }
  const devices = readDevices(directory)
  if (action === 'unsubscribe') {
    const gone = v.safeParse(Unsubscribe, parsed)
    if (!gone.success) return answer(400, 'Ugyldig.\n')
    writeDevices(directory, devices.filter((device) => device.endpoint !== gone.output.endpoint))
    return answer(204, '')
  }
  const device = v.safeParse(Device, parsed)
  if (!device.success) return answer(400, 'Ugyldig.\n')
  const others = devices.filter((other) => other.endpoint !== device.output.endpoint)
  if (others.length >= MAX_DEVICES) return answer(409, 'For mange enheter.\n')
  writeDevices(directory, [...others, device.output])
  return answer(204, '')
}
