# Browser tests and user-test material

Playwright (`@playwright/test`) with axe (`@axe-core/playwright`), against the
two apps that have a snapshot: music and work. Each is served
from its **built Worker with no database**, the way it runs deployed.

```sh
npm run e2e:install        # once: Chromium, Firefox, WebKit (and the Fedora libraries WebKit needs)
for app in music work; do (cd apps/$app && npm run snapshot && npm run build); done
npm run e2e                # the everyday set: Chromium on a desktop and on a phone
npm run e2e:all            # the same plus Firefox, WebKit and an iPhone: every page renders, the navigation works
npm run e2e:screenshots    # a full-page picture of every page, light and dark (for looking, checks nothing)
npx playwright test --project=chromium e2e/a11y.spec.ts    # one project, one file
npx playwright show-report e2e/report                      # the HTML report, with traces and videos of failures
```

Each project runs only the specs a browser is there for (`playwright.config.ts`); a spec is in the set
when it can fail in a way no unit test sees:

| Spec | Runs in | What only a browser shows |
| --- | --- | --- |
| `smoke.spec.ts` | every browser | the page answers 200, shows its `<h1>` and throws nothing |
| `navigation.spec.ts` | every browser | there is no menu and no shared header (no banner), and a link from an app's front page to its own page leaves focus on the heading |
| `a11y.spec.ts` | desktop Chromium | axe (WCAG 2 A/AA); fails on any serious or critical rule that is not in the page's `knownViolations` (`pages.ts`) |
| `entity-sheets.spec.ts` | Chromium, desktop and phone | a sheet slides in from the right (desktop) or the bottom (phone), has no serious a11y violation, and a link inside it opens the next one with back returning |
| `library.spec.ts` | desktop Chromium | the library follows its search field with no page load and no history entry per letter, keeps focus in the field |
| `work.spec.ts` | Chromium, desktop and phone | `work` is open to search engines (no robots header or meta) and shows the CV and GitHub |
| `motion.spec.ts` | desktop Chromium | the shared movements run, and collapse under reduced motion |
| `screenshots.spec.ts` | `screenshots-*`, on request | a full-page picture of every page, in CSS pixels, into `e2e/screenshots/<project>/<theme>/` (git-ignored) |

Failures keep a trace, a video and a screenshot in `e2e/results/` (git-ignored).
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` is set by the npm scripts: Playwright
does not officially support Fedora and would stop on its host check. A new page is
one line in `pages.ts` (and its app, if new, an entry in `APPS_UNDER_TEST`).
