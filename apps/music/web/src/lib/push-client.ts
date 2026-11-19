// The browser's side of the notifications at the end of a week or a month: the topics a device asked for are kept in the browser itself
// (its push subscription and `localStorage`), so the switches show what this device has, whatever the server's file says.

import { appUrl } from '@designsystem/ui/lib/base-url'
import { HUB_MOUNT } from '@designsystem/ui/lib/hub'

import { TOPICS, type Topic } from './digest.ts'

const STORAGE_KEY = 'music-push-topics'

/** The bytes of a VAPID public key, which is written as URL-safe base64. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const padded = key.trim().replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(key.trim().length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

/** The topics a stored text names, leaving out anything that is not one. */
export function topicsOf(text: string | null): Topic[] {
  try {
    const parsed: unknown = JSON.parse(text ?? '[]')
    return Array.isArray(parsed) ? TOPICS.filter((topic) => parsed.includes(topic)) : []
  } catch {
    return []
  }
}

/** Whether this browser can be sent a push at all (iOS only when the app is on the home screen). */
export const canPush = (): boolean => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.getRegistration(`${HUB_MOUNT}/`)
}

/** The topics this device has on: none without a push subscription, or after the permission was taken back. */
export async function currentTopics(): Promise<Topic[]> {
  if (!canPush() || Notification.permission !== 'granted') return []
  const subscription = await (await registration())?.pushManager.getSubscription()
  return subscription === null || subscription === undefined ? [] : topicsOf(localStorage.getItem(STORAGE_KEY))
}

async function send(action: 'subscribe' | 'unsubscribe', body: unknown): Promise<void> {
  const answer = await fetch(appUrl(`/push/${action}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!answer.ok) throw new Error(`${action}: ${answer.status}`)
}

/** Makes `topics` the ones this device is told about: none is no subscription at all. Throws with a message for a person when it cannot. */
export async function setTopics(topics: readonly Topic[]): Promise<void> {
  const worker = await registration()
  if (worker === undefined) throw new Error('Varsler virker bare i den installerte appen.')
  const existing = await worker.pushManager.getSubscription()
  if (topics.length === 0) {
    if (existing !== null) {
      await send('unsubscribe', { endpoint: existing.endpoint })
      await existing.unsubscribe()
    }
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Nettleseren har ikke gitt tillatelse til varsler.')
  let subscription = existing
  if (subscription === null) {
    const key = await fetch(appUrl('/push/key'))
    if (!key.ok) throw new Error('Varsler er ikke satt opp på maskinen ennå.')
    subscription = await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await key.text()) })
  }
  const { endpoint, keys } = subscription.toJSON()
  await send('subscribe', { endpoint, keys, topics })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(topics))
}
