/**
 * What the service worker of Innboks does besides keeping the shell (`sw-app.ts`), as functions that take what they touch (the store, `fetch`) so the
 * tests run on fakes. It is `sw-innboks.js` of the hjemmeserver app, in two halves:
 *
 * 1. **The Web Share Target.** The installed manifest says a share from another app is a multipart POST of files to `<scope>share`. The Node server has no
 *    write route (a POST there is a 405), so only an active worker can take it: it answers 303 to `<scope>?shared` at once (a big file may take minutes
 *    to arrive and the phone shows only the splash screen until there is an answer), keeps the files in IndexedDB («shared») and lets the page wait for them.
 * 2. **Background Fetch.** The page hands a big file's chunks to the browser, which sends them and shows the progress; when it has succeeded the worker
 *    sends the requests the page prepared (`JobRecord.complete`: put the chunks together, move the file into place). The worker does not know what those
 *    requests mean: the protocol is in the page's `dav.ts`, the one place that has to change if the way of writing does.
 */
import type { InboxStore, JobRecord, Step } from './share-files.ts'

/** The home apps whose worker takes a share and finishes Background Fetch uploads. */
export const SHARE_APPS: readonly string[] = ['innboks']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export const shareEnabled = (app: string): boolean => SHARE_APPS.includes(app)

export interface ShareRequest {
  method: string
  url: string
}

/** The share target of the manifest: a POST to `<scope>share`. Anything else is left to the browser. */
export const isShareRequest = (request: ShareRequest, scopePath: string): boolean => request.method === 'POST' && new URL(request.url).pathname === `${scopePath}share`

/** Where the page opens after a share (the one the plain-JS app used): the scope with `?shared`, which makes the page wait for the files. */
export const sharedLocation = (scopeUrl: string): string => `${scopeUrl}?shared`

/** What the page is told when the files could not be taken. */
export const SHARE_ERROR = 'innboks'

export interface ShareErrorMessage {
  innboks: typeof SHARE_ERROR
  message: string
}

/** Reads the files of the share's form into the store; [fail] says why when that did not work (the page is waiting for them). */
export async function receiveShare(request: { formData(): Promise<FormData> }, store: Pick<InboxStore, 'putShared'>, fail: (message: ShareErrorMessage) => void | Promise<void>): Promise<void> {
  try {
    const form = await request.formData()
    await store.putShared(form.getAll('files').filter((entry): entry is File => entry instanceof File))
  } catch (error) {
    await fail({ innboks: SHARE_ERROR, message: error instanceof Error ? error.message : String(error) })
  }
}

/** The message of a worker to the page, when it is the share error. */
export function shareErrorOf(data: unknown): string | null {
  if (!isRecord(data)) return null
  return data['innboks'] === SHARE_ERROR && typeof data['message'] === 'string' ? data['message'] : null
}

/** How a Background Fetch ended. */
export type BackgroundOutcome = 'success' | 'fail' | 'abort'

type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** One request of a job. A stale CSRF token (412) is replaced once, from `/index.php/csrftoken`, as the page's own fetch does. */
async function send(fetchFn: Fetch, step: Step): Promise<Response> {
  const attempt = (headers: Record<string, string>) => fetchFn(step.url, { method: step.method, headers, credentials: 'same-origin' })
  const response = await attempt(step.headers)
  if (response.status !== 412) return response
  const fresh = await fetchFn('/index.php/csrftoken', { method: 'GET', headers: { 'OCS-APIREQUEST': 'true' }, credentials: 'same-origin' })
  const body: unknown = fresh.ok ? await fresh.json() : undefined
  const token = isRecord(body) ? body['token'] : undefined
  return typeof token === 'string' ? attempt({ ...step.headers, requesttoken: token }) : response
}

/** The requests that put a finished upload in place, in order; the first that is refused throws. */
async function complete(job: JobRecord, fetchFn: Fetch): Promise<void> {
  for (const step of job.complete) {
    const response = await send(fetchFn, step)
    if (!response.ok) throw new Error(`${step.method}: HTTP ${response.status}`)
  }
}

/** Removes what a failed or aborted upload left on the server; each request is best effort. */
async function cleanup(job: JobRecord, fetchFn: Fetch): Promise<void> {
  for (const step of job.cleanup) await send(fetchFn, step).catch(() => undefined)
}

/**
 * A background fetch has ended. Success puts the file in place and lets a shared file go; a failure or an abort cleans up. The job record is always
 * deleted. Gives the text of the notification (`updateUI`) or `null` when there is nothing to say (an abort is the user's own).
 */
export async function finishBackground(id: string, outcome: BackgroundOutcome, store: Pick<InboxStore, 'getJob' | 'deleteJob' | 'removeShared'>, fetchFn: Fetch): Promise<string | null> {
  const job = await store.getJob(id)
  if (job === undefined) return null
  try {
    if (outcome === 'success') {
      try {
        await complete(job, fetchFn)
        if (job.sharedKey !== undefined) await store.removeShared(job.sharedKey)
        return `Innboks: ${job.name} er sendt`
      } catch {
        await cleanup(job, fetchFn)
        return `Innboks: ${job.name} feilet`
      }
    }
    await cleanup(job, fetchFn)
    return outcome === 'fail' ? `Innboks: ${job.name} feilet` : null
  } finally {
    await store.deleteJob(id)
  }
}
