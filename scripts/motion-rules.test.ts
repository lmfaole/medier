import { strict as assert } from "node:assert"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { test } from "node:test"

import { sourceFiles } from "./source-files.ts"

const root = join(import.meta.dirname, "..")

/** Files that keep their own motion, with the reason. Everything else takes it from `@designsystem/ui/motion.css` (docs/MOTION.md). */
const OWN_MOTION = new Map<string, string>()

/** Files that may define their own `@keyframes`, and nothing else of their own: a literal duration still fails. */
const OWN_KEYFRAMES = new Map<string, string>()

function appFiles(): string[] {
  const appsRoot = join(root, "apps")
  return readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((app) => join(appsRoot, app.name, "web", "src"))
    .filter((source) => existsSync(source))
    .flatMap((directory) => sourceFiles(directory, /\.(css|tsx|astro)$/))
}

function listed(file: string, entries: ReadonlyMap<string, string>): boolean {
  const path = relative(root, file)
  return [...entries.keys()].some((entry) => path === entry || (entry.endsWith("/") && path.startsWith(entry)))
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
}

/** The rules of docs/MOTION.md that a pattern can check. */
function motionOffenses(path: string, rawSource: string, ownKeyframes = false): string[] {
  const source = path.endsWith(".css") ? withoutComments(rawSource) : rawSource
  const found: string[] = []
  const report = (pattern: RegExp, message: string) => {
    for (const match of source.matchAll(pattern)) {
      found.push(`${path}:${source.slice(0, match.index).split("\n").length}: ${message}`)
    }
  }
  report(
    /\b(?:animation|transition)(?:-duration|-delay)?\s*:[^;{}]*?(?<![\w.-])\d*\.?\d+m?s\b/g,
    "a literal duration; use a --motion-duration-* token",
  )
  report(/\b(?:duration|delay)-(?:\d+|\[)/g, "a literal duration class; use a --motion-duration-* token")
  if (!ownKeyframes) report(/@keyframes\b/g, "its own @keyframes; use the shared ones in motion.css")
  report(/\btransition-all\b/g, "transition-all; name the properties that move")
  if (/\banimate-(?:pulse|spin|bounce|ping)\b/.test(source) && !source.includes('data-motion="essential"')) {
    found.push(`${path}: a looping animate-* class without data-motion="essential"`)
  }
  return found
}

test("apps take their motion from the shared tokens and keyframes", () => {
  const offenders = appFiles()
    .filter((file) => !listed(file, OWN_MOTION))
    .flatMap((file) => motionOffenses(relative(root, file), readFileSync(file, "utf8"), listed(file, OWN_KEYFRAMES)))
  assert.deepEqual(offenders, [])
})

test("the checks catch what they are for", () => {
  assert.equal(motionOffenses("a.css", ".x { transition: opacity 200ms ease; }").length, 1)
  assert.equal(motionOffenses("a.css", ".x { animation: rise var(--motion-duration-slow) both; }").length, 0)
  assert.equal(motionOffenses("a.css", "/* 200ms in a comment */ .x { color: red; }").length, 0)
  assert.equal(motionOffenses("a.tsx", '<div className="duration-200" />').length, 1)
  assert.equal(motionOffenses("a.tsx", '<div className="transition-all" />').length, 1)
  assert.equal(motionOffenses("a.tsx", '<Loader2 className="animate-spin" />').length, 1)
  assert.equal(motionOffenses("a.tsx", '<Loader2 data-motion="essential" className="animate-spin" />').length, 0)
  assert.equal(motionOffenses("a.css", "@keyframes x { from { opacity: 0 } }").length, 1)
  assert.equal(motionOffenses("a.css", "@keyframes x { from { opacity: 0 } }", true).length, 0)
  assert.equal(motionOffenses("a.css", ".x { transition: filter 400ms ease; }", true).length, 1)
  assert.equal(motionOffenses("a.astro", "<style>.x { transition: opacity 200ms ease; }</style>").length, 1)
  assert.equal(motionOffenses("a.astro", '<a class="transition-all" />').length, 1)
})
