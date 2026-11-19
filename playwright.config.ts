/**
 * Browser tests for the apps. Each project runs only the specs a browser is
 * there for: Chromium, on a desktop and a phone, is the everyday set (`npm run e2e`);
 * Firefox and WebKit, on a desktop and a phone, only check that every page renders and
 * the navigation works (`npm run e2e:all`); the screenshots are for looking, not
 * for checking, and run only on their own (`npm run e2e:screenshots`). `work` and `forside` are
 * served from their built Worker (`apps/<name>/web/dist`) by Wrangler with no database, the way they
 * run deployed, so build and snapshot first (`npm run snapshot` and `npm run build` in the app). The
 * eight media apps run in `scripts/media-server.ts` against the local databases, without the login,
 * so build them first: `npm run media:build` (`e2e/README.md`).
 */

import { defineConfig, devices } from "@playwright/test"

import { APPS_UNDER_TEST, rootOf } from "./e2e/pages.ts"

const SCREENSHOTS = "screenshots.spec.ts"
const DESKTOP_ONLY = ["a11y.spec.ts", "motion.spec.ts"]
const BASICS = ["smoke.spec.ts", "navigation.spec.ts"]

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  outputDir: "e2e/results",
  reporter: [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]],
  fullyParallel: true,
  // Three Wrangler servers and five browsers share this machine, so a heading can take a while.
  expect: { timeout: 10_000 },
  retries: 0,
  use: {
    // A failure keeps what a user-test review needs: the trace, the video and a screenshot.
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Accessibility and motion are about the shared CSS and markup, which do not change with the browser or the width.
    { name: "chromium", testIgnore: SCREENSHOTS, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", testIgnore: [SCREENSHOTS, ...DESKTOP_ONLY], use: { ...devices["Pixel 7"] } },
    { name: "firefox", testMatch: BASICS, use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", testMatch: BASICS, use: { ...devices["Desktop Safari"] } },
    { name: "mobile-webkit", testMatch: BASICS, use: { ...devices["iPhone 15"] } },
    { name: "screenshots-desktop", testMatch: SCREENSHOTS, use: { ...devices["Desktop Chrome"] } },
    { name: "screenshots-mobile", testMatch: SCREENSHOTS, use: { ...devices["Pixel 7"] } },
  ],
  webServer: APPS_UNDER_TEST.map((app) => ({
    // The media apps (the ones mounted under a base) run in the Node server, with no login, each with the hub its bar links to; a home app alone, on the fixture files of its folder; work and forside as Workers.
    command:
      app.basePath === undefined
        ? `npx wrangler dev --config apps/${app.name}/web/dist/server/wrangler.json --port ${app.port} --inspector-port ${app.inspectorPort}`
        : `${app.apperDir === undefined ? "" : `APPER_DIR=${app.apperDir} `}MEDIA_ONLY=${app.name}${app.apperDir === undefined ? ",medier" : ""} MEDIA_LOGIN=off node scripts/media-server.ts --port ${app.port}`,
    url: `${rootOf(app)}/`,
    reuseExistingServer: true,
    timeout: 120_000,
  })),
})
