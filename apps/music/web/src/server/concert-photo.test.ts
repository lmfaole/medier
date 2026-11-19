import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { handlePhoto, isPhotoPath } from './concert-photo.ts'

const ID = 'b985e025-a91f-4079-b594-aed93d10371b'

test('only the names the sync writes are photos, and a name that leaves the folder is not', () => {
  assert.equal(isPhotoPath(new URL(`https://x/concert-photos/${ID}.webp`)), true)
  assert.equal(isPhotoPath(new URL(`https://x/concert-photos/${ID}.jpg`)), true)
  for (const bad of ['../../secrets/key.webp', `${ID}.png`, `${ID}.webp/../x`, 'x.webp', `.${ID}.webp`]) assert.equal(isPhotoPath(new URL(`https://x/concert-photos/${bad}`)), false, bad)
})

test('a kept photo is answered with its type and one that is not there is a 404', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'photos-'))
  writeFileSync(join(directory, `${ID}.webp`), 'RIFF')
  const found = await handlePhoto(new URL(`https://x/concert-photos/${ID}.webp`), directory)
  assert.deepEqual([found.status, found.headers.get('content-type')], [200, 'image/webp'])
  assert.equal((await handlePhoto(new URL(`https://x/concert-photos/${ID}.jpg`), directory)).status, 404)
})
