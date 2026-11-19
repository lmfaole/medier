/**
 * What an app's data tool runs on a timer, as data: `apps/<app>/sync-rust/schedule.json`
 * names the jobs of each mode and the systemd timers that start a mode, and this
 * module turns that into the commands to run and the unit files to write. The
 * effects (running, writing, enabling) are `sync-timers.ts`'s, so none of this
 * needs systemd or cargo to be tested.
 */

import * as v from "valibot"

const Timer = v.object({
  name: v.pipe(v.string(), v.regex(/^[a-z]+$/)),
  description: v.string(),
  mode: v.string(),
  /** A systemd `OnCalendar` expression. */
  calendar: v.string(),
  /** A systemd `TimeoutStartSec` value. */
  timeout: v.string(),
})

const Schedule = v.pipe(
  v.object({
    /** Variables the env file must hold before the timers are enabled. */
    requires: v.array(v.string()),
    /** Each mode's jobs, one command line per entry; `{mode}` is replaced by the mode's name. */
    modes: v.record(v.string(), v.array(v.string())),
    /** Scripts of this repository (`scripts/x.ts`) run with Node after every mode, once its jobs have all succeeded: what is written from the fresh data. */
    after: v.optional(v.array(v.pipe(v.string(), v.regex(/^scripts\/[a-z0-9-]+\.ts$/))), []),
    timers: v.array(Timer),
  }),
  v.check(({ modes, timers }) => timers.every((timer) => timer.mode in modes), "a timer names a mode that has no jobs"),
)

export type SyncSchedule = v.InferOutput<typeof Schedule>
export type SyncTimer = SyncSchedule["timers"][number]

export function parseSchedule(source: unknown): SyncSchedule {
  return v.parse(Schedule, source)
}

/** The jobs of `mode` as argument lists, ready for the tool's binary. */
export function jobsFor(schedule: SyncSchedule, mode: string): string[][] {
  const lines = schedule.modes[mode]
  if (lines === undefined) throw new Error(`no mode "${mode}"; the modes are ${Object.keys(schedule.modes).join(", ")}`)
  return lines.map((line) => line.replaceAll("{mode}", mode).split(/\s+/).filter(Boolean))
}

/** `KEY=value` lines, without comments and without the quotes a shell would strip. */
export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (match?.[1] === undefined || match[2] === undefined) continue
    env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2")
  }
  return env
}

export function missingVariables(schedule: SyncSchedule, env: Record<string, string>): string[] {
  return schedule.requires.filter((name) => !env[name])
}

/** The service and timer unit for one timer; `command` is what the service runs. */
export function unitFiles(timer: SyncTimer, command: string): { service: string; timer: string } {
  return {
    service: `[Unit]
Description=${timer.description}
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=${command}
TimeoutStartSec=${timer.timeout}
`,
    timer: `[Unit]
Description=${timer.description}

[Timer]
OnCalendar=${timer.calendar}
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
`,
  }
}

export const unitName = (app: string, timer: SyncTimer): string => `${app}-sync-${timer.name}`

/**
 * A systemd user service starts with a bare PATH, without `~/.cargo/bin`, so the
 * timer's own `cargo build` would not be found: put it first, once.
 */
export function withCargoOnPath(path: string | undefined, home: string): string {
  const cargo = `${home}/.cargo/bin`
  const entries = (path ?? "").split(":").filter((entry) => entry !== "")
  return entries.includes(cargo) ? entries.join(":") : [cargo, ...entries].join(":")
}
