/**
 * What deploying an app does, as data, so a test can read the order and
 * `deploy-app --dry-run` can print it. Every app is on Astro, whose
 * `astro build` writes page and Worker together, so the config to deploy is
 * the one that build wrote (`web/dist/server/wrangler.json`).
 *
 * No Worker has a database: before the build, `npm run snapshot` writes the
 * app's API as static files from the local database (`scripts/snapshot.ts`),
 * and the build ships them as assets. A deploy therefore runs where
 * `.data/` is, on the owner's machine.
 *
 * A deploy is refused when the config binds a database, a bucket
 * or a key-value store (`forbiddenBindings`, `packages/config/bindings-config.ts`):
 * every app is public, so the snapshot is the only data a Worker may hold. It is also
 * refused when the build it just made contains the devtools.
 */

type Env = Record<string, string>

export type DeployStep =
  | { kind: "assertNoBindings"; file: string }
  | { kind: "assertNoDevtools"; directory: string }
  /**
   * The last step: `wrangler deploy`, unless the built output (`directory`) is byte for byte the one last deployed
   * (`deploy-hash.ts`), when there is nothing to upload and a new Worker version would only cost ~30 s.
   */
  | { kind: "deployIfChanged"; directory: string; command: string; args: string[] }
  | {
      kind: "run"
      command: string
      args: string[]
      env?: Env
    }

const BUILT_DIRECTORY = "web/dist"
const BUILT_CONFIG = "web/dist/server/wrangler.json"
/** `snapshot` is false for an app with no data of its own (it has no `server/api.ts`), which has no API files to write. */
export function planDeploy({ snapshot: hasData = true }: { snapshot?: boolean } = {}): DeployStep[] {
  const snapshot: DeployStep[] = hasData ? [{ kind: "run", command: "npm", args: ["run", "snapshot"] }] : []
  return [
    { kind: "assertNoBindings", file: "wrangler.jsonc" },
    ...snapshot,
    { kind: "run", command: "npm", args: ["run", "build"] },
    { kind: "assertNoBindings", file: BUILT_CONFIG },
    { kind: "assertNoDevtools", directory: BUILT_DIRECTORY },
    { kind: "deployIfChanged", directory: BUILT_DIRECTORY, command: "npx", args: ["wrangler", "deploy", "--config", BUILT_CONFIG] },
  ]
}

/**
 * `npm run deploy -- --dry-run` passes the flag on. Without the `--` npm takes
 * `--dry-run` for itself, sets this variable and passes the script nothing, so
 * the variable has to count too or the typo publishes to production.
 */
/** `--force` (or `DEPLOY_FORCE=1`) deploys even when the built output is the one last deployed. */
export function isForced(argv: readonly string[], env: Record<string, string | undefined>): boolean {
  return argv.includes("--force") || env["DEPLOY_FORCE"] === "1"
}

export function isDryRun(argv: readonly string[], env: Record<string, string | undefined>): boolean {
  return argv.includes("--dry-run") || env.npm_config_dry_run === "true"
}

/** One printable line for a step, its environment first. */
export function formatStep(step: DeployStep): string {
  if (step.kind === "assertNoBindings") return `check that ${step.file} binds no database, bucket or key-value store`
  if (step.kind === "assertNoDevtools") return `check that ${step.directory} has no devtools in it`
  if (step.kind === "deployIfChanged") return `${step.command} ${step.args.join(" ")}   (skipped when ${step.directory} is the one last deployed; --force deploys anyway)`
  const env = Object.entries(step.env ?? {}).map(([name, value]) => `${name}=${value} `).join("")
  return `${env}${step.command} ${step.args.join(" ")}`
}
