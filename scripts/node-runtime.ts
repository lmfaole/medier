/**
 * The Node that this repository's timers and the owner's shell run, in `~/.local/node`: the newest release of the major in
 * `.node-version`, from nodejs.org, checked against its `SHASUMS256.txt`. It lives in the home directory so that a newer
 * Node needs no root (Fedora's packages lag behind what Astro asks for), and in one fixed folder because a unit's
 * `ExecStart` is the `process.execPath` that installed it: an update replaces the folder whole and the path stays.
 *
 *   node scripts/node-runtime.ts status   which major is wanted and which version is installed
 *   node scripts/node-runtime.ts update   install the newest release of the major when it is not already there
 *
 * `deps-update.ts` runs `update` weekly, so patch and minor releases arrive by themselves; a new major is a change to
 * `.node-version` by hand, then `update`.
 */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { checksumFor, newestInMajor, type Release, wantedMajor } from "./node-runtime-plan.ts"

const root = join(import.meta.dirname, "..")
const DIST = "https://nodejs.org/dist"
export const NODE_HOME = join(homedir(), ".local", "node")
const build = `linux-${process.arch}`

function wanted(): number {
  const text = readFileSync(join(root, ".node-version"), "utf8")
  const major = wantedMajor(text)
  if (major === null) throw new Error(`.node-version does not name a version: ${text.trim()}`)
  return major
}

function versionOf(node: string): string | null {
  if (!existsSync(node)) return null
  const result = spawnSync(node, ["-v"], { encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() : null
}

function isRelease(value: unknown): value is Release {
  if (typeof value !== "object" || value === null || !("version" in value) || !("files" in value)) return false
  return typeof value.version === "string" && Array.isArray(value.files) && value.files.every((file) => typeof file === "string")
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response
}

/** Installs the newest release of the wanted major unless it is there; the problem, or `null` when Node is current. */
export async function updateNodeRuntime(): Promise<string | null> {
  try {
    const major = wanted()
    const index: unknown = await (await fetchOk(`${DIST}/index.json`)).json()
    const version = newestInMajor(Array.isArray(index) ? index.filter(isRelease) : [], major, build)
    if (version === null) return `nodejs.org has no Node ${major} for ${build}`
    if (versionOf(join(NODE_HOME, "bin", "node")) === version) {
      console.log(`node-runtime: ${version} is current in ${NODE_HOME}`)
      return null
    }
    const file = `node-${version}-${build}.tar.xz`
    const expected = checksumFor(await (await fetchOk(`${DIST}/${version}/SHASUMS256.txt`)).text(), file)
    if (expected === null) return `SHASUMS256.txt of ${version} does not list ${file}`
    const tarball = Buffer.from(await (await fetchOk(`${DIST}/${version}/${file}`)).arrayBuffer())
    const actual = createHash("sha256").update(tarball).digest("hex")
    if (actual !== expected) return `${file} has sha256 ${actual}, SHASUMS256.txt says ${expected}`

    const staging = `${NODE_HOME}.new`
    const previous = `${NODE_HOME}.old`
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    const archive = join(staging, file)
    writeFileSync(archive, tarball)
    const unpacked = spawnSync("tar", ["-xJf", archive, "-C", staging, "--strip-components=1"], { encoding: "utf8" })
    rmSync(archive)
    if (unpacked.status !== 0) return `tar could not unpack ${file}: ${unpacked.stderr.trim()}`
    if (versionOf(join(staging, "bin", "node")) !== version) return `the unpacked ${file} does not run as ${version}`
    // A running node keeps its open binary, so the folder can be swapped under a timer that is using it.
    rmSync(previous, { recursive: true, force: true })
    if (existsSync(NODE_HOME)) renameSync(NODE_HOME, previous)
    renameSync(staging, NODE_HOME)
    rmSync(previous, { recursive: true, force: true })
    console.log(`node-runtime: ${version} installed in ${NODE_HOME}`)
    return null
  } catch (error) {
    return `node-runtime: ${error instanceof Error ? error.message : String(error)}`
  }
}

if (import.meta.main) {
  const action = process.argv[2]
  if (action === "status") {
    console.log(`wanted: Node ${wanted()} (.node-version); installed: ${versionOf(join(NODE_HOME, "bin", "node")) ?? "none"} in ${NODE_HOME}; running: ${process.version} (${process.execPath})`)
  } else if (action === "update") {
    const problem = await updateNodeRuntime()
    if (problem !== null) {
      console.error(problem)
      process.exitCode = 1
    }
  } else {
    console.error("usage: node scripts/node-runtime.ts status | update")
    process.exitCode = 1
  }
}
