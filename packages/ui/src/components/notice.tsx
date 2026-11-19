import type { ReactNode } from "react"

const TONES = { info: "border-border bg-muted/40", error: "border-destructive/40 text-destructive" } as const

/** A line that tells how things stand, set apart from the page's text: `info` is announced politely, `error` at once. Its actions (a retry button) come after the text. */
export function Notice({ tone, children, actions }: { tone: keyof typeof TONES; children: string; actions?: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${TONES[tone]}`}>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
      {actions}
    </div>
  )
}
