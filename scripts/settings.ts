/**
 * The site's GitHub settings (`src/lib/settings.ts`).
 *
 *   npm run settings:push -- <env file>… [--dry-run]   sets each secret and variable found in the files with the GitHub CLI (`gh`, signed in, allowed
 *                                         to admin the repository); the value goes in on stdin, never on the command line, and is never printed
 *   npm run settings:check                 fails when a secret is not in the environment (the workflow runs it before it fetches)
 *
 * The files are the private monorepo's, e.g. `secrets/music-sync.env` and `secrets/film-sync.env`: only the names listed here are taken.
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

import { missingSecrets, parseEnvFile, plan, SETTINGS } from "../src/lib/settings.ts"

const REPOSITORY = process.env["GITHUB_REPOSITORY"] ?? "lmfaole/medier"
const [command, ...rest] = process.argv.slice(2)
const dry = rest.includes("--dry-run")
const files = rest.filter((word) => word !== "--dry-run")

if (command === "check") {
  const missing = missingSecrets(SETTINGS, process.env)
  for (const setting of missing) console.error(`missing secret ${setting.name}: ${setting.about}. Set it with npm run settings:push, or in Settings → Secrets and variables → Actions.`)
  if (missing.length > 0) process.exit(1)
  console.log(`${SETTINGS.length} settings in place`)
} else if (command === "push" && files.length > 0) {
  const values = new Map(files.flatMap((file) => [...parseEnvFile(readFileSync(file, "utf8"))]))
  const { set, missing } = plan(SETTINGS, values)
  for (const { setting, value } of set) {
    if (!dry) execFileSync("gh", [setting.kind, "set", setting.name, "--repo", REPOSITORY], { input: value, stdio: ["pipe", "ignore", "inherit"] })
    console.log(`${setting.kind} ${setting.name}: ${dry ? "would be set" : "set"}`)
  }
  for (const setting of missing) console.log(`${setting.kind} ${setting.name}: not in the files${setting.fallback === undefined ? "" : `, so ${setting.fallback} is used`} (${setting.about})`)
} else {
  console.error("usage: node scripts/settings.ts push <env file>… | check")
  process.exit(2)
}
