import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { fakeIndexedDB } from './fake-idb.ts'
import { inboxStore, type JobRecord } from './share-files.ts'
import { finishBackground, isShareRequest, receiveShare, shareEnabled, shareErrorOf, sharedLocation } from './sw-app-share.ts'

const SCOPE = '/apps/hjemmeserver/innboks/'

test('only innboks takes a share', () => {
  assert.equal(shareEnabled('innboks'), true)
  for (const app of ['hjem', 'penger', 'miniflux']) assert.equal(shareEnabled(app), false)
})

test('the share target is a POST to <scope>share and nothing else', () => {
  const at = (method: string, path: string) => isShareRequest({ method, url: `https://sky.example${path}` }, SCOPE)
  assert.equal(at('POST', `${SCOPE}share`), true)
  assert.equal(at('GET', `${SCOPE}share`), false)
  assert.equal(at('POST', `${SCOPE}`), false)
  assert.equal(at('POST', '/apps/hjemmeserver/hjem/share'), false)
  assert.equal(sharedLocation(`https://sky.example${SCOPE}`), `https://sky.example${SCOPE}?shared`)
})

test('the files of a share go into the store, and anything else in the form is ignored', async () => {
  const store = inboxStore(fakeIndexedDB())
  const form = new FormData()
  form.append('files', new File(['a'], 'a.gba'))
  form.append('files', new File(['b'], 'b.gba'))
  form.append('title', 'not a file')
  const failures: unknown[] = []
  await receiveShare({ formData: async () => form }, store, (message) => void failures.push(message))
  assert.deepEqual((await store.readShared()).map((item) => item.file.name), ['a.gba', 'b.gba'])
  assert.deepEqual(failures, [])
})

test('a share that cannot be read tells the page why, which is waiting for it', async () => {
  const store = inboxStore(fakeIndexedDB())
  const failures: unknown[] = []
  await receiveShare({ formData: async () => Promise.reject(new Error('body too large')) }, store, (message) => void failures.push(message))
  assert.deepEqual(failures, [{ innboks: 'innboks', message: 'body too large' }])
  assert.equal(shareErrorOf(failures[0]), 'body too large')
  assert.equal(shareErrorOf({ other: 1 }), null)
  assert.equal(shareErrorOf(null), null)
})

const JOB: JobRecord = {
  name: 'big.nds',
  sharedKey: 1,
  complete: [
    { method: 'MOVE', url: '/uploads/u/.file', headers: { requesttoken: 'old', Destination: '/files/tmp' } },
    { method: 'MOVE', url: '/files/tmp', headers: { requesttoken: 'old', Destination: '/files/final', Overwrite: 'F' } },
  ],
  cleanup: [{ method: 'DELETE', url: '/uploads/u', headers: {} }, { method: 'DELETE', url: '/files/tmp', headers: {} }],
}

/** A store with the job and one shared file, and a fetch that records what it was sent and answers from [answer]. */
async function setup(answer: (method: string, url: string, headers: Headers) => number) {
  const store = inboxStore(fakeIndexedDB())
  await store.putShared([new File(['x'], 'big.nds')])
  await store.putJob('innboks-1', JOB)
  const sent: string[] = []
  const fetchFn = async (url: string, init: RequestInit) => {
    sent.push(`${init.method} ${url}`)
    return url === '/index.php/csrftoken' ? new Response(JSON.stringify({ token: 'fresh' })) : new Response(null, { status: answer(String(init.method), url, new Headers(init.headers)) })
  }
  return { store, sent, fetchFn }
}

test('a background upload that succeeded is put together and moved into place, the shared file is let go and the record deleted', async () => {
  const { store, sent, fetchFn } = await setup(() => 201)
  assert.equal(await finishBackground('innboks-1', 'success', store, fetchFn), 'Innboks: big.nds er sendt')
  assert.deepEqual(sent, ['MOVE /uploads/u/.file', 'MOVE /files/tmp'])
  assert.deepEqual(await store.readShared(), [])
  assert.equal(await store.getJob('innboks-1'), undefined)
})

test('a move that is refused cleans up, keeps the shared file and says it failed', async () => {
  const { store, sent, fetchFn } = await setup((_method, url) => (url === '/files/tmp' ? 507 : 201))
  assert.equal(await finishBackground('innboks-1', 'success', store, fetchFn), 'Innboks: big.nds feilet')
  assert.deepEqual(sent, ['MOVE /uploads/u/.file', 'MOVE /files/tmp', 'DELETE /uploads/u', 'DELETE /files/tmp'])
  assert.equal((await store.readShared()).length, 1)
  assert.equal(await store.getJob('innboks-1'), undefined)
})

test('a stale token (412) is replaced once and the request sent again', async () => {
  const { store, sent, fetchFn } = await setup((_method, _url, headers) => (headers.get('requesttoken') === 'old' ? 412 : 201))
  assert.equal(await finishBackground('innboks-1', 'success', store, fetchFn), 'Innboks: big.nds er sendt')
  assert.deepEqual(sent, ['MOVE /uploads/u/.file', 'GET /index.php/csrftoken', 'MOVE /uploads/u/.file', 'MOVE /files/tmp', 'GET /index.php/csrftoken', 'MOVE /files/tmp'])
})

test('a failed fetch cleans up and says so; an abort cleans up quietly; both delete the record', async () => {
  for (const [outcome, said] of [['fail', 'Innboks: big.nds feilet'], ['abort', null]] as const) {
    const { store, sent, fetchFn } = await setup(() => 204)
    assert.equal(await finishBackground('innboks-1', outcome, store, fetchFn), said)
    assert.deepEqual(sent, ['DELETE /uploads/u', 'DELETE /files/tmp'])
    assert.equal(await store.getJob('innboks-1'), undefined)
    assert.equal((await store.readShared()).length, 1)
  }
})

test('a fetch with no job record is not ours to finish', async () => {
  const { store, sent, fetchFn } = await setup(() => 201)
  assert.equal(await finishBackground('other', 'success', store, fetchFn), null)
  assert.deepEqual(sent, [])
})
