// Astro: part of an island that searches in place (the RSS search page); a form of its own, so it also works as a plain GET before the page has hydrated.

import type { ChangeEvent, ReactNode } from 'react'

import { Button } from '@lmfaole/designsystem/components/button'
import { NativeSelect, NativeSelectOption } from '@lmfaole/designsystem/components/native-select'

interface Choice {
  value: string
  label: string
}

/**
 * A search field with, when there is anything to narrow by, a native select, and the button that sends them. The words and the choice are the
 * caller's (`value`, `choice`): it filters as they change and keeps them in the address. `action` is the address the form sends to without scripts.
 */
export function SearchField({ action, label, placeholder, value, onValue, choiceLabel, choices, choice, onChoice, children }: {
  action: string
  label: string
  placeholder: string
  value: string
  onValue: (value: string) => void
  /** What the select is called, for a screen reader and as its first option's «alle»; the select is left out when `choices` is empty. */
  choiceLabel: string
  choices: readonly Choice[]
  choice: string
  onChoice: (choice: string) => void
  children?: ReactNode
}) {
  return (
    <form method="get" action={action} role="search" className="flex flex-wrap items-center gap-2" onSubmit={(event) => event.preventDefault()}>
      <input
        type="search"
        name="q"
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onValue(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm sm:w-96"
      />
      {choices.length === 0 ? null : (
        <NativeSelect name="k" aria-label={choiceLabel} value={choice} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChoice(event.target.value)} className="w-56">
          <NativeSelectOption value="">{choiceLabel}: alle</NativeSelectOption>
          {choices.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      )}
      <Button type="submit" variant="outline" size="sm">
        Søk
      </Button>
      {children}
    </form>
  )
}
