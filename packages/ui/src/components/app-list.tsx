import { AppMark } from "./app-mark"
import { appOrigin, type AppEntry } from "../lib/apps"

const LINK = "rounded-xl border outline-none no-underline hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"

/**
 * The way into each app of a list, each a link to its front page: `rail` is the same in one column, for a rail beside a timeline, `cards` says what the app is under its name (the hub of
 * the media apps), `tiles` is the names alone in a row (above a timeline). A link is a full page load, since every app
 * is a build of its own.
 */
export function AppList({ apps, variant = "cards", label }: { apps: readonly AppEntry[]; variant?: "cards" | "tiles" | "rail"; label: string }) {
  if (variant === "rail") {
    return (
      <nav aria-label={label} className="grid gap-3">
        {apps.map((app) => (
          <a key={app.id} href={appOrigin(app)} className={`${LINK} flex items-center gap-4 p-3`}>
            <AppMark app={app.id} />
            <span className="grid min-w-0 gap-0.5">
              <span className="font-heading text-lg font-medium">{app.label}</span>
              <span className="text-sm text-muted-foreground">{app.description}</span>
            </span>
          </a>
        ))}
      </nav>
    )
  }
  if (variant === "tiles") {
    return (
      <nav aria-label={label} className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {apps.map((app) => (
          <a key={app.id} href={appOrigin(app)} className={`${LINK} flex min-h-12 items-center gap-2 p-3`}>
            <AppMark app={app.id} />
            <span className="font-heading text-base font-medium">{app.label}</span>
          </a>
        ))}
      </nav>
    )
  }
  return (
    <nav aria-label={label} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {apps.map((app) => (
        <a key={app.id} href={appOrigin(app)} className={`${LINK} flex items-center gap-4 p-4`}>
          <AppMark app={app.id} />
          <span className="grid min-w-0 gap-0.5">
            <span className="font-heading text-lg font-medium">{app.label}</span>
            <span className="text-sm text-muted-foreground">{app.description}</span>
          </span>
        </a>
      ))}
    </nav>
  )
}
