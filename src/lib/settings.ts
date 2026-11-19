/**
 * Every setting the site needs, in one list: the keys are GitHub Actions **secrets** of this repository, the user names **variables**. Nothing of
 * it is ever in a file here. `npm run settings:push` sets them from env files kept elsewhere (the private monorepo's `secrets/`), and the
 * workflow checks them before it fetches (`npm run settings:check`), so a missing one is a failed run that names it, not an empty page.
 */

export interface Setting {
  name: string
  kind: "secret" | "variable"
  /** What it is and where to get one. */
  about: string
  /** Used when the variable is not set; a secret has none. */
  fallback?: string
}

export const SETTINGS: readonly Setting[] = [
  { name: "LASTFM_API_KEY", kind: "secret", about: "Last.fm API key: https://www.last.fm/api/account/create" },
  { name: "LASTFM_USER", kind: "variable", about: "the Last.fm user whose plays are shown", fallback: "snowpony69" },
  { name: "TRAKT_CLIENT_ID", kind: "secret", about: "Trakt app Client ID: https://trakt.tv/oauth/applications (the profile must be public)" },
  { name: "TMDB_API_KEY", kind: "secret", about: "TMDB API key or read access token, for the posters: https://www.themoviedb.org/settings/api" },
  { name: "TRAKT_USER", kind: "variable", about: "the Trakt user whose history is shown", fallback: "lmfaole" },
]

/** `KEY=value` lines, as the env files are written: comments and blank lines skipped, one pair of quotes around a value taken off. */
export function parseEnvFile(text: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (match === null || line.trimStart().startsWith("#")) continue
    const [, name = "", raw = ""] = match
    values.set(name, raw.replace(/^(['"])(.*)\1$/, "$2"))
  }
  return values
}

/** The settings found in the given values (later files win), and the ones not found: what `push` sets and what it says is missing. */
export function plan(settings: readonly Setting[], values: ReadonlyMap<string, string>): { set: { setting: Setting; value: string }[]; missing: Setting[] } {
  const set: { setting: Setting; value: string }[] = []
  const missing: Setting[] = []
  for (const setting of settings) {
    const value = values.get(setting.name)
    if (value === undefined || value === "") missing.push(setting)
    else set.push({ setting, value })
  }
  return { set, missing }
}

/** The secrets a run lacks (a variable has its fallback, so it is never missing). */
export function missingSecrets(settings: readonly Setting[], env: Readonly<Record<string, string | undefined>>): Setting[] {
  return settings.filter((setting) => setting.kind === "secret" && (env[setting.name] ?? "") === "")
}
