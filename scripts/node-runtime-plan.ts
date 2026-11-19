/**
 * Which Node `node-runtime.ts` installs, as pure functions: the newest release of the major in `.node-version` that has a
 * build for this machine, and the checksum nodejs.org gives for its tarball.
 */

export interface Release {
  /** `v24.11.1` */
  version: string
  /** Build names, `linux-x64` among them. */
  files: string[]
}

/** The major `.node-version` names (`24`, `v24` or `24.11.1`), or `null` when it is not a version. */
export function wantedMajor(text: string): number | null {
  const match = /^v?(\d+)(\.\d+){0,2}$/.exec(text.trim())
  return match?.[1] === undefined ? null : Number(match[1])
}

function parts(version: string): number[] {
  return version.replace(/^v/, "").split(".").map(Number)
}

/** The newest release of `major` that has `build`, or `null` when there is none. */
export function newestInMajor(releases: readonly Release[], major: number, build: string): string | null {
  const fitting = releases.filter((release) => parts(release.version)[0] === major && release.files.includes(build))
  fitting.sort((a, b) => {
    const [x, y] = [parts(a.version), parts(b.version)]
    return (y[0] ?? 0) - (x[0] ?? 0) || (y[1] ?? 0) - (x[1] ?? 0) || (y[2] ?? 0) - (x[2] ?? 0)
  })
  return fitting[0]?.version ?? null
}

/** The sha256 that `SHASUMS256.txt` gives for `filename`, or `null` when it is not listed. */
export function checksumFor(shasums: string, filename: string): string | null {
  for (const line of shasums.split("\n")) {
    const [hash, name] = line.trim().split(/\s+/)
    if (name === filename && hash !== undefined && /^[0-9a-f]{64}$/.test(hash)) return hash
  }
  return null
}
