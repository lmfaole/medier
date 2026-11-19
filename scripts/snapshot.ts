/**
 * `npm run snapshot` in an app (`apps/<name>`), and the first step of its
 * deploy: writes the app's API as static files from the local database
 * (`.data/<domain>.db`, or the file named by the domain's variable, `MUSIC_DB`…).
 * See `snapshot-app.ts`.
 */

import { basename, resolve } from "node:path"

import { snapshotApp } from "./snapshot-app.ts"

const appDirectory = process.cwd()
const rootDirectory = resolve(appDirectory, "..", "..")
const written = await snapshotApp({ appDirectory, rootDirectory, log: console.warn })
console.log(`${basename(appDirectory)}: ${written.length} snapshot file${written.length === 1 ? "" : "s"} in web/public/api/`)
if (written.length === 0) console.warn(`${basename(appDirectory)}: nothing to serve yet: the local database has no rows for it.`)
