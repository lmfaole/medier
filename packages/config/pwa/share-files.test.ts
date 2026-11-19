import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { fakeIndexedDB } from './fake-idb.ts'
import { inboxStore } from './share-files.ts'

const file = (name: string) => new File(['x'], name)

test('a shared file is kept, with its key, until it is removed', async () => {
  const store = inboxStore(fakeIndexedDB())
  await store.putShared([file('a.gba'), file('b.gba')])
  const shared = await store.readShared()
  assert.deepEqual(shared.map((item) => item.file.name), ['a.gba', 'b.gba'])
  await store.removeShared(shared[0]?.key ?? 0)
  assert.deepEqual((await store.readShared()).map((item) => item.file.name), ['b.gba'])
})

test('the queue keeps the destination of each file', async () => {
  const store = inboxStore(fakeIndexedDB())
  await store.queueFile(file('a.jpg'), 'immich')
  const [item] = await store.readQueue()
  assert.equal(item?.destinationId, 'immich')
  await store.removeQueued(item?.key ?? 0)
  assert.deepEqual(await store.readQueue(), [])
})

test('a job is stored under the id of its background fetch, read back whole, and one that is not a job is dropped', async () => {
  const idb = fakeIndexedDB()
  const store = inboxStore(idb)
  const job = { name: 'a.bin', sharedKey: 3, complete: [{ method: 'MOVE', url: '/a', headers: { x: '1' } }], cleanup: [{ method: 'DELETE', url: '/b', headers: {} }] }
  await store.putJob('innboks-1', job)
  assert.deepEqual(await store.getJob('innboks-1'), job)
  assert.deepEqual(await store.readJobs(), [{ id: 'innboks-1', ...job }])
  const raw = idb.open('innboks', 3)
  await new Promise<void>((resolve) => raw.addEventListener('success', () => resolve()))
  raw.result.transaction('jobs', 'readwrite').objectStore('jobs').put({ name: 'old', complete: 'MOVE' }, 'innboks-2')
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(await store.getJob('innboks-2'), undefined)
  assert.deepEqual((await store.readJobs()).map((stored) => stored.id), ['innboks-1'])
  await store.deleteJob('innboks-1')
  assert.equal(await store.getJob('innboks-1'), undefined)
})
