import { formatTime, osloDay } from "@designsystem/intl/time"
import { AppMark } from "./app-mark"
import { Picture } from "@lmfaole/designsystem/components/picture"
import { APPS, type AppId } from "../lib/apps"
import { coverRatioOf } from "../lib/cover-ratio"
import { NOTHING_YET } from "../lib/empty-states"
import { Text } from "@lmfaole/designsystem/components/text"

/** One line of the timeline, as `@designsystem/timeline` answers it: `at` is an ISO instant, `hasTime` false for a day only. */
export interface TimelineLine {
  app: AppId
  at: string
  hasTime: boolean
  title: string
  subtitle: string | null
  /** A path of the host the owning app serves the picture at, or `null`. */
  image: string | null
}

const dayLabel = (at: string) => {
  const label = formatTime(at, "weekdayDate")
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/**
 * The latest of the media apps in one list, newest first, a day at a time: when, the picture, what it was and which app
 * it is from (its mark and name, no link: the list of apps is the way in). `level` is the heading level of a day.
 */
export function MediaTimeline({ entries, level = 3 }: { entries: readonly TimelineLine[]; level?: 2 | 3 }) {
  if (entries.length === 0) return <Text size="sm" tone="muted">{NOTHING_YET}</Text>

  const days = new Map<string, TimelineLine[]>()
  for (const entry of entries) days.set(osloDay(entry.at), [...(days.get(osloDay(entry.at)) ?? []), entry])
  const Day = `h${level}` as const
  return (
    <div className="grid gap-6">
      {[...days].map(([day, lines]) => (
        <section key={day} aria-labelledby={`day-${day}`} className="grid gap-2">
          <Day id={`day-${day}`} className="text-sm font-semibold tracking-widest text-muted-foreground uppercase">
            {dayLabel(lines[0]?.at ?? day)}
          </Day>
          <ol className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,24rem),1fr))] gap-x-10 gap-y-3">
            {lines.map((entry, index) => (
              <li key={`${entry.at}/${entry.app}/${index}`} className="grid grid-cols-[3.5rem_auto_1fr] items-center gap-x-3">
                <span className="text-sm text-muted-foreground tabular-nums">{entry.hasTime ? formatTime(entry.at, "clock") : ""}</span>
                <Picture src={entry.image} ratio={coverRatioOf(entry.app)} />
                <span className="grid min-w-0 gap-0.5">
                  <span className="font-medium [overflow-wrap:anywhere]">{entry.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <AppMark app={entry.app} size="sm" />
                      {APPS[entry.app].label}
                    </span>
                    {entry.subtitle === null ? null : <span className="[overflow-wrap:anywhere]">{entry.subtitle}</span>}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
