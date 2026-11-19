/**
 * What Innboks keeps in the browser's IndexedDB (database `innboks`, the one the plain-JS app had, so a file waiting when the installed copy is
 * updated is not lost), shared by the page and by the app's service worker, which is why it lives with the worker (`sw-app-share.ts`):
 *
 * - «shared»: files the worker took from a Web Share Target POST, until the page has delivered them (or put them in the queue);
 * - «queue»: files that could not be sent for lack of a network, with their destination, until the page is online again;
 * - «jobs»: a Background Fetch in flight, keyed by the id of the fetch, with the requests the worker sends when it has succeeded.
 *
 * `IdbFactoryLike` is the part of `indexedDB` it uses, so the tests run on an in-memory one (`fake-idb.ts`).
 */

const DATABASE = 'innboks'
const VERSION = 3

/** A request the worker sends later, ready made by the page: it knows nothing of what the requests mean (`apps/innboks/web/src/lib/dav.ts` does). */
export interface Step {
  method: string
  url: string
  headers: Record<string, string>
}

/** A file shared from another app, waiting for its destination. */
export interface SharedItem {
  key: IDBValidKey
  file: File
}

/** A file waiting for a network, with the id of its destination. */
export interface QueuedItem {
  key: IDBValidKey
  file: File
  destinationId: string
}

/** What the worker needs to finish a background upload. */
export interface JobRecord {
  /** The name shown in the notification and the list. */
  name: string
  /** The shared file to let go when the upload has succeeded. */
  sharedKey?: IDBValidKey
  /** Sent in order after the last chunk has arrived; the first one that fails stops the upload. */
  complete: Step[]
  /** Sent, whatever each answers, when the upload failed or was aborted: removes what was left on the server. */
  cleanup: Step[]
}

export type StoredJob = JobRecord & { id: string }

interface IdbEvents {
  addEventListener(type: string, listener: () => void): void
}
interface IdbRequest<T> extends IdbEvents {
  result: T
  error: unknown
}
interface IdbObjectStore {
  add(value: unknown): IdbRequest<IDBValidKey>
  put(value: unknown, key?: IDBValidKey): IdbRequest<IDBValidKey>
  get(key: IDBValidKey): IdbRequest<unknown>
  getAll(): IdbRequest<unknown[]>
  getAllKeys(): IdbRequest<IDBValidKey[]>
  delete(key: IDBValidKey): IdbRequest<undefined>
}
interface IdbTransaction extends IdbEvents {
  objectStore(name: string): IdbObjectStore
  error: unknown
}
interface IdbDatabase {
  objectStoreNames: { contains(name: string): boolean }
  createObjectStore(name: string, options?: { autoIncrement?: boolean }): unknown
  transaction(name: string, mode: 'readonly' | 'readwrite'): IdbTransaction
}

/** The part of `IDBFactory` the store uses. */
export interface IdbFactoryLike {
  open(name: string, version: number): IdbRequest<IdbDatabase>
}

/** What the page and the worker do with the three stores. */
export interface InboxStore {
  putShared(files: readonly File[]): Promise<void>
  readShared(): Promise<SharedItem[]>
  removeShared(key: IDBValidKey): Promise<void>
  queueFile(file: File, destinationId: string): Promise<void>
  readQueue(): Promise<QueuedItem[]>
  removeQueued(key: IDBValidKey): Promise<void>
  putJob(id: string, job: JobRecord): Promise<void>
  getJob(id: string): Promise<JobRecord | undefined>
  deleteJob(id: string): Promise<void>
  readJobs(): Promise<StoredJob[]>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isStep = (value: unknown): value is Step => isRecord(value) && typeof value['method'] === 'string' && typeof value['url'] === 'string' && isRecord(value['headers'])
const isKey = (value: unknown): value is IDBValidKey => typeof value === 'number' || typeof value === 'string'

/** A job as it was stored, or `undefined` when what is there is not one (a record of an older build is dropped rather than half-run). */
function jobOf(value: unknown): JobRecord | undefined {
  if (!isRecord(value) || typeof value['name'] !== 'string') return undefined
  const { complete, cleanup, sharedKey } = value
  if (!Array.isArray(complete) || !complete.every(isStep) || !Array.isArray(cleanup) || !cleanup.every(isStep)) return undefined
  return { name: value['name'], complete, cleanup, ...(isKey(sharedKey) ? { sharedKey } : {}) }
}

export function inboxStore(idb: IdbFactoryLike): InboxStore {
  let opened: Promise<IdbDatabase> | undefined
  const open = (): Promise<IdbDatabase> =>
    (opened ??= new Promise<IdbDatabase>((resolve, reject) => {
      const request = idb.open(DATABASE, VERSION)
      request.addEventListener('upgradeneeded', () => {
        for (const name of ['shared', 'queue']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { autoIncrement: true })
        // «jobs» is keyed by the id of the background fetch that carries the file.
        if (!request.result.objectStoreNames.contains('jobs')) request.result.createObjectStore('jobs')
      })
      request.addEventListener('success', () => resolve(request.result))
      request.addEventListener('error', () => {
        opened = undefined
        reject(request.error)
      })
    }))

  /** Runs [work] in one transaction and resolves with what it returns once the transaction has completed. */
  async function transact<T>(store: string, mode: 'readonly' | 'readwrite', work: (objects: IdbObjectStore) => () => T): Promise<T> {
    const tx = (await open()).transaction(store, mode)
    const result = work(tx.objectStore(store))
    await new Promise<void>((resolve, reject) => {
      tx.addEventListener('complete', () => resolve())
      tx.addEventListener('error', () => reject(tx.error))
    })
    return result()
  }

  return {
    putShared: (files) =>
      transact('shared', 'readwrite', (objects) => {
        for (const file of files) objects.add(file)
        return () => undefined
      }),
    readShared: () =>
      transact('shared', 'readonly', (objects) => {
        const keys = objects.getAllKeys()
        const files = objects.getAll()
        return () => keys.result.flatMap((key, index) => (files.result[index] instanceof File ? [{ key, file: files.result[index] }] : []))
      }),
    removeShared: (key) =>
      transact('shared', 'readwrite', (objects) => {
        objects.delete(key)
        return () => undefined
      }),
    queueFile: (file, destinationId) =>
      transact('queue', 'readwrite', (objects) => {
        objects.add({ file, destinationId })
        return () => undefined
      }),
    readQueue: () =>
      transact('queue', 'readonly', (objects) => {
        const keys = objects.getAllKeys()
        const items = objects.getAll()
        return () =>
          keys.result.flatMap((key, index) => {
            const item = items.result[index]
            return isRecord(item) && item['file'] instanceof File && typeof item['destinationId'] === 'string' ? [{ key, file: item['file'], destinationId: item['destinationId'] }] : []
          })
      }),
    removeQueued: (key) =>
      transact('queue', 'readwrite', (objects) => {
        objects.delete(key)
        return () => undefined
      }),
    putJob: (id, job) =>
      transact('jobs', 'readwrite', (objects) => {
        objects.put(job, id)
        return () => undefined
      }),
    getJob: (id) =>
      transact('jobs', 'readonly', (objects) => {
        const request = objects.get(id)
        return () => jobOf(request.result)
      }),
    deleteJob: (id) =>
      transact('jobs', 'readwrite', (objects) => {
        objects.delete(id)
        return () => undefined
      }),
    readJobs: () =>
      transact('jobs', 'readonly', (objects) => {
        const keys = objects.getAllKeys()
        const jobs = objects.getAll()
        return () =>
          keys.result.flatMap((id, index) => {
            const job = jobOf(jobs.result[index])
            return typeof id === 'string' && job !== undefined ? [{ id, ...job }] : []
          })
      }),
  }
}
