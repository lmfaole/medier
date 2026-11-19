// Astro: part of the library island (`LibraryPage`), which is `client:idle`; the form submits to the page itself until it hydrates.

import { useEffect, useRef, type FormEvent } from 'react'
import * as v from 'valibot'

import { appUrl } from '../lib/base-url'
import { LibrarySearch } from '../lib/library-search'
import { Button } from '@lmfaole/designsystem/components/button'
import { NativeSelect, NativeSelectOption } from '@lmfaole/designsystem/components/native-select'

interface Option {
  value: string
  label: string
}

/** One narrowing of the library: the query parameter it is sent as, what it is called and what it can be. */
export interface LibraryFilter {
  name: 'status' | 'kind' | 'format'
  label: string
  options: readonly Option[]
}

const TYPING_PAUSE_MS = 200

/** The form's fields as the address's parameters, read back through the schema: what is empty or unusable is left out. */
function searchOf(form: HTMLFormElement): LibrarySearch {
  return v.parse(LibrarySearch, Object.fromEntries([...new FormData(form)].flatMap(([name, value]) => (typeof value === 'string' && value.trim() !== '' ? [[name, value.trim()]] : []))))
}

/**
 * The search and the narrowings of a library page, as a form that sends them in the address: it works as it is
 * without JavaScript (a GET to the page, which filters from the same parameters). With JavaScript `onChange` is told
 * the new search as the fields change (after a short pause in typing) and the page filters in place A narrowing with nothing to choose between is left out.
 */
export function LibraryControls({ search, filters, onChange }: { search: LibrarySearch; filters: readonly LibraryFilter[]; onChange: (search: LibrarySearch) => void }) {
  const form = useRef<HTMLFormElement>(null)
  const pause = useRef<number | undefined>(undefined)

  function apply(): void {
    window.clearTimeout(pause.current)
    if (form.current !== null) onChange(searchOf(form.current))
  }

  function onSubmit(event: FormEvent): void {
    event.preventDefault()
    apply()
  }

  useEffect(() => () => window.clearTimeout(pause.current), [])

  return (
    <form
      ref={form}
      method="get"
      action={appUrl('/bibliotek')}
      className="flex flex-wrap items-center gap-2 xl:sticky xl:top-4 xl:grid xl:content-start"
      role="search"
      onSubmit={onSubmit}
      onChange={() => {
        window.clearTimeout(pause.current)
        pause.current = window.setTimeout(apply, TYPING_PAUSE_MS)
      }}
    >
      <input
        type="search"
        name="q"
        defaultValue={search.q ?? ''}
        placeholder="Søk i biblioteket"
        aria-label="Søk i biblioteket"
        className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm sm:w-72 xl:w-full"
      />
      {filters
        .filter((filter) => filter.options.length > 1)
        .map((filter) => (
          <NativeSelect key={filter.name} name={filter.name} aria-label={filter.label} defaultValue={search[filter.name] ?? ''} className="w-44 xl:w-full">
            <NativeSelectOption value="">{filter.label}: alle</NativeSelectOption>
            {filter.options.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ))}
      <Button type="submit" variant="outline" size="sm">
        Vis
      </Button>
    </form>
  )
}
