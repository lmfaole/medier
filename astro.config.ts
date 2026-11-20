import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// A static site on GitHub Pages, on its own domain (medier.lmfaole.party, set in the repository's Pages settings): every page is HTML
// made at build time from the JSON in data/. On its own domain the site is at the root, so there is no base: a base of `/medier`
// would ask for the styles and fonts at /medier/_astro/…, which is nothing there.
export default defineConfig({
  site: 'https://medier.lmfaole.party',
  base: '/',
  output: 'static',
  trailingSlash: 'always',
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
})
