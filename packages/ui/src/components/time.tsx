import { formatTime, timeStamp, type TimeStyle, type TimeValue } from "@designsystem/intl/time"

/**
 * A time or a day in a `<time>` element, written the one way every page writes it: Norwegian, in Oslo (`@designsystem/intl/time`
 * has the styles). `dateTime` carries the machine-readable value. Use it, or `formatTime` where only text will do, for every time a
 * page shows; `scripts/time-format.test.ts` fails on a time formatted any other way.
 */
export function Time({ value, style = "datetime" }: { value: TimeValue | null | undefined; style?: TimeStyle }) {
  const stamp = timeStamp(value)
  return <time dateTime={stamp ?? undefined}>{formatTime(value, style)}</time>
}
