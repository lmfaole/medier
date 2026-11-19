/**
 * The files of an app's `dist/client` (hashed scripts, the pictures landed from `web/public/`, `robots.txt`, the manifest),
 * served by the media server in the Worker's place: the asset store is a folder here. A name that leaves the folder, hides
 * behind a dot or is not a file is not served (`null`: the caller decides what that means). Hashed and immutable paths
 * (`isImmutablePath`) are kept by the browser for a year, anything else is revalidated against its ETag.
 */

import { readFile, stat } from "node:fs/promises"
import { extname, join, resolve, sep } from "node:path"

import { CACHE_IMMUTABLE, CACHE_STANDARD, isImmutablePath } from "@designsystem/config/security-headers"

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
}

/** The file `pathname` names inside `root`, or `null` for anything that is not a plain file in it. */
export function fileInside(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null
  const parts = decoded.split("/").filter((part) => part !== "")
  if (parts.length === 0 || parts.some((part) => part.startsWith("."))) return null
  const resolved = resolve(join(root, ...parts))
  return resolved.startsWith(`${resolve(root)}${sep}`) ? resolved : null
}

/** The answer for `pathname` (without the app's base), or `null` when there is no such file. */
export async function serveStatic(root: string, pathname: string, request: Request): Promise<Response | null> {
  const file = fileInside(root, pathname)
  if (file === null) return null
  const status = await stat(file).catch(() => null)
  if (status === null || !status.isFile()) return null

  const etag = `W/"${status.size.toString(16)}-${Math.floor(status.mtimeMs).toString(16)}"`
  const headers = new Headers({
    "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "Cache-Control": isImmutablePath(pathname) ? CACHE_IMMUTABLE : CACHE_STANDARD,
    ETag: etag,
    "Last-Modified": status.mtime.toUTCString(),
  })
  const tags = request.headers.get("If-None-Match")
  const since = request.headers.get("If-Modified-Since")
  const unchanged = tags !== null ? tags.split(",").some((tag) => tag.trim() === etag || tag.trim() === "*") : since !== null && Date.parse(since) >= Math.floor(status.mtimeMs / 1000) * 1000
  if (unchanged) return new Response(null, { status: 304, headers })
  headers.set("Content-Length", String(status.size))
  if (request.method === "HEAD") return new Response(null, { status: 200, headers })
  // The files of a build are small (scripts, styles, pictures): read whole, nothing is held open while a slow phone downloads.
  return new Response(await readFile(file), { status: 200, headers })
}
