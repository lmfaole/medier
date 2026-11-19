import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildServiceWorker } from './build-sw.ts'

test('the hub worker and a home app\'s shell worker are two scripts, each with its build id in its cache name', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'build-sw-'))
  try {
    await buildServiceWorker(join(directory, 'hub.js'), 'b1')
    await buildServiceWorker(join(directory, 'app.js'), 'b2', 'app')
    const hub = readFileSync(join(directory, 'hub.js'), 'utf8')
    const app = readFileSync(join(directory, 'app.js'), 'utf8')
    assert.ok(hub.includes('pwa-b1') || (hub.includes('"pwa-"') && hub.includes('b1')))
    assert.ok(app.includes('b2') && app.includes('-shell-'))
    assert.ok(!app.includes('music-digest'), 'a home app\'s shell worker does not carry the hub\'s push payload handling')
    assert.ok(app.includes('webpush/activate'), 'it carries the Nextcloud push handling of the apps in PUSH_APPS instead')
    assert.ok(!app.includes('BUILD_ID'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
