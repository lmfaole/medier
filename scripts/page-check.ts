/**
 * `npm run page-check -- <app> [<path>…] [--built] [--no-axe]`: a page in a real browser, answered in a few lines. It starts the
 * app's dev server (or with `--built` its built Worker under Wrangler, the way `npm run e2e` serves it, after
 * `npm run snapshot` and `npm run build`) when none answers, opens each path on a desktop and a phone, and reports the status,
 * the `<h1>`, console and page errors, failed requests, serious accessibility rules (axe) and what a
 * reader with scripts off gets. A screenshot of each lands in `.data/tmp/page-check/` and its path is printed; the
 * picture is for looking at only when a line says something is wrong. This supplements the Playwright MCP
 * (AGENTS.md, rule 4), which is still how a page is exercised, clicked through and judged.
 */

import { spawn } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { AxeBuilder } from "@axe-core/playwright"
import { chromium, devices, type Browser } from "@playwright/test"

import { APPS } from "./apps.ts"
import { APPS_UNDER_TEST } from "../e2e/pages.ts"
import { formatObserved, hasProblems, isProblem, pageUrl, type Observed } from "./page-check-plan.ts"

process.env["PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS"] ??= "1"

const root = join(import.meta.dirname, "..")
const args = process.argv.slice(2)
const [appName = "", ...rest] = args.filter((arg) => !arg.startsWith("--"))
const app = APPS.find((entry) => entry.name === appName)
if (app === undefined) throw new Error(`usage: npm run page-check -- <${APPS.map((entry) => entry.name).join("|")}> [<path>…] [--no-axe]`)
if (app.port === undefined) throw new Error(`${app.name} has no pages to check`)
const paths = rest.length === 0 ? ["/"] : rest
const underTest = APPS_UNDER_TEST.find((entry) => entry.name === app.name)
const basePath = underTest?.basePath
const built = args.includes("--built")
const port: number = built ? (underTest?.port ?? app.port) : app.port

async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(20_000) })
    return true
  } catch {
    return false
  }
}

/** The dev server of the app, started here only when nothing answers on its address; the returned function stops it. */
async function ensureServer(url: string): Promise<() => void> {
  if (await answers(url)) return () => {}
  // The same port and inspector port as `dev-all.ts`, so the two never start one app twice on different ones.
  const index = APPS.findIndex((entry) => entry.name === app?.name)
  const [command, commandArgs]: [string, string[]] = built
    ? ["npx", ["wrangler", "dev", "--config", `apps/${app?.name}/web/dist/server/wrangler.json`, "--port", String(port), "--inspector-port", String(underTest?.inspectorPort)]]
    : ["npm", ["run", "dev", "--workspace", `apps/${app?.name}/web`, "--", "--port", String(port), "--strictPort"]]
  if (built && !existsSync(join(root, "apps", app?.name ?? "", "web", "dist", "server", "wrangler.json"))) throw new Error(`no build of ${app?.name}: run npm run snapshot and npm run build in apps/${app?.name} first`)
  const child = spawn(command, commandArgs, {
    cwd: root,
    detached: true,
    stdio: "ignore",
    // A home app reads the fixture files of its folder, never the live ones.
    env: { ...process.env, WORKER_INSPECTOR_PORT: String(9229 + index), ...(underTest?.apperDir === undefined ? {} : { APPER_DIR: join(root, underTest.apperDir) }) },
  })
  const stop = (): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid)
    } catch {
      // Already gone.
    }
  }
  for (let waited = 0; waited < 90; waited += 1) {
    if (await answers(url)) return stop
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  stop()
  throw new Error(`the dev server of ${app?.name} did not answer on ${url} within 90 s`)
}

async function observe(browser: Browser, url: string, viewport: "desktop" | "phone", shot: string, axe: boolean): Promise<Observed> {
  const context = await browser.newContext(viewport === "phone" ? devices["Pixel 7"] : { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  page.on("console", (message) => message.type() === "error" && isProblem(message.text()) && consoleErrors.push(message.text()))
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`))

  const response = await page.goto(url, { waitUntil: "networkidle" }).catch(() => null)
  await page.emulateMedia({ reducedMotion: "reduce" })
  const h1 = (await page.getByRole("heading", { level: 1 }).first().textContent({ timeout: 3000 }).catch(() => null))?.trim() ?? null
  const violations = axe ? (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations : []
  await page.screenshot({ path: shot, type: "jpeg", quality: 55 })
  await context.close()

  const plain = await browser.newContext({ javaScriptEnabled: false })
  const plainPage = await plain.newPage()
  await plainPage.goto(url).catch(() => null)
  const noJs = {
    h1: (await plainPage.getByRole("heading", { level: 1 }).first().textContent({ timeout: 3000 }).catch(() => null))?.trim() ?? null,
    textLength: (await plainPage.locator("body").innerText().catch(() => "")).length,
  }
  await plain.close()

  return {
    viewport,
    status: response?.status() ?? 0,
    h1,
    consoleErrors,
    pageErrors,
    failedRequests,
    axe: violations.filter((rule) => rule.impact === "serious" || rule.impact === "critical").map((rule) => `${rule.id} (${rule.nodes.length}): ${rule.help}`),
    noJs,
    screenshot: shot,
  }
}

const shots = join(root, ".data", "tmp", "page-check")
mkdirSync(shots, { recursive: true })
const stop = await ensureServer(pageUrl(port, basePath, "/"))
const browser = await chromium.launch()
const all: Observed[] = []
try {
  for (const path of paths) {
    for (const viewport of ["desktop", "phone"] as const) {
      const slug = `${app.name}${path.replace(/\W+/g, "-")}-${viewport}`.replace(/-+$/, "")
      const observed = await observe(browser, pageUrl(port, basePath, path), viewport, join(shots, `${slug}.jpg`), !args.includes("--no-axe"))
      all.push(observed)
      console.log(formatObserved(path, observed))
    }
  }
} finally {
  await browser.close()
  stop()
}
if (!built && all.some((observed) => observed.consoleErrors.some((error) => /HTTP 404 for .*\/api\//.test(error)))) {
  console.log("the dev server does not serve the snapshot under the app's base path; try --built (npm run snapshot and npm run build first)")
}
process.exitCode = hasProblems(all) ? 1 : 0
