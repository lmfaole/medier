/**
 * What `npm run page-check` reports, as pure functions: the URL of a page on an app's dev server, which
 * browser messages count as a problem and the lines of the answer. The browser and the dev server are
 * `page-check.ts`'s.
 */

export interface Observed {
  viewport: "desktop" | "phone"
  status: number
  h1: string | null
  consoleErrors: string[]
  pageErrors: string[]
  failedRequests: string[]
  /** Serious or critical axe rules, `id (elements): help`. */
  axe: string[]
  /** What a reader with scripts off gets: the heading and how much text is in the HTML. */
  noJs: { h1: string | null; textLength: number }
  screenshot: string
}

/** `http://localhost:<port><base>/<path>`, the base being how the app is mounted (`/apps/film`, or none). */
export function pageUrl(port: number, basePath: string | undefined, path: string): string {
  const base = (basePath ?? "").replace(/\/$/, "")
  const rest = path === "/" || path === "" ? "" : path.startsWith("/") ? path : `/${path}`
  return `http://localhost:${port}${base}${rest === "" ? "/" : rest}`
}

const NOISE = [/Download the React DevTools/i, /\[vite\]/i, /favicon/i]

/** A console message of the error kind that is not the dev server talking about itself. */
export function isProblem(message: string): boolean {
  return !NOISE.some((pattern) => pattern.test(message))
}

const short = (text: string, width = 140): string => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat
}

/** One block per viewport: a first line with the verdict, then a line per problem. */
export function formatObserved(path: string, observed: Observed): string {
  const problems = [
    ...(observed.status >= 400 || observed.status === 0 ? [`status ${observed.status}`] : []),
    ...(observed.h1 === null ? ["no <h1>"] : []),
    ...observed.pageErrors.map((error) => `page error: ${short(error)}`),
    ...observed.consoleErrors.map((error) => `console: ${short(error)}`),
    ...observed.failedRequests.map((request) => `request failed: ${short(request)}`),
    ...observed.axe.map((rule) => `axe: ${short(rule)}`),
    ...(observed.noJs.h1 === null || observed.noJs.textLength < 200 ? [`without JavaScript: h1 ${observed.noJs.h1 ?? "missing"}, ${observed.noJs.textLength} characters of text`] : []),
  ]
  const head = `${problems.length === 0 ? "ok    " : "PROBLEM"} ${path} (${observed.viewport}) ${observed.status} "${short(observed.h1 ?? "", 60)}"  ${observed.screenshot}`
  return [head, ...problems.map((problem) => `        ${problem}`)].join("\n")
}

export function hasProblems(all: readonly Observed[]): boolean {
  return all.some(
    (observed) =>
      observed.status >= 400 ||
      observed.status === 0 ||
      observed.h1 === null ||
      observed.pageErrors.length > 0 ||
      observed.consoleErrors.length > 0 ||
      observed.failedRequests.length > 0 ||
      observed.axe.length > 0 ||
      observed.noJs.h1 === null,
  )
}
