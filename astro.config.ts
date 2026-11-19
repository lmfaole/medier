import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// A static site on GitHub Pages, at lmfaole.github.io/medier: every page is HTML made at build time from the JSON in data/.
export default defineConfig({
  site: 'https://lmfaole.github.io',
  base: '/medier',
  output: 'static',
  trailingSlash: 'always',
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
})
