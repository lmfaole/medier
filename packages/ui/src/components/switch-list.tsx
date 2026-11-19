import { Stack } from "@lmfaole/designsystem/components/layout"
import { Text } from "@lmfaole/designsystem/components/text"

/** One switch: what it is, when it applies, and whether it is on. */
export interface SwitchChoice {
  id: string
  label: string
  /** What it means in a few words, written after the label. */
  note: string
  on: boolean
}

/**
 * A titled list of on/off switches (native checkboxes with the switch role, 48px high), with a line for what went wrong. It only draws:
 * what is on and what a change does is the caller's.
 */
export function SwitchList({ title, choices, disabled, problem, onChange }: { title: string; choices: readonly SwitchChoice[]; disabled: boolean; problem: string | null; onChange: (id: string, on: boolean) => void }) {
  return (
    <div className="mt-8">
    <Stack gap="sm">
      <Text weight="medium">{title}</Text>
      {choices.map((choice) => (
        <label key={choice.id} className="flex min-h-12 items-center gap-3">
          <input type="checkbox" role="switch" className="size-5" checked={choice.on} disabled={disabled} onChange={(event) => onChange(choice.id, event.currentTarget.checked)} />
          <span>
            {choice.label} <span className="text-muted-foreground">({choice.note})</span>
          </span>
        </label>
      ))}
      {problem === null ? null : (
        <p role="alert" className="text-sm">
          {problem}
        </p>
      )}
    </Stack>
    </div>
  )
}
