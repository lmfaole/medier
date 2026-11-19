import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { pushActionOf, pushEnabled, tagsToClose } from './sw-app-push.ts'

test('only hjem has the push handlers', () => {
  assert.equal(pushEnabled('hjem'), true)
  for (const app of ['penger', 'innboks', 'miniflux', 'hjemx']) assert.equal(pushEnabled(app), false)
})

test('an activation token is answered, whatever else the payload says', () => {
  assert.deepEqual(pushActionOf({ activationToken: 't0k3n', subject: 'x' }), { kind: 'activate', token: 't0k3n' })
})

test('a delete message closes one notification, several, or all of them', () => {
  assert.deepEqual(pushActionOf({ delete: true, nid: 7 }), { kind: 'close', ids: [7] })
  assert.deepEqual(pushActionOf({ 'delete-multiple': true, nids: [1, 2, '3'] }), { kind: 'close', ids: [1, 2, 3] })
  assert.deepEqual(pushActionOf({ 'delete-all': true }), { kind: 'close', ids: null })
})

test('a notification is shown under its id, with Nextcloud\'s subject, or a generic title when there is none', () => {
  assert.deepEqual(pushActionOf({ nid: 12, app: 'hjemmeserver', subject: 'Sikkerhetskopi er nede' }), { kind: 'show', title: 'Sikkerhetskopi er nede', tag: '12', data: { nid: 12, app: 'hjemmeserver', subject: 'Sikkerhetskopi er nede' } })
  const untitled = pushActionOf({ nid: 3, subject: '' })
  assert.equal(untitled.kind === 'show' ? untitled.title : '', 'Hjemmeserver')
  const generic = pushActionOf(null)
  assert.equal(generic.kind === 'show' ? generic.title : '', 'Hjemmeserver')
})

test('a close action dismisses the open notifications it names; none named by null means all', () => {
  assert.deepEqual(tagsToClose(['1', '2', 'silent', '3'], [1, 3]), ['1', '3'])
  assert.deepEqual(tagsToClose(['1', 'silent'], null), ['1', 'silent'])
})
