/**
 * Which parts of the repository a list of changed files touches, and what to run for them, as pure
 * functions: `affected.ts` runs the checks of those parts and `ship.ts` deploys the apps among them.
 * A part is `apps/<name>`, `packages/<name>`, `scripts`, `e2e` or `crates`; a file in none of them
 * (the root config, the database schemas) is `other`, which only a full `npm run verify` covers.
 */

import { APPS, SERVED_APPS } from "./apps.ts"

export interface Units {
  apps: string[]
  packages: string[]
  scripts: boolean
  e2e: boolean
  crates: boolean
  other: string[]
}

export function unitsOf(files: readonly string[]): Units {
  const apps = new Set<string>()
  const packages = new Set<string>()
  const units: Units = { apps: [], packages: [], scripts: false, e2e: false, crates: false, other: [] }
  for (const file of files) {
    const [top = "", name = ""] = file.split("/")
    if (top === "apps" && APPS.some((app) => app.name === name)) apps.add(name)
    else if (top === "packages" && name !== "") packages.add(name)
    else if (top === "scripts" || top === "scripts-local") units.scripts = true
    else if (top === "e2e") units.e2e = true
    else if (top === "crates") units.crates = true
    else if (!file.startsWith(".data/") && !file.startsWith("docs/") && !file.endsWith(".md")) units.other.push(file)
  }
  units.apps = APPS.map((app) => app.name).filter((name) => apps.has(name))
  units.packages = [...packages].toSorted()
  return units
}

export interface Check {
  name: string
  command: string
}

/**
 * Lint, typecheck and the tests of what changed. A change to a package is also typechecked in every app,
 * because the apps are its callers; a change to a Rust crate or the root config is not covered here.
 */
export function checksFor(units: Units): Check[] {
  const checks: Check[] = []
  const globs: string[] = []
  for (const app of units.apps) {
    checks.push({ name: `lint ${app}`, command: `npm --prefix apps/${app} run -s lint --if-present` })
    globs.push(`apps/${app}/**/*.test.ts`)
  }
  for (const name of units.packages) {
    checks.push({ name: `lint ${name}`, command: `npm run -s lint --workspace packages/${name} --if-present` })
    checks.push({ name: `typecheck ${name}`, command: `npm run -s typecheck --workspace packages/${name} --if-present` })
    globs.push(`packages/${name}/**/*.test.ts`)
  }
  const typechecked = units.packages.length > 0 ? APPS.map((app) => app.name) : units.apps
  for (const app of typechecked) checks.push({ name: `typecheck ${app}`, command: `npm --prefix apps/${app} run -s typecheck --if-present` })
  if (units.scripts) {
    checks.push({ name: "lint scripts", command: "npx oxlint -c packages/config/oxlintrc.json scripts" })
    checks.push({ name: "typecheck scripts", command: "npx tsc -p scripts --tsBuildInfoFile node_modules/.tmp/scripts.tsbuildinfo" })
    globs.push("scripts/**/*.test.ts")
  }
  if (units.e2e) checks.push({ name: "typecheck e2e", command: "npx tsc -p e2e --tsBuildInfoFile node_modules/.tmp/e2e.tsbuildinfo" })
  if (globs.length > 0) checks.push({ name: "test", command: `node --test ${globs.map((glob) => `"${glob}"`).join(" ")}` })
  return checks
}

export interface ShipPlan {
  /** Apps on Cloudflare. The apps of the media server (the media apps, the hub and the home apps) are never here: they are built and the server restarted (`media-server.ts`). */
  deploy: string[]
  /** Apps of the media server whose own files changed, or every one when shared code did and `withShared` asks. */
  media: string[]
  /** Shared code changed: every app would change, which is deployed only when asked for. */
  sharedChanged: string[]
}

/** The apps to deploy for a commit: the ones whose own files changed, or every app when `withShared`; the media apps are told apart. */
export function shipTargets(files: readonly string[], withShared: boolean): ShipPlan {
  const units = unitsOf(files)
  const shared = [...units.packages.map((name) => `packages/${name}`), ...(units.crates ? ["crates"] : [])]
  const changed = withShared && shared.length > 0 ? APPS.map((app) => app.name) : units.apps
  // An app that is only data (no port, no pages) has nothing to deploy.
  const paged = new Set(APPS.filter((app) => app.port !== undefined).map((app) => app.name))
  return { deploy: changed.filter((app) => paged.has(app) && !SERVED_APPS.includes(app)), media: changed.filter((app) => SERVED_APPS.includes(app)), sharedChanged: withShared ? [] : shared }
}
