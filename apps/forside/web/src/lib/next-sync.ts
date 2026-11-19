/**
 * When a source is next fetched, from the sync timers' own times (`apps/<app>/sync-rust/schedule.json`), read in
 * Norwegian time. Pure, so the page can run it in the browser with the clock of the reader.
 */

import { formatTime, osloDay } from '@designsystem/intl/time'
const ZONE = 'Europe/Oslo'

/** `hours` at `minute` every day, or on one `weekday` (0 is Sunday) only. */
export interface Schedule {
  hours: readonly number[]
  minute: number
  weekday?: number
}

const EVERY_THREE_HOURS = [0, 3, 6, 9, 12, 15, 18, 21] as const
export const everyThreeHours = (minute: number): Schedule => ({ hours: EVERY_THREE_HOURS, minute })
export const daily = (hour: number, minute: number): Schedule => ({ hours: [hour], minute })
export const weekly = (weekday: number, hour: number, minute: number): Schedule => ({ hours: [hour], minute, weekday })

const PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

/** The wall clock of Oslo at an instant, as the UTC time that shows the same digits. */
function osloWallClock(at: Date): number {
  const part = Object.fromEntries(PARTS.formatToParts(at).map((item) => [item.type, Number(item.value)]))
  return Date.UTC(part.year ?? 0, (part.month ?? 1) - 1, part.day ?? 1, part.hour ?? 0, part.minute ?? 0)
}

/** The instant at which the clock in Oslo shows `wall` (a UTC time carrying wall-clock digits). */
function instantOf(wall: number): Date {
  const guess = new Date(wall)
  return new Date(wall - (osloWallClock(guess) - wall))
}

/** The first run after `now`, searching a week and a day ahead. */
export function nextRun(schedule: Schedule, now: Date): Date {
  const today = new Date(osloWallClock(now))
  for (let offset = 0; offset <= 8; offset++) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset))
    if (schedule.weekday !== undefined && day.getUTCDay() !== schedule.weekday) continue
    for (const hour of schedule.hours) {
      const at = instantOf(day.getTime() + (hour * 60 + schedule.minute) * 60_000)
      if (at.getTime() > now.getTime()) return at
    }
  }
  throw new Error('a schedule has no run in the next nine days')
}

/** «i dag 04:15», «i morgen 04:15» or «søndag 04:25». */
export function describeNext(next: Date, now: Date): string {
  const tomorrow = new Date(now.getTime() + 86_400_000)
  const when = osloDay(next) === osloDay(now) ? 'i dag' : osloDay(next) === osloDay(tomorrow) ? 'i morgen' : formatTime(next, 'weekday')
  return `${when} ${formatTime(next, 'clock')}`
}
