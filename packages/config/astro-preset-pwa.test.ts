import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { pwaSetup } from './astro-preset.ts'

test('pwa "app" injects the app\'s own manifest route and says the build installs on its own', () => {
  assert.deepEqual(pwaSetup('app'), { define: { 'import.meta.env.PUBLIC_PWA': '"app"' }, route: { pattern: '/manifest.webmanifest', entrypoint: '@designsystem/ui/pwa-app-manifest-route' } })
})

test('pwa "hub" is as it was, and a build with none only says it is part of the hub\'s installed app', () => {
  assert.deepEqual(pwaSetup('hub'), { define: { 'import.meta.env.PUBLIC_PWA': 'true' }, route: { pattern: '/manifest.webmanifest', entrypoint: '@designsystem/ui/pwa-manifest-route' } })
  assert.deepEqual(pwaSetup(undefined), { define: { 'import.meta.env.PUBLIC_PWA': 'true' } })
})
