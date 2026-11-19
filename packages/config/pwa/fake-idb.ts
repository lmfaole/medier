/**
 * An in-memory stand-in for `indexedDB`, for the tests of `share-files.ts` and of what is built on it (the page's queue, the worker's share and
 * Background Fetch handling): just what the store calls, with the same asynchrony (a request answers on a later tick, a transaction completes after its
 * requests). Values are kept as they were put in, not cloned.
 */
import type { IdbFactoryLike } from './share-files.ts'

interface Rows {
  auto: boolean
  next: number
  rows: Map<IDBValidKey, unknown>
}

const later = (run: () => void): void => queueMicrotask(run)

/** A request: `result` is set, then `success` is dispatched, on a later tick. */
class Request<T> extends EventTarget {
  result: T
  error: unknown = null
  constructor(result: T) {
    super()
    this.result = result
  }
}

class Transaction extends EventTarget {
  error: unknown = null
  private pending = 0
  private readonly rows: Rows
  constructor(rows: Rows) {
    super()
    this.rows = rows
  }
  private answer<T>(value: () => T): Request<T> {
    const request = new Request<T>(value())
    this.pending++
    later(() => {
      request.dispatchEvent(new Event('success'))
      if (--this.pending === 0) later(() => this.dispatchEvent(new Event('complete')))
    })
    return request
  }
  objectStore() {
    const { rows } = this
    return {
      add: (value: unknown) => this.answer(() => rows.rows.set(rows.next, value) && rows.next++),
      put: (value: unknown, key?: IDBValidKey) => this.answer(() => (rows.rows.set(key ?? rows.next, value), key ?? rows.next++)),
      get: (key: IDBValidKey) => this.answer(() => rows.rows.get(key)),
      getAll: () => this.answer(() => [...rows.rows.values()]),
      getAllKeys: () => this.answer(() => [...rows.rows.keys()]),
      delete: (key: IDBValidKey) => this.answer(() => void rows.rows.delete(key)),
    }
  }
}

export function fakeIndexedDB(): IdbFactoryLike {
  const stores = new Map<string, Rows>()
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore(name: string, options?: { autoIncrement?: boolean }) {
      stores.set(name, { auto: options?.autoIncrement === true, next: 1, rows: new Map() })
    },
    transaction(name: string) {
      const rows = stores.get(name)
      if (rows === undefined) throw new Error(`no object store ${name}`)
      return new Transaction(rows)
    },
  }
  return {
    open() {
      const request = new Request(db)
      later(() => {
        if (stores.size === 0) request.dispatchEvent(new Event('upgradeneeded'))
        request.dispatchEvent(new Event('success'))
      })
      return request
    },
  }
}
