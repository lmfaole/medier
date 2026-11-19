/**
 * `npm run film:inbox [-- --dry-run]`: the films the owner logged in Nextcloud Forms (the form «Logg en film») go into
 * `.data/film-log.csv`. Submissions the log lacks are appended and imported (`film-sync import-log`); every valid
 * submission is remembered in `.data/film-forms-seen.txt` so it is not read again (a line later removed from the log does
 * not come back), and one that breaks a rule of the log is reported until it is deleted in Forms. Forms is only read: its
 * tables are queried inside the database container, as `gpodder-export.ts` of the Nextcloud repository does, so no
 * password or app token is needed, and nothing is ever written to Nextcloud.
 */

import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { parseSubmissions, planInbox, readSeen, withLines } from "./film-inbox-plan.ts"
import { parseEnv, withCargoOnPath } from "./sync-schedule.ts"

const ROOT = join(import.meta.dirname, "..")
const LOG = join(ROOT, ".data", "film-log.csv")
const SEEN = join(ROOT, ".data", "film-forms-seen.txt")
const DATABASE_CONTAINER = process.env["NEXTCLOUD_DATABASE_CONTAINER"] ?? "nextcloud-database"
const OWNER = process.env["NEXTCLOUD_OWNER"] ?? "ole"
const FORM = process.env["FILM_FORM_TITLE"] ?? "Logg en film"

// First line: how many forms have that title and owner (must be one); then one JSON object per submission, its answers
// keyed by the text of the question. The database user and name are the container's own settings, read there.
const QUERY = `SELECT count(*) FROM oc_forms_v2_forms WHERE title = :'form' AND owner_id = :'owner';
SELECT json_build_object('id', s.id, 'answers', coalesce((
    SELECT json_object_agg(q.text, a.text) FROM oc_forms_v2_answers a JOIN oc_forms_v2_questions q ON q.id = a.question_id
    WHERE a.submission_id = s.id), '{}'::json))
  FROM oc_forms_v2_submissions s JOIN oc_forms_v2_forms f ON f.id = s.form_id
  WHERE f.title = :'form' AND f.owner_id = :'owner' ORDER BY s.id;`

function readForm(): string {
  const result = spawnSync("podman", ["exec", "-i", DATABASE_CONTAINER, "sh", "-c", 'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -At -v form="$0" -v owner="$1" -f -', FORM, OWNER], { encoding: "utf8", input: QUERY, maxBuffer: 1 << 28 })
  if (result.status !== 0) throw new Error(`could not read the form «${FORM}» in ${DATABASE_CONTAINER}: ${result.stderr.trim() || result.error?.message || `status ${result.status}`}`)
  return result.stdout
}

const dryRun = process.argv.includes("--dry-run")
const [forms = "", ...rest] = readForm().split("\n")
if (forms.trim() !== "1") throw new Error(`film:inbox: expected one Forms form named «${FORM}» owned by ${OWNER}, found ${forms.trim() || "none"}; create it first (apps/film/AGENTS.md)`)
const seen = readSeen(existsSync(SEEN) ? readFileSync(SEEN, "utf8") : "")
const logText = readFileSync(LOG, "utf8")
const plan = planInbox(parseSubmissions(rest.join("\n")), logText, seen)
console.log(`film:inbox: ${plan.toLog.length} new, ${plan.processed.length - plan.toLog.length} already in the log, ${plan.refused.length} refused`)
for (const id of plan.refused) console.log(`  refused (submission ${id}: delete or correct it in Forms, it is reported until then)`)
for (const line of plan.toLog) console.log(`  + ${line}`)
if (!dryRun && plan.processed.length > 0) {
  // Order: the log first, the seen file last, so a stop half way repeats work (the log's key stops a double line) instead of losing a line.
  if (plan.toLog.length > 0) {
    appendFileSync(LOG, withLines(logText, plan.toLog).slice(logText.length))
    const settings = join(homedir(), ".config", "film-sync.env")
    const env = { ...process.env, ...(existsSync(settings) ? parseEnv(readFileSync(settings, "utf8")) : {}), PATH: withCargoOnPath(process.env["PATH"], homedir()) }
    const imported = spawnSync("cargo", ["run", "-q", "-p", "film-sync", "--", "import-log"], { cwd: join(ROOT, "apps", "film"), stdio: "inherit", env })
    if (imported.status !== 0) throw new Error("import-log failed: the lines are in .data/film-log.csv; fix the log and run again")
  }
  mkdirSync(dirname(SEEN), { recursive: true })
  appendFileSync(SEEN, `${plan.processed.join("\n")}\n`)
  console.log("film:inbox: done")
}
