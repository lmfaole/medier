/**
 * The requests music's snapshot has a file for: every file the pages read, with
 * each day, month and entity that takes one.
 */

import type { SnapshotRequests } from '@designsystem/config/snapshot-files'

import { aliasedSheets, entities, unplayedSheets } from './entities.ts'
import { history } from './api.ts'

const historyMonths = async (db: D1Database) => (await history(db, null))?.months ?? []

export const snapshot: SnapshotRequests = {
  async requests(db) {
    return [
      '/api/periods.json',
      '/api/history.json',
      ...(await historyMonths(db)).map((month) => `/api/history.json?month=${month}`),
      '/api/weeks.json',
      '/api/months.json',
      '/api/years.json',
      '/api/entities.json',
      '/api/library.json',
      ...(await entities(db)).map(({ kind, slug }) => `/api/entity.json?kind=${kind}&slug=${slug}`),
      // A work of the collection that was never played has a page too.
      ...(await unplayedSheets(db)).map(({ kind, slug }) => `/api/entity.json?kind=${kind}&slug=${slug}`),
      // An address a page had before its spellings were joined still answers.
      ...(await aliasedSheets(db)).map(({ kind, slug }) => `/api/entity.json?kind=${kind}&slug=${slug}`),
      '/api/recent.json',
    ]
  },
}
