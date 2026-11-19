/**
 * What the service worker of a home app does with a Web Push from Nextcloud's own notifications app, as pure functions (tested without a
 * browser). It is the push half of `sw-hjem.js` of the hjemmeserver app: the payload is `{nid, app, subject, …}`, an activation token while the
 * browser subscribes, or a delete message when a notification is dismissed elsewhere. Only an app in `PUSH_APPS` has it; the worker that
 * handles it is `sw-app.ts`.
 */

/** The home apps whose worker handles pushes. */
export const PUSH_APPS: readonly string[] = ['hjem']

export const pushEnabled = (app: string): boolean => PUSH_APPS.includes(app)

/** Where the worker answers an activation token: Nextcloud's own endpoint, on the same origin, with the owner's session. */
export const ACTIVATE_URL = '/ocs/v2.php/apps/notifications/api/v2/webpush/activate'

export type PushAction =
  | { kind: 'activate'; token: string }
  /** `ids` null closes every open notification. */
  | { kind: 'close'; ids: number[] | null }
  | { kind: 'show'; title: string; tag: string; data: Record<string, unknown> }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** What to do with a push's payload (anything that is not an object is shown as the generic notification). */
export function pushActionOf(message: unknown): PushAction {
  const payload = isRecord(message) ? message : {}
  if (typeof payload['activationToken'] === 'string') return { kind: 'activate', token: payload['activationToken'] }
  if (payload['delete'] === true || payload['delete-multiple'] === true || payload['delete-all'] === true) {
    if (payload['delete-all'] === true) return { kind: 'close', ids: null }
    const nids = Array.isArray(payload['nids']) ? payload['nids'] : [payload['nid']]
    return { kind: 'close', ids: nids.map(Number).filter(Number.isFinite) }
  }
  const subject = payload['subject']
  return { kind: 'show', title: typeof subject === 'string' && subject !== '' ? subject : 'Hjemmeserver', tag: String(payload['nid']), data: payload }
}

/** The tags of the open notifications that a close action dismisses. */
export function tagsToClose(tags: readonly string[], ids: readonly number[] | null): string[] {
  return tags.filter((tag) => ids === null || ids.includes(Number(tag)))
}
